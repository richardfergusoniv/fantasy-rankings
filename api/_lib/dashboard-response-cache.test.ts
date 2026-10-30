import { describe, expect, it, vi } from "vitest";
import {
  createL1DashboardViewStore,
  dashboardDeniedHeaders,
  dashboardResponseTtlSeconds,
  dashboardViewCacheKey,
  dashboardViewResponseHeaders,
  loadCachedDashboardView,
  normalizeRequestedSnapshotVersion,
  remainingDashboardTtlSeconds,
  responseCacheFetchedAtMs,
  type DashboardViewStore,
} from "./dashboard-response-cache.js";

/**
 * Personalized dashboard views no longer use Vercel Runtime Cache at all:
 * the store is an instance-local L1 LRU and Postgres `source_cache` is
 * canonical. These tests pin the L1 contract — absolute deadlines, no
 * cross-user bleed, single-flight origin loads — and assert the module
 * contains zero runtime-cache calls.
 */

const V1 = "2026-10-12T00:00:00.000Z";
const V2 = "2026-10-12T00:10:00.000Z";

describe("module surface", () => {
  it("has no dependency on @vercel/functions runtime cache", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./dashboard-response-cache.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toContain("getCache");
    expect(source).not.toContain("@vercel/functions");
    // The lane/pointer protocol identifiers are gone for good.
    for (const dead of ["dashboardViewLaneKey", "readLanePointers", "pointDashboardViewAtVersion", "lanesForVersion"]) {
      expect(source).not.toContain(dead);
    }
  });
});

describe("keys and version hints", () => {
  it("scopes keys to user + view (no version, no lanes)", () => {
    const key = dashboardViewCacheKey("user-a", "players");
    expect(key).toContain("user-a");
    expect(key).toContain("players");
    expect(key).not.toBe(dashboardViewCacheKey("user-b", "players"));
    expect(key).not.toBe(dashboardViewCacheKey("user-a", "trade"));
  });

  it("normalizes requested versions", () => {
    expect(normalizeRequestedSnapshotVersion(null)).toBeNull();
    expect(normalizeRequestedSnapshotVersion("  ")).toBeNull();
    expect(normalizeRequestedSnapshotVersion(" a ".repeat(30))).toBeNull(); // oversized
    expect(normalizeRequestedSnapshotVersion(` ${V1} `)).toBe(V1);
  });
});

describe("TTL arithmetic (absolute deadlines, never extended)", () => {
  it("caps at the view TTL and the row's own freshness", () => {
    expect(dashboardResponseTtlSeconds(false)).toBe(600);
    expect(dashboardResponseTtlSeconds(true)).toBe(150);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 0, live: false })).toBe(600);
    // Half the window elapsed: only the remainder is cacheable.
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 300_000, live: false })).toBe(300);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 600_000, live: false })).toBe(0);
    // Live snapshot uses the live window even mid-TTL.
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 300_000, live: true })).toBe(0);
  });

  it("stamps fetchedAt by outcome without restarting freshness", () => {
    expect(responseCacheFetchedAtMs("built", 1_000)).toBe(1_000);
    expect(responseCacheFetchedAtMs("fresh", 1_000, 500)).toBe(500);
    expect(responseCacheFetchedAtMs("fallback", 1_000)).toBe(0);
  });
});

describe("L1 store", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    version: V1,
    live: false,
    expiresAtMs: 10_000,
    body: { dashboard: "x" },
    ...over,
  });

  it("serves entries until their absolute expiry, then never again", async () => {
    let now = 0;
    const store = createL1DashboardViewStore({ now: () => now });
    await store.set("k", entry(), 10); // 10s TTL
    expect(await store.get("k")).toMatchObject({ version: V1 });
    now = 9_999;
    expect(await store.get("k")).not.toBeNull();
    now = 10_000;
    expect(await store.get("k")).toBeNull(); // expired entries are not served
    now = 20_000;
    expect(await store.get("k")).toBeNull();
  });

  it("evicts least-recently-used entries past the byte cap", async () => {
    const store = createL1DashboardViewStore({ maxBytes: 1_000 });
    const body = { s: "x".repeat(80) }; // ~340 B/entry incl. overhead
    await store.set("a", entry({ body }), 600);
    await store.set("b", entry({ body }), 600);
    await store.set("c", entry({ body }), 600); // pushes past the cap → evicts a
    expect(await store.get("a")).toBeNull();
    expect(await store.get("c")).not.toBeNull();
  });

  it("refreshes recency on hit so hot entries survive eviction", async () => {
    const store = createL1DashboardViewStore({ maxBytes: 800 });
    const body = { s: "x".repeat(70) };
    await store.set("a", entry({ body }), 600);
    await store.set("b", entry({ body }), 600);
    await store.get("a"); // a is now hottest
    await store.set("c", entry({ body }), 600); // evicts b, not a
    expect(await store.get("a")).not.toBeNull();
    expect(await store.get("b")).toBeNull();
  });

  it("rejects bodies that alone exceed the cap", async () => {
    const store = createL1DashboardViewStore({ maxBytes: 64 });
    expect(await store.set("big", entry({ body: { s: "x".repeat(1_000) } }), 600)).toBe(false);
    expect(await store.get("big")).toBeNull();
  });

  it("passes through entirely when bypassed (DASHBOARD_L1_BYPASS)", async () => {
    const store = createL1DashboardViewStore({ bypass: true });
    expect(await store.set("k", entry(), 600)).toBe(false);
    expect(await store.get("k")).toBeNull();
  });

  it("never extends a stored expiry on overwrite (a new entry stamps its own deadline)", async () => {
    let now = 0;
    const store = createL1DashboardViewStore({ now: () => now });
    await store.set("k", entry({ version: V1 }), 10);
    now = 9_999; // near expiry
    await store.set("k", entry({ version: V2 }), 10);
    now = 10_001; // old deadline gone; the new entry stamps its own expiry
    expect(await store.get("k")).toMatchObject({ version: V2, expiresAtMs: 9_999 + 10_000 });
    now = 20_000;
    expect(await store.get("k")).toBeNull();
  });
});

