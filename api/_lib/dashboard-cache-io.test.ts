import { describe, expect, it } from "vitest";
import {
  buildDashboardCacheWrites,
  dashboardFromSectionRows,
  DASHBOARD_CACHE_SECTIONS,
  resolveSectionHitFromRows,
  splitDashboardIntoSections,
  userDashboardSectionCacheKey,
  wrapSectionEnvelope,
  type SourceCacheRowLike,
} from "./dashboard-section-cache.js";
import {
  parseStoredSectionData,
  sectionCacheTtlMs,
} from "./dashboard-build.js";
import {
  serializeDashboardForCache,
  type Dashboard,
} from "./dashboard-schemas.js";
import {
  decodeSourceCachePayload,
  encodeSourceCachePayload,
} from "./source-cache-payload.js";

const sampleRanking = {
  leagueId: "league-1",
  playerId: "player-1",
  name: "Test Player",
  team: "KC",
  opponent: "BUF",
  isAway: false,
  isBye: false,
  position: "QB" as const,
  pprRank: 1,
  halfPprRank: 1,
  leagueRank: 1,
  ppr: 20,
  halfPpr: 20,
  standard: 18,
  leagueProjection: 20,
  vegasProjection: 20,
  sleeperProjection: 19,
  projectionSource: "vegas" as const,
  projectionComponents: null,
  injuryStatus: null,
  gameTime: null,
  actual: null,
  gamePhase: null,
};

const sampleDashboard: Dashboard = {
  status: "ok",
  season: 2026,
  week: 6,
  asOf: "2026-10-12T00:00:00.000Z",
  rankingsAsOf: null,
  fantasyCalcAsOf: null,
  playerTrending: {},
  playerInsights: { depth: {}, depthAsOf: null, depthPrevious: {} },
  leagues: [
    {
      id: "league-1",
      name: "Test League",
      scoringLabel: "PPR",
      rankingField: "ppr",
      record: { wins: 1, losses: 0, ties: 0 },
      teamActual: null,
      teamProjection: 100,
      starters: [],
      bench: [],
      opponentTeam: null,
      suggestion: null,
      rosteredPlayerIds: ["player-1"],
      rosterAssignments: [{ playerId: "player-1", teamName: "Mine", isUser: true }],
      rankingPositions: ["QB", "RB", "WR", "TE"],
      showSuperFilter: false,
      seasonLongFormat: {
        key: "redraft-1qb-12t-1ppr",
        isDynasty: false,
        numQbs: 1,
        numTeams: 12,
        ppr: 1,
        label: "Redraft · 12-team · 1QB · PPR",
      },
      tradeValuation: {
        unsupportedSettings: [],
        projectionAsOf: null,
        optimizerVersion: "lineup-dp-v1",
      },
      tradeTeams: [
        {
          rosterId: 1,
          ownerId: "u1",
          teamName: "Mine",
          isUser: true,
          players: [],
          ownedPicks: [],
        },
      ],
      tradeWaiverPool: [],
      tradeStarterSlots: ["QB", "RB"],
      powerRankingsWeek: [],
      powerRankingsSeasonLong: [],
      standings: [],
      playoffs: { teams: null, weekStart: null },
      waivers: null,
      powerRankingsDynasty: [],
    },
  ],
  rankings: [sampleRanking],
  weeklyChartRankings: [sampleRanking],
  seasonLongRankings: [],
  defenses: [],
  analytics: {
    asOf: null,
    throughWeek: null,
    sourceUrl: "https://example.test",
    entities: [],
    teamUsage: [],
    teamRecords: [],
  },
  gameLines: [],
  strengthOfSchedule: [],
  sourceErrors: [],
};

function writesAsRows(writes: ReturnType<typeof buildDashboardCacheWrites>): SourceCacheRowLike[] {
  return writes.map((write) => ({
    cacheKey: write.cacheKey,
    payload: write.payload,
    fetchedAt: write.fetchedAt,
  }));
}

