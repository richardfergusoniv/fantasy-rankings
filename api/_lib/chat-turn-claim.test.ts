import { describe, expect, it, vi } from "vitest";
import type { BuildLeaseRow, BuildLeaseStore } from "./build-lease.js";
import {
  CHAT_TURN_LEASE_MS,
  CHAT_TURN_WAIT_MS,
  chatTurnResource,
  claimChatTurn,
  type ChatTurnClaimDeps,
} from "./chat-turn-claim.js";

/** An in-memory lease store with the same rules as the Postgres one: win only when no live lease exists. */
function memoryStore(clock: { now: number }) {
  const rows = new Map<string, { holder: string; status: "running" | "done" | "failed"; expiresAt: number; lastError: string | null }>();
  const store: BuildLeaseStore = {
    async claim(resource, holder, ttlMs) {
      const row = rows.get(resource);
      if (row && row.status === "running" && row.expiresAt > clock.now) return false;
      rows.set(resource, { holder, status: "running", expiresAt: clock.now + ttlMs, lastError: null });
      return true;
    },
    async finish(resource, holder, error) {
      const row = rows.get(resource);
      if (!row || row.holder !== holder) return;
      rows.set(resource, { ...row, status: error == null ? "done" : "failed", expiresAt: clock.now, lastError: error });
    },
    async read(resource) {
      const row = rows.get(resource);
      return row ? ({ resource, ...row, acquiredAt: new Date(), expiresAt: new Date(row.expiresAt), updatedAt: new Date() } as unknown as BuildLeaseRow) : null;
    },
  };
  return { store, rows };
}

describe("chatTurnResource", () => {
  it("is scoped to the user and the message key", () => {
    expect(chatTurnResource("u1", "m1")).toBe("chat-turn:u1:m1");
    expect(chatTurnResource("u2", "m1")).not.toBe(chatTurnResource("u1", "m1"));
  });
});

describe("claimChatTurn", () => {
  it("lets the first request claim and run the model", async () => {
    const clock = { now: 1_000_000 };
    const { store, rows } = memoryStore(clock);
    const outcome = await claimChatTurn("r", async () => false, {
      store,
      now: () => clock.now,
      sleep: async () => undefined,
      holder: () => "h",
    });
    expect(outcome.status).toBe("claimed");
    expect(rows.get("r")?.status).toBe("running");
  });

  it("two overlapping requests: exactly one runs the model", async () => {
    let stored = false;
    const clock = { now: 1_000_000 };
    const { store } = memoryStore(clock);
    let holders = 0;
    const deps: Partial<ChatTurnClaimDeps> = {
      store,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
        // The winner finishes and stores its turn two seconds in.
        if (clock.now >= 1_002_000) stored = true;
      },
      holder: () => `holder-${++holders}`,
    };
    const turnStored = async () => stored;

    const winner = await claimChatTurn("r", turnStored, deps);
    expect(winner.status).toBe("claimed");
    const retry = await claimChatTurn("r", turnStored, deps);
    expect(retry.status).toBe("replay");
  });

  it("gives up with busy when the original is still running at the deadline", async () => {
    const clock = { now: 1_000_000 };
    const { store } = memoryStore(clock);
    const deps: Partial<ChatTurnClaimDeps> = {
      store,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      holder: (() => {
        let n = 0;
        return () => `holder-${++n}`;
      })(),
    };
    const never = async () => false;
    expect((await claimChatTurn("r", never, deps)).status).toBe("claimed");
    const retry = await claimChatTurn("r", never, deps);
    expect(retry.status).toBe("busy");
    expect(clock.now - 1_000_000).toBeGreaterThanOrEqual(CHAT_TURN_WAIT_MS);
    expect(clock.now - 1_000_000).toBeLessThan(CHAT_TURN_LEASE_MS);
  });

  it("a failed original releases the key at once, so the retry takes over without waiting", async () => {
    const clock = { now: 1_000_000 };
    const { store } = memoryStore(clock);
    let n = 0;
    const deps: Partial<ChatTurnClaimDeps> = {
      store,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      holder: () => `holder-${++n}`,
    };
    const never = async () => false;
    const first = await claimChatTurn("r", never, deps);
    if (first.status !== "claimed") throw new Error("expected a claim");
    await first.release(new Error("model exploded"));

    const before = clock.now;
    const retry = await claimChatTurn("r", never, deps);
    expect(retry.status).toBe("claimed");
    expect(clock.now).toBe(before);
  });

  it("an expired claim from a crashed holder can be taken over", async () => {
    const clock = { now: 1_000_000 };
    const { store } = memoryStore(clock);
    let n = 0;
    const deps: Partial<ChatTurnClaimDeps> = {
      store,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      holder: () => `holder-${++n}`,
    };
    const never = async () => false;
    expect((await claimChatTurn("r", never, deps)).status).toBe("claimed");
    clock.now += CHAT_TURN_LEASE_MS + 1;
    expect((await claimChatTurn("r", never, deps)).status).toBe("claimed");
  });

  it("replays instead of running when the turn was stored between the last check and the claim", async () => {
    const clock = { now: 1_000_000 };
    const { store, rows } = memoryStore(clock);
    const deps: Partial<ChatTurnClaimDeps> = { store, now: () => clock.now, sleep: async () => undefined, holder: () => "h" };
    const outcome = await claimChatTurn("r", async () => true, deps);
    expect(outcome.status).toBe("replay");
    // The claim it briefly took is given back.
    expect(rows.get("r")?.status).toBe("done");
  });

  it("carries on without single-flight when the lease store is unreachable", async () => {
    const store: BuildLeaseStore = {
      claim: async () => {
        throw new Error("relation build_leases does not exist");
      },
      finish: async () => undefined,
      read: async () => null,
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await claimChatTurn("r", async () => false, { store });
    expect(outcome.status).toBe("unavailable");
    spy.mockRestore();
  });
});
