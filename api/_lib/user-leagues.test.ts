import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimitMock = vi.fn();
const insertConflictMock = vi.fn();
const fetchJsonMock = vi.fn();

vi.mock("./db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimitMock })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: insertConflictMock })),
    })),
  },
  schema: {
    sourceCache: { cacheKey: "cache_key", payload: "payload", fetchedAt: "fetched_at" },
  },
}));

vi.mock("./sleeper.js", () => ({
  SLEEPER_BASE: "https://api.sleeper.app/v1",
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { encodeSourceCachePayload } from "./source-cache-payload.js";
import { leagueDataTtlMs } from "./league-relevance.js";
import { readNflState, readUserLeagues } from "./user-leagues.js";

const nflState = { season: 2026, week: 4, seasonType: "regular" };
const priorSeasonNflState = { season: 2025, week: 18, seasonType: "post" };
const leagues = [
  {
    league_id: "lg-mine",
    name: "Mine",
    total_rosters: 12,
    roster_positions: ["QB"],
    scoring_settings: { rec: 0.5 },
    settings: { type: 0 },
  },
];

beforeEach(() => {
  selectLimitMock.mockReset();
  insertConflictMock.mockReset().mockResolvedValue(undefined);
  fetchJsonMock.mockReset();
});

describe("readNflState allowStaleOnError", () => {
  it("fails closed when refresh fails and cached NFL state is expired", async () => {
    const expired = new Date(Date.now() - leagueDataTtlMs() - 60_000);
    selectLimitMock.mockResolvedValueOnce([{
      cacheKey: "sleeper-nfl-state-v1",
      payload: encodeSourceCachePayload(priorSeasonNflState),
      fetchedAt: expired,
    }]);
    fetchJsonMock.mockRejectedValue(new Error("Sleeper NFL state down"));

    await expect(readNflState(false, { allowStaleOnError: false }))
      .rejects.toThrow(/Sleeper NFL state down/);
  });

  it("keeps expired NFL state fallback by default", async () => {
    const expired = new Date(Date.now() - leagueDataTtlMs() - 60_000);
    selectLimitMock.mockResolvedValueOnce([{
      cacheKey: "sleeper-nfl-state-v1",
      payload: encodeSourceCachePayload(priorSeasonNflState),
      fetchedAt: expired,
    }]);
    fetchJsonMock.mockRejectedValue(new Error("Sleeper NFL state down"));

    await expect(readNflState()).resolves.toEqual(priorSeasonNflState);
  });
});

describe("readUserLeagues allowStaleOnError", () => {
  it("fails closed when refresh fails and the cached league list is expired", async () => {
    const expired = new Date(Date.now() - leagueDataTtlMs() - 60_000);
    selectLimitMock
      .mockResolvedValueOnce([{
        cacheKey: "sleeper-nfl-state-v1",
        payload: encodeSourceCachePayload(nflState),
        fetchedAt: new Date(),
      }])
      .mockResolvedValueOnce([{
        cacheKey: "sleeper-user-leagues-v1:user-1:2026",
        payload: encodeSourceCachePayload(leagues),
        fetchedAt: expired,
      }]);
    fetchJsonMock.mockRejectedValue(new Error("Sleeper down"));

    await expect(readUserLeagues("user-1", false, { allowStaleOnError: false }))
      .rejects.toThrow(/Sleeper down/);
  });

  it("fails closed when NFL state is expired so membership cannot use a prior season", async () => {
    const expired = new Date(Date.now() - leagueDataTtlMs() - 60_000);
    selectLimitMock.mockResolvedValueOnce([{
      cacheKey: "sleeper-nfl-state-v1",
      payload: encodeSourceCachePayload(priorSeasonNflState),
      fetchedAt: expired,
    }]);
    fetchJsonMock.mockRejectedValue(new Error("Sleeper NFL state down"));

    await expect(readUserLeagues("user-1", false, { allowStaleOnError: false }))
      .rejects.toThrow(/Sleeper NFL state down/);
    // Must not proceed to a prior-season leagues endpoint/cache key.
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(String(fetchJsonMock.mock.calls[0]?.[0])).toContain("/state/nfl");
  });

  it("uses a still-fresh cached list without requiring a live refresh", async () => {
    selectLimitMock
      .mockResolvedValueOnce([{
        cacheKey: "sleeper-nfl-state-v1",
        payload: encodeSourceCachePayload(nflState),
        fetchedAt: new Date(),
      }])
      .mockResolvedValueOnce([{
        cacheKey: "sleeper-user-leagues-v1:user-1:2026",
        payload: encodeSourceCachePayload(leagues),
        fetchedAt: new Date(),
      }]);

    const result = await readUserLeagues("user-1", false, { allowStaleOnError: false });
    expect(result.leagues).toEqual(leagues);
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("keeps stale fallback for non-auth callers by default", async () => {
    const expired = new Date(Date.now() - leagueDataTtlMs() - 60_000);
    selectLimitMock
      .mockResolvedValueOnce([{
        cacheKey: "sleeper-nfl-state-v1",
        payload: encodeSourceCachePayload(nflState),
        fetchedAt: new Date(),
      }])
      .mockResolvedValueOnce([{
        cacheKey: "sleeper-user-leagues-v1:user-1:2026",
        payload: encodeSourceCachePayload(leagues),
        fetchedAt: expired,
      }]);
    fetchJsonMock.mockRejectedValue(new Error("Sleeper down"));

    const result = await readUserLeagues("user-1");
    expect(result.leagues).toEqual(leagues);
  });
});
