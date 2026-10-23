import { describe, expect, it } from "vitest";
import {
  hydrateDashboardFromCache,
  parseUsableDashboard,
  serializeDashboardForCache,
  type Dashboard,
} from "./dashboard-schemas.js";
import {
  FANTASYCALC_MEMORY_TTL_MS,
  isFantasyCalcMemoryFresh,
  LIVE_DASHBOARD_CACHE_MS,
} from "./dashboard-build.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";

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
};

const sampleDashboard: Dashboard = {
  status: "ok",
  season: 2026,
  week: 6,
  asOf: "2026-10-12T00:00:00.000Z",
  rankingsAsOf: null,
  fantasyCalcAsOf: null,
  playerTrending: {},
  playerInsights: { depth: {}, depthAsOf: null, depthPrevious: {}, experts: {}, expertsAsOf: null, expertsLastKickoff: null },
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
      rosteredPlayerIds: [],
      rosterAssignments: [],
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
      tradeTeams: [],
      tradeWaiverPool: [],
      tradeStarterSlots: [],
      powerRankingsWeek: [],
      powerRankingsSeasonLong: [],
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
  strengthOfSchedule: [],
  sourceErrors: [],
};

describe("dashboard cache weeklyChartRankings dedupe", () => {
  it("omits weeklyChartRankings when serializing for cache", () => {
    const raw = serializeDashboardForCache(sampleDashboard);
    const parsed = decodeSourceCachePayload(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("rankings");
    expect(parsed).not.toHaveProperty("weeklyChartRankings");
  });

  it("reconstructs weeklyChartRankings from rankings for new cache rows", () => {
    const hydrated = hydrateDashboardFromCache(decodeSourceCachePayload(serializeDashboardForCache(sampleDashboard)));
    expect(hydrated).not.toBeNull();
    expect(hydrated!.weeklyChartRankings).toEqual(hydrated!.rankings);
    expect(hydrated!.weeklyChartRankings).toEqual(sampleDashboard.rankings);
  });

  it("reconstructs a value equal to the legacy stored weeklyChartRankings", () => {
    const legacyPayload = {
      ...sampleDashboard,
      // Simulate an old cached row that still duplicated the array.
      weeklyChartRankings: structuredClone(sampleDashboard.rankings),
    };
    const legacyWeekly = legacyPayload.weeklyChartRankings;
    const hydrated = hydrateDashboardFromCache(legacyPayload);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.weeklyChartRankings).toEqual(legacyWeekly);
    expect(hydrated!.weeklyChartRankings).toEqual(hydrated!.rankings);
  });

  it("parseUsableDashboard accepts legacy and slim payloads", () => {
    const slim = parseUsableDashboard(serializeDashboardForCache(sampleDashboard));
    const legacy = parseUsableDashboard(JSON.stringify(sampleDashboard));
    expect(slim?.weeklyChartRankings).toEqual(sampleDashboard.rankings);
    expect(legacy?.weeklyChartRankings).toEqual(sampleDashboard.rankings);
  });
});

describe("live dashboard cache cadence", () => {
  it("uses a 150s live cache window", () => {
    expect(LIVE_DASHBOARD_CACHE_MS).toBe(150_000);
  });
});

describe("fantasycalc presets memory freshness", () => {
  it("treats memory as fresh within the 1 hour TTL keyed by fetchedAt", () => {
    const fetchedAt = new Date("2026-10-12T03:00:00.000Z");
    const nowMs = fetchedAt.getTime() + FANTASYCALC_MEMORY_TTL_MS - 1;
    expect(isFantasyCalcMemoryFresh({ fetchedAt }, nowMs)).toBe(true);
    expect(isFantasyCalcMemoryFresh({ fetchedAt }, fetchedAt.getTime() + FANTASYCALC_MEMORY_TTL_MS)).toBe(false);
    expect(isFantasyCalcMemoryFresh(null, nowMs)).toBe(false);
  });
});