describe("writeUserDashboardCache payload set (buildDashboardCacheWrites)", () => {
  it("writes only the seven section keys for a per-user key (no duplicate full row)", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: sampleDashboard,
      fetchedAt,
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const keys = writes.map((row) => row.cacheKey);
    // The per-user full row doubled snapshot bytes; it is no longer written.
    expect(keys).not.toContain("dashboard:user:user-1");
    for (const section of DASHBOARD_CACHE_SECTIONS) {
      expect(keys).toContain(userDashboardSectionCacheKey("user-1", section));
    }
    expect(writes).toHaveLength(DASHBOARD_CACHE_SECTIONS.length);
  });

  it("keeps trending adds and the upcoming schedule in the players row", () => {
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: { ...sampleDashboard, playerTrending: { "player-1": { adds: 1200, drops: null } }, upcomingGames: { DAL: [{ week: 8, opponent: "ARI", isAway: false }] } },
      fetchedAt: new Date("2026-10-12T03:00:00.000Z"),
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const players = writes.find((row) => row.cacheKey === userDashboardSectionCacheKey("user-1", "players"));
    const envelope = decodeSourceCachePayload(players!.payload) as { data: { playerTrending?: unknown; upcomingGames?: unknown } };
    expect(envelope.data.playerTrending).toEqual({ "player-1": { adds: 1200, drops: null } });
    expect(envelope.data.upcomingGames).toEqual({ DAL: [{ week: 8, opponent: "ARI", isAway: false }] });
  });

  it("only writes the full key for the global snapshot", () => {
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard-live-projections-v25",
      dashboard: sampleDashboard,
      fetchedAt: new Date(),
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.cacheKey).toBe("dashboard-live-projections-v25");
  });
});

describe("readAllUserDashboardSections (dashboardFromSectionRows)", () => {
  it("assembles a dashboard from matching section rows", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: sampleDashboard,
      fetchedAt,
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const sectionRows = writesAsRows(writes).filter((row) => row.cacheKey !== "dashboard:user:user-1");
    const hit = dashboardFromSectionRows({
      sleeperUserId: "user-1",
      rows: sectionRows,
      decode: decodeSourceCachePayload,
      parseSectionData: parseStoredSectionData,
      nowMs: fetchedAt.getTime() + 1_000,
      ttlMs: sectionCacheTtlMs,
    });
    expect(hit).not.toBeNull();
    expect(hit!.fresh).toBe(true);
    expect(hit!.dashboard.leagues[0]?.tradeTeams).toHaveLength(1);
    expect(hit!.dashboard.weeklyChartRankings).toEqual(sampleDashboard.rankings);
  });

  it("keeps player insights through the players section", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const playerInsights = {
      depth: { "player-1": { position: "QB", rank: 1 } },
      depthAsOf: "2026-10-12T00:00:00Z",
      depthPrevious: { "player-1": { position: "QB", rank: 2 } },
    };
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: { ...sampleDashboard, playerInsights },
      fetchedAt,
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const hit = dashboardFromSectionRows({
      sleeperUserId: "user-1",
      rows: writesAsRows(writes).filter((row) => row.cacheKey !== "dashboard:user:user-1"),
      decode: decodeSourceCachePayload,
      parseSectionData: parseStoredSectionData,
      nowMs: fetchedAt.getTime() + 1_000,
      ttlMs: sectionCacheTtlMs,
    });
    expect(hit!.dashboard.playerInsights).toEqual(playerInsights);
  });

  it("returns null on version mismatch across section envelopes", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: sampleDashboard,
      fetchedAt,
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const sectionRows = writesAsRows(writes).filter((row) => row.cacheKey !== "dashboard:user:user-1");
    const metaKey = userDashboardSectionCacheKey("user-1", "meta");
    const mismatched = sectionRows.map((row) => {
      if (row.cacheKey !== metaKey) return row;
      const sections = splitDashboardIntoSections(sampleDashboard);
      return {
        ...row,
        payload: encodeSourceCachePayload(
          wrapSectionEnvelope({ ...sampleDashboard, asOf: "2099-01-01T00:00:00.000Z" }, sections.meta, false),
        ),
      };
    });
    expect(
      dashboardFromSectionRows({
        sleeperUserId: "user-1",
        rows: mismatched,
        decode: decodeSourceCachePayload,
        parseSectionData: parseStoredSectionData,
        ttlMs: sectionCacheTtlMs,
      }),
    ).toBeNull();
  });

  it("returns null when a section row is missing", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: sampleDashboard,
      fetchedAt,
      live: false,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const sectionRows = writesAsRows(writes)
      .filter((row) => row.cacheKey !== "dashboard:user:user-1")
      .filter((row) => row.cacheKey !== userDashboardSectionCacheKey("user-1", "trade-waiver"));
    expect(
      dashboardFromSectionRows({
        sleeperUserId: "user-1",
        rows: sectionRows,
        decode: decodeSourceCachePayload,
        parseSectionData: parseStoredSectionData,
        ttlMs: sectionCacheTtlMs,
      }),
    ).toBeNull();
  });
});