describe("headers", () => {
  it("always keeps shared-CDN no-store and private scope", () => {
    for (const h of [
      dashboardDeniedHeaders(),
      dashboardViewResponseHeaders({ cache: "HIT", cacheable: true, version: V1, live: false }),
      dashboardViewResponseHeaders({ cache: "MISS", cacheable: false, version: null, live: false }),
    ]) {
      expect(h["CDN-Cache-Control"]).toBe("no-store");
      expect(h["Vercel-CDN-Cache-Control"]).toBe("no-store");
      expect(h["Cache-Control"]).toContain("private");
    }
    const hit = dashboardViewResponseHeaders({ cache: "HIT", cacheable: true, version: V1, live: false });
    expect(hit["Cache-Control"]).toBe("private, max-age=0, must-revalidate");
    expect(hit["X-Dashboard-Snapshot"]).toBe(V1);
  });
});

describe("loadCachedDashboardView", () => {
  const value = (version: string, ttlSeconds = 600) => ({
    kind: "value" as const,
    body: { section: "players", data: 1 },
    version,
    live: false,
    ttlSeconds,
  });

  it("401s signed-out callers before touching cache or origin", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn();
    const loaded = await loadCachedDashboardView({
      sleeperUserId: null,
      view: "players",
      requestedVersion: null,
      store,
      loadOrigin,
    });
    expect(loaded).toMatchObject({ ok: false, status: 401 });
    expect(loadOrigin).not.toHaveBeenCalled();
    expect(await store.get(dashboardViewCacheKey("x", "players"))).toBeNull();
  });

  it("misses cold, loads origin once, then hits L1", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn(async () => value(V1));
    const args = {
      sleeperUserId: "u1",
      view: "players" as const,
      requestedVersion: null,
      store,
      loadOrigin,
    };
    const first = await loadCachedDashboardView(args);
    expect(first).toMatchObject({ ok: true, cache: "MISS", version: V1 });
    const second = await loadCachedDashboardView(args);
    expect(second).toMatchObject({ ok: true, cache: "HIT", version: V1 });
    expect(loadOrigin).toHaveBeenCalledTimes(1);
  });

  it("runs one origin load for concurrent requests on the same scope", async () => {
    const store = createL1DashboardViewStore();
    let resolve!: (v: ReturnType<typeof value>) => void;
    const loadOrigin = vi.fn(() => new Promise<ReturnType<typeof value>>((r) => { resolve = r; }));
    const args = {
      sleeperUserId: "u1",
      view: "players" as const,
      requestedVersion: null,
      store,
      loadOrigin,
    };
    const p1 = loadCachedDashboardView(args);
    const p2 = loadCachedDashboardView(args);
    const p3 = loadCachedDashboardView(args);
    // loadOrigin runs on the microtask after the L1 miss path.
    await new Promise((r) => setTimeout(r, 0));
    resolve(value(V1));
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(loadOrigin).toHaveBeenCalledTimes(1);
    for (const r of [r1, r2, r3]) expect(r).toMatchObject({ ok: true, version: V1 });
  });

  it("does not let a forced load join a plain one in flight", async () => {
    const store = createL1DashboardViewStore();
    let resolvePlain!: (v: ReturnType<typeof value>) => void;
    const plainOrigin = vi.fn(() => new Promise<ReturnType<typeof value>>((r) => { resolvePlain = r; }));
    const forcedOrigin = vi.fn(async () => value(V2));
    const base = { sleeperUserId: "u1", view: "full" as const, requestedVersion: null, store };
    const plain = loadCachedDashboardView({ ...base, loadOrigin: plainOrigin });
    const forced = loadCachedDashboardView({ ...base, force: true, loadOrigin: forcedOrigin });
    await new Promise((r) => setTimeout(r, 0));
    resolvePlain(value(V1));
    expect(await plain).toMatchObject({ ok: true, version: V1 });
    expect(await forced).toMatchObject({ ok: true, version: V2 });
    expect(forcedOrigin).toHaveBeenCalledTimes(1);
  });

  it("does not share single-flight across users or views", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn(async () => value(V1));
    const base = { requestedVersion: null, store, loadOrigin };
    await Promise.all([
      loadCachedDashboardView({ ...base, sleeperUserId: "u1", view: "players" }),
      loadCachedDashboardView({ ...base, sleeperUserId: "u2", view: "players" }),
      loadCachedDashboardView({ ...base, sleeperUserId: "u1", view: "team" }),
    ]);
    expect(loadOrigin).toHaveBeenCalledTimes(3);
  });

  it("isolates entries between users", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn(async () => value(V1));
    await loadCachedDashboardView({
      sleeperUserId: "u1",
      view: "players",
      requestedVersion: null,
      store,
      loadOrigin,
    });
    const other = await loadCachedDashboardView({
      sleeperUserId: "u2",
      view: "players",
      requestedVersion: null,
      store,
      loadOrigin,
    });
    expect(other).toMatchObject({ cache: "MISS" });
  });

  it("rejects on the origin error path and clears the flight slot (failed promises are removed)", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(value(V1));
    const args = {
      sleeperUserId: "u1",
      view: "players" as const,
      requestedVersion: null,
      store,
      loadOrigin,
    };
    await expect(loadCachedDashboardView(args)).rejects.toThrow("boom");
    // The rejection was not cached in the flight map or L1: retry loads again.
    const retry = await loadCachedDashboardView(args);
    expect(retry).toMatchObject({ ok: true, version: V1 });
    expect(loadOrigin).toHaveBeenCalledTimes(2);
  });

  it("a stored entry near expiry keeps its deadline; a new version stores a fresh entry", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn()
      .mockResolvedValueOnce({ ...value(V1), ttlSeconds: 1 }) // 1s TTL
      .mockResolvedValueOnce(value(V2, 600));
    const args = {
      sleeperUserId: "u1",
      view: "players" as const,
      requestedVersion: null,
      store,
      loadOrigin,
    };
    await loadCachedDashboardView(args);
    await new Promise((r) => setTimeout(r, 1_100));
    // Expired entry is not served; the next load re-fetches origin.
    const next = await loadCachedDashboardView(args);
    expect(next).toMatchObject({ cache: "MISS", version: V2 });
    expect(loadOrigin).toHaveBeenCalledTimes(2);
  });

  it("misses when the requested version differs from the stored one", async () => {
    const store = createL1DashboardViewStore();
    const loadOrigin = vi.fn()
      .mockResolvedValueOnce(value(V1))
      .mockResolvedValueOnce(value(V2));
    const args = { sleeperUserId: "u1", view: "players" as const, store, loadOrigin };
    await loadCachedDashboardView({ ...args, requestedVersion: null });
    const loaded = await loadCachedDashboardView({ ...args, requestedVersion: V2 });
    expect(loaded).toMatchObject({ cache: "MISS", version: V2 });
    expect(loadOrigin).toHaveBeenCalledTimes(2);
  });

  it("never emits personalized Runtime Cache traffic (store ops are L1-only)", async () => {
    const ops: string[] = [];
    const inner = createL1DashboardViewStore();
    const store: DashboardViewStore = {
      get: async (k) => { ops.push(`get:${k}`); return inner.get(k); },
      set: async (k, v, ttl) => { ops.push(`set:${k}`); return inner.set(k, v, ttl); },
    };
    await loadCachedDashboardView({
      sleeperUserId: "u1",
      view: "players",
      requestedVersion: null,
      store,
      loadOrigin: async () => value(V1),
    });
    await loadCachedDashboardView({
      sleeperUserId: "u1",
      view: "players",
      requestedVersion: null,
      store,
      loadOrigin: async () => value(V1),
    });
    // One versioned-latest key per user+view; no lane probes, no pointer ops,
    // no version-suffixed body keys.
    for (const op of ops) {
      expect(op).not.toContain("lane");
      expect(op).not.toContain("pointer");
      expect(op).not.toContain("latest");
    }
    expect(ops.filter((o) => o.startsWith("get:"))).toHaveLength(2);
    expect(ops.filter((o) => o.startsWith("set:"))).toHaveLength(1);
  });
});
