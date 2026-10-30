import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishSharedBoard,
  readSharedBoard,
  registerSharedBoardDataset,
  resetSharedBoardCachesForTests,
  sharedBoardCacheKey,
} from "./shared-board-cache.js";
import type { SleeperPicksBoard } from "./sleeper-picks.js";

type RuntimeDouble = {
  store: Map<string, unknown>;
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, options: { ttl: number; name: string }) => Promise<unknown>;
  fail?: boolean;
};

function runtimeDouble(): RuntimeDouble {
  const rt: RuntimeDouble = {
    store: new Map(),
    async get(key) {
      if (rt.fail) throw new Error("cache down");
      return rt.store.get(key);
    },
    async set(key, value) {
      if (rt.fail) throw new Error("cache down");
      rt.store.set(key, value);
    },
  };
  return rt;
}

const board: SleeperPicksBoard = {
  pulledAt: "2026-10-29T12:00:00.000Z",
  lines: [
    { playerId: "p1", stat: "pass_yards", line: 250.5, overMultiplier: 1.0, underMultiplier: 1.0 },
  ],
};
const SOURCE_AGE = new Date(board.pulledAt).getTime();

beforeEach(() => {
  resetSharedBoardCachesForTests();
  delete process.env.VERCEL_ENV;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("publishSharedBoard", () => {
  it("publishes an allowlisted dataset with a finite TTL and source-age envelope", async () => {
    const rt = runtimeDouble();
    const result = await publishSharedBoard("sleeper-picks", "2026:9", board, SOURCE_AGE, rt);
    expect(result).toEqual({ published: true, key: "shared:sleeper-picks:2026:9", encodedBytes: expect.any(Number) });
    const stored = rt.store.get("shared:sleeper-picks:2026:9") as { sourceAgeMs: number; payload: unknown };
    expect(stored.sourceAgeMs).toBe(SOURCE_AGE);
    expect(stored.payload).toEqual(board);
  });

  it("rejects datasets outside the allowlist", async () => {
    const rt = runtimeDouble();
    const result = await publishSharedBoard("user-dashboard", "u1", board, SOURCE_AGE, rt);
    expect(result).toEqual({ published: false, key: "shared:user-dashboard:u1", reason: "unknown_dataset" });
    expect(rt.store.size).toBe(0);
  });

  it("rejects scopes containing user identifiers", async () => {
    const rt = runtimeDouble();
    for (const scope of ["user-123", "abcuser", "bad scope", "x".repeat(200)]) {
      const result = await publishSharedBoard("sleeper-picks", scope, board, SOURCE_AGE, rt);
      expect(result.published).toBe(false);
      expect((result as { reason: string }).reason).toBe("invalid_scope");
    }
    expect(rt.store.size).toBe(0);
  });

  it("rejects payloads that fail dataset schema validation", async () => {
    const rt = runtimeDouble();
    const result = await publishSharedBoard("sleeper-picks", "2026:9", { not: "a board" }, SOURCE_AGE, rt);
    expect(result).toMatchObject({ published: false, reason: "invalid_payload" });
    expect(rt.store.size).toBe(0);
  });

  it("rejects oversized payloads before SDK submission", async () => {
    const rt = runtimeDouble();
    registerSharedBoardDataset({
      id: "tiny",
      ttlSeconds: 60,
      maxEncodedBytes: 64,
      validate: () => true,
    });
    const result = await publishSharedBoard("tiny", "s", board, SOURCE_AGE, rt);
    expect(result).toMatchObject({ published: false, reason: "oversized" });
    expect(rt.store.size).toBe(0);
  });

  it("never publishes on preview deployments", async () => {
    process.env.VERCEL_ENV = "preview";
    const rt = runtimeDouble();
    const result = await publishSharedBoard("sleeper-picks", "2026:9", board, SOURCE_AGE, rt);
    expect(result).toMatchObject({ published: false, reason: "preview" });
    expect(rt.store.size).toBe(0);
  });

  it("serializes writes: an older source cannot overwrite a newer publication", async () => {
    const rt = runtimeDouble();
    const newer = { ...board, pulledAt: "2026-10-29T13:00:00.000Z" };
    const newerAge = new Date(newer.pulledAt).getTime();
    // Interleave so the older job's read-check-write races the newer publish.
    const slowNewer = publishSharedBoard("sleeper-picks", "2026:9", newer, newerAge, rt);
    const older = publishSharedBoard("sleeper-picks", "2026:9", board, SOURCE_AGE, rt);
    const [newerResult, olderResult] = await Promise.all([slowNewer, older]);
    expect(newerResult).toMatchObject({ published: true });
    expect(olderResult).toMatchObject({ published: false, reason: "stale_source" });
    const stored = rt.store.get("shared:sleeper-picks:2026:9") as { sourceAgeMs: number };
    expect(stored.sourceAgeMs).toBe(newerAge);
  });

  it("treats a runtime failure as nonfatal", async () => {
    const rt = runtimeDouble();
    rt.fail = true;
    const result = await publishSharedBoard("sleeper-picks", "2026:9", board, SOURCE_AGE, rt);
    expect(result).toMatchObject({ published: false, reason: "runtime_error" });
  });
});

describe("readSharedBoard", () => {
  it("serves a published value from runtime cache then L1", async () => {
    const rt = runtimeDouble();
    await publishSharedBoard("sleeper-picks", "2026:9", board, SOURCE_AGE, rt);
    let durableCalls = 0;
    const read1 = await readSharedBoard("sleeper-picks", "2026:9", async () => {
      durableCalls += 1;
      return null;
    }, rt);
    // Fresh publish already populated L1.
    expect(read1.source).toBe("l1");
    expect(read1.envelope?.payload).toEqual(board);
    expect(durableCalls).toBe(0);
    // Clear L1 only: drop and re-read hits runtime.
    resetSharedBoardCachesForTests();
    const read2 = await readSharedBoard("sleeper-picks", "2026:9", async () => {
      durableCalls += 1;
      return null;
    }, rt);
    expect(read2.source).toBe("runtime");
    expect(durableCalls).toBe(0);
  });

  it("uses the bounded durable fallback after cache eviction", async () => {
    const rt = runtimeDouble();
    const read = await readSharedBoard("sleeper-picks", "2026:9", async () => ({
      payload: board,
      sourceAgeMs: SOURCE_AGE,
    }), rt);
    expect(read.source).toBe("durable");
    expect(read.envelope?.payload).toEqual(board);
    expect(read.envelope?.sourceAgeMs).toBe(SOURCE_AGE);
  });

  it("misses cleanly when nothing is stored anywhere", async () => {
    const rt = runtimeDouble();
    const read = await readSharedBoard("sleeper-picks", "2026:9", async () => null, rt);
    expect(read).toEqual({ envelope: null, source: "miss" });
  });

  it("keeps serving from durable when the runtime cache is down", async () => {
    const rt = runtimeDouble();
    rt.fail = true;
    const read = await readSharedBoard("sleeper-picks", "2026:9", async () => ({
      payload: board,
      sourceAgeMs: SOURCE_AGE,
    }), rt);
    expect(read.source).toBe("durable");
    expect(read.envelope?.payload).toEqual(board);
  });

  it("shared keys carry no user identifiers", () => {
    expect(sharedBoardCacheKey("sleeper-picks", "2026:9")).toBe("shared:sleeper-picks:2026:9");
  });
});
