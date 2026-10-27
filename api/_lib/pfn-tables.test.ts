import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimitMock = vi.fn();
const insertConflictMock = vi.fn();
const fetchTextMock = vi.fn();
const resolveSleeperUserIdMock = vi.fn();
const hasCronSecretMock = vi.fn();

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
  fetchText: (...args: unknown[]) => fetchTextMock(...args),
}));

vi.mock("./auth.js", () => ({
  resolveSleeperUserId: (...args: unknown[]) => resolveSleeperUserIdMock(...args),
}));

vi.mock("./api-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./api-utils.js")>("./api-utils.js");
  return {
    ...actual,
    hasCronSecret: (...args: unknown[]) => hasCronSecretMock(...args),
  };
});

import { encodeSourceCachePayload } from "./source-cache-payload.js";
import {
  handlePfnTables,
  loadTeamWeekStats,
  resetTeamWeekStatsCaches,
} from "./pfn-tables.js";

const SEASON = 2026;

function statsCsv(): string {
  return [
    "player_id,player_display_name,position,team,week,season_type,targets,receptions,receiving_yards,fantasy_points_ppr",
    "p1,Test Player,WR,KC,1,REG,8,5,80,19",
  ].join("\n");
}

function snapsCsv(): string {
  return [
    "game_type,week,player,team,position,offense_snaps,offense_pct",
    "REG,1,Test Player,KC,WR,50,0.8",
  ].join("\n");
}

function storedRow(season: number, fetchedAt: Date, payload: unknown) {
  return {
    cacheKey: `team-week-stats:${season}`,
    payload: encodeSourceCachePayload(payload),
    fetchedAt,
  };
}

beforeEach(() => {
  resetTeamWeekStatsCaches();
  selectLimitMock.mockReset().mockResolvedValue([]);
  insertConflictMock.mockReset().mockResolvedValue(undefined);
  fetchTextMock.mockReset();
  resolveSleeperUserIdMock.mockReset().mockResolvedValue("sleeper-1");
  hasCronSecretMock.mockReset().mockReturnValue(false);
});

describe("loadTeamWeekStats", () => {
  it("serves a fresh shared source_cache row without fetching upstream", async () => {
    const payload = { season: SEASON, stats: [{ player_id: "p1" }], snaps: [{ pfr_player_id: "p1" }] };
    selectLimitMock.mockResolvedValue([storedRow(SEASON, new Date(), payload)]);

    const result = await loadTeamWeekStats(SEASON);
    expect(result).toEqual(payload);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it("runs a single upstream fetch+parse for concurrent requests", async () => {
    selectLimitMock.mockResolvedValue([]);
    fetchTextMock.mockImplementation(async (url: string) =>
      url.includes("snap_counts") ? snapsCsv() : statsCsv());

    const [a, b] = await Promise.all([loadTeamWeekStats(SEASON), loadTeamWeekStats(SEASON)]);
    expect(a).toEqual(b);
    expect(fetchTextMock).toHaveBeenCalledTimes(2);
  });

  it("serves the last stored payload when the upstream fetch fails", async () => {
    const stale = {
      season: SEASON,
      stats: [{ player_id: "old" }],
      snaps: [{ pfr_player_id: "p1" }],
    };
    selectLimitMock.mockResolvedValue([
      storedRow(SEASON, new Date(Date.now() - 24 * 60 * 60 * 1000), stale),
    ]);
    fetchTextMock.mockRejectedValue(new Error("upstream down"));

    const result = await loadTeamWeekStats(SEASON);
    expect(result).toEqual(stale);
  });

  it("prefers a complete stale payload over a fresh partial one, and caches the fallback", async () => {
    const stale = { season: SEASON, stats: [{ player_id: "old" }], snaps: [{ pfr_player_id: "p1" }] };
    selectLimitMock.mockResolvedValue([storedRow(SEASON, new Date(Date.now() - 24 * 60 * 60 * 1000), stale)]);
    fetchTextMock.mockImplementation(async (url: string) => {
      if (url.includes("snap_counts")) throw new Error("snaps down");
      return statsCsv();
    });

    expect(await loadTeamWeekStats(SEASON)).toEqual(stale);
    fetchTextMock.mockClear();
    // Within the degraded TTL the fallback comes from memory, not the upstream.
    expect(await loadTeamWeekStats(SEASON)).toEqual(stale);
    expect(fetchTextMock).not.toHaveBeenCalled();
    expect(insertConflictMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated team-week-stats requests before fetching", async () => {
    resolveSleeperUserIdMock.mockResolvedValue(null);
    hasCronSecretMock.mockReturnValue(false);

    const res = await handlePfnTables(
      new Request(`https://example.com/api/pfn-tables?team-week-stats=1&season=${SEASON}`),
    );
    expect(res.status).toBe(401);
    expect(fetchTextMock).not.toHaveBeenCalled();
    expect(insertConflictMock).not.toHaveBeenCalled();
  });

  it("allows cron-authenticated team-week-stats without a Sleeper session", async () => {
    resolveSleeperUserIdMock.mockResolvedValue(null);
    hasCronSecretMock.mockReturnValue(true);
    selectLimitMock.mockResolvedValue([]);
    fetchTextMock.mockImplementation(async (url: string) =>
      url.includes("snap_counts") ? snapsCsv() : statsCsv());

    const res = await handlePfnTables(
      new Request(`https://example.com/api/pfn-tables?team-week-stats=1&season=${SEASON}`),
    );
    expect(res.status).toBe(200);
    expect(fetchTextMock).toHaveBeenCalled();
  });

  it("returns a controlled 500 when upstream fails and nothing is cached", async () => {
    selectLimitMock.mockResolvedValue([]);
    fetchTextMock.mockRejectedValue(new Error("upstream down"));

    const res = await handlePfnTables(
      new Request(`https://example.com/api/pfn-tables?team-week-stats=1&season=${SEASON}`),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("persists complete payloads into source_cache for other instances", async () => {
    selectLimitMock.mockResolvedValue([]);
    fetchTextMock.mockImplementation(async (url: string) =>
      url.includes("snap_counts") ? snapsCsv() : statsCsv());

    let writeLanded = false;
    insertConflictMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      writeLanded = true;
    });

    const result = await loadTeamWeekStats(SEASON);
    expect(result.stats.length).toBeGreaterThan(0);
    // Awaited, not fire-and-forget: the row has landed before the load
    // resolves, so a frozen serverless instance can't drop it.
    expect(writeLanded).toBe(true);
  });
});
