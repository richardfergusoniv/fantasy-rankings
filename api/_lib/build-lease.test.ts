import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

import {
  runWithBuildLease,
  type BuildLeaseRow,
  type BuildLeaseStore,
} from "./build-lease.js";

/**
 * In-memory store that mirrors the Postgres claim semantics: a live
 * ('running', unexpired) lease blocks every other holder.
 */
function createFakeStore() {
  const rows = new Map<string, BuildLeaseRow>();
  let now = 1_000_000;
  const store: BuildLeaseStore = {
    async claim(resource, holder, ttlMs) {
      const row = rows.get(resource);
      if (row && row.status === "running" && row.expiresAt.getTime() > now) {
        return false;
      }
      rows.set(resource, {
        resource,
        holder,
        status: "running",
        lastError: null,
        acquiredAt: new Date(now),
        expiresAt: new Date(now + ttlMs),
        updatedAt: new Date(now),
      });
      return true;
    },
    async finish(resource, holder, error) {
      const row = rows.get(resource);
      if (!row || row.holder !== holder) return;
      row.status = error == null ? "done" : "failed";
      row.lastError = error;
      row.expiresAt = new Date(now);
      row.updatedAt = new Date(now);
    },
    async read(resource) {
      return rows.get(resource) ?? null;
    },
  };
  return {
    store,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("runWithBuildLease", () => {
  it("lets concurrent invocations produce exactly one build per resource", async () => {
    const { store } = createFakeStore();
    const build = vi.fn(async () => "dashboard");
    const other = vi.fn(async () => "second-build");

    const [first, second] = await Promise.all([
      runWithBuildLease(store, "dashboard-build:u1", "h1", 90_000, build),
      runWithBuildLease(store, "dashboard-build:u1", "h2", 90_000, other),
    ]);

    expect(first.status).toBe("built");
    expect(second.status).toBe("joined");
    expect(build).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("isolates leases per resource", async () => {
    const { store } = createFakeStore();
    const [a, b] = await Promise.all([
      runWithBuildLease(store, "dashboard-build:u1", "h1", 90_000, async () => 1),
      runWithBuildLease(store, "dashboard-build:u2", "h2", 90_000, async () => 2),
    ]);
    expect(a.status).toBe("built");
    expect(b.status).toBe("built");
  });

  it("records structured failure state and frees the resource for a retry", async () => {
    const { store } = createFakeStore();
    const failure = await runWithBuildLease(store, "dashboard-build:u1", "h1", 90_000, async () => {
      throw new Error("sleeper upstream 503");
    });
    expect(failure.status).toBe("failed");

    const lease = await store.read("dashboard-build:u1");
    expect(lease?.status).toBe("failed");
    expect(lease?.lastError).toBe("sleeper upstream 503");

    const retry = await runWithBuildLease(store, "dashboard-build:u1", "h2", 90_000, async () => "ok");
    expect(retry.status).toBe("built");
  });

  it("lets an expired lease be reclaimed after a crashed holder", async () => {
    const { store, advance } = createFakeStore();
    // Holder claims but never finishes (instance died mid-build).
    expect(await store.claim("dashboard-build:u1", "dead-holder", 90_000)).toBe(true);
    expect(await store.claim("dashboard-build:u1", "h2", 90_000)).toBe(false);

    advance(91_000);

    const outcome = await runWithBuildLease(store, "dashboard-build:u1", "h2", 90_000, async () => "ok");
    expect(outcome.status).toBe("built");
  });
});

describe("runWithBuildLease deadline", () => {
  it("keeps the lease after a timeout until the build actually settles", async () => {
    vi.useFakeTimers();
    try {
      const { store } = createFakeStore();
      let finishBuild!: () => void;
      const slow = () => new Promise<string>((resolve) => { finishBuild = () => resolve("late"); });
      const pending = runWithBuildLease(store, "r", "holder-a", 90_000, slow, { deadlineMs: 55_000 });
      await vi.advanceTimersByTimeAsync(55_000);
      const outcome = await pending;
      expect(outcome.status).toBe("failed");
      // The timed-out build is still running: nobody else may claim yet.
      const second = vi.fn(async () => "second");
      expect((await runWithBuildLease(store, "r", "holder-b", 90_000, second)).status).toBe("joined");
      expect(second).not.toHaveBeenCalled();
      expect((await store.read("r"))?.status).toBe("running");

      finishBuild();
      if (outcome.status === "failed") await outcome.released;
      expect(await store.read("r")).toMatchObject({ status: "failed", lastError: "build exceeded its 55000ms deadline" });
      expect((await runWithBuildLease(store, "r", "holder-b", 90_000, second)).status).toBe("built");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the result and releases normally when the build beats the deadline", async () => {
    const { store } = createFakeStore();
    const outcome = await runWithBuildLease(store, "r", "holder-a", 90_000, async () => "ok", { deadlineMs: 55_000 });
    expect(outcome).toEqual({ status: "built", result: "ok" });
    expect((await store.read("r"))?.status).toBe("done");
  });
});