describe("readUserDashboardSection (resolveSectionHitFromRows)", () => {
  it("reads a single section row without needing the full row", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const writes = buildDashboardCacheWrites({
      cacheKey: "dashboard:user:user-1",
      dashboard: sampleDashboard,
      fetchedAt,
      live: true,
      encode: encodeSourceCachePayload,
      serializeFull: serializeDashboardForCache,
    });
    const metaRow = writesAsRows(writes).find(
      (row) => row.cacheKey === userDashboardSectionCacheKey("user-1", "meta"),
    )!;
    const hit = resolveSectionHitFromRows({
      section: "meta",
      sectionRow: metaRow,
      fullDashboard: null,
      fullFresh: false,
      decode: decodeSourceCachePayload,
      parseSectionData: parseStoredSectionData,
      nowMs: fetchedAt.getTime() + 1_000,
      ttlMs: sectionCacheTtlMs,
    });
    expect(hit?.source).toBe("section");
    expect(hit?.fresh).toBe(true);
    expect(hit?.version).toBe(sampleDashboard.asOf);
    expect(hit?.live).toBe(true);
    expect(hit?.fetchedAtMs).toBe(fetchedAt.getTime());
    expect((hit?.data as { leagues: unknown[] }).leagues).toHaveLength(1);
  });

  it("falls back to projecting from the legacy full dashboard when the section is missing", () => {
    const hit = resolveSectionHitFromRows({
      section: "trade",
      sectionRow: null,
      fullDashboard: sampleDashboard,
      fullFresh: true,
      decode: decodeSourceCachePayload,
      parseSectionData: parseStoredSectionData,
      ttlMs: sectionCacheTtlMs,
    });
    expect(hit?.source).toBe("full-row");
    expect(hit?.fresh).toBe(true);
    expect((hit?.data as { leagues: Array<{ tradeTeams: unknown[] }> }).leagues[0]?.tradeTeams).toHaveLength(1);
  });

  it("falls back when the section row is malformed", () => {
    const hit = resolveSectionHitFromRows({
      section: "players",
      sectionRow: {
        cacheKey: userDashboardSectionCacheKey("user-1", "players"),
        payload: "gz1:not-valid-base64!!!",
        fetchedAt: new Date(),
      },
      fullDashboard: sampleDashboard,
      fullFresh: false,
      decode: decodeSourceCachePayload,
      parseSectionData: parseStoredSectionData,
      ttlMs: sectionCacheTtlMs,
    });
    expect(hit?.source).toBe("full-row");
    expect((hit?.data as { rankings: unknown[] }).rankings).toHaveLength(1);
  });
});
