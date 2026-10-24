import { describe, expect, it } from "vitest";
import {
  assembleDashboardFromSections,
  apiSectionDataFromDashboard,
  dashboardSnapshotIsLive,
  projectDashboardSection,
  splitDashboardIntoSections,
  teamSectionApiData,
  userDashboardSectionCacheKey,
  wrapSectionEnvelope,
} from "./dashboard-section-cache.js";
import {
  hydrateDashboardFromCache,
  parseUsableDashboard,
  serializeDashboardForCache,
  type Dashboard,
} from "./dashboard-schemas.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";

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
      tradeWaiverPool: [
        {
          playerId: "waive-1",
          name: "Waiver Guy",
          team: "KC",
          position: "RB",
          lineupSlot: null,
          isStarter: false,
          rank: 40,
          projection: 8,
          projectionSource: "vegas",
          actual: null,
          gamePhase: null,
          gameTime: null,
          opponent: null,
          isAway: null,
          isBye: false,
          injuryStatus: null,
          defenseComponents: null,
          projectionComponents: null,
        },
      ],
      tradeStarterSlots: ["QB", "RB", "WR", "TE", "FLEX"],
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

describe("per-section dashboard cache", () => {
  it("builds stable section cache keys", () => {
    expect(userDashboardSectionCacheKey("abc", "meta")).toBe("dashboard:user:abc:meta");
    expect(userDashboardSectionCacheKey("abc", "trade")).toBe("dashboard:user:abc:trade");
    expect(userDashboardSectionCacheKey("abc", "trade-waiver")).toBe("dashboard:user:abc:trade-waiver");
  });

  it("splits trade fields out of the stored team section and waiver out of trade", () => {
    const sections = splitDashboardIntoSections(sampleDashboard);
    expect(sections.team.leagues[0]).not.toHaveProperty("tradeTeams");
    expect(sections.team.leagues[0]).not.toHaveProperty("tradeWaiverPool");
    expect(sections.trade.leagues[0]?.tradeTeams).toHaveLength(1);
    expect(sections.trade.leagues[0]).not.toHaveProperty("tradeWaiverPool");
    expect(sections["trade-waiver"].leagues[0]?.tradeWaiverPool).toHaveLength(1);
    expect(sections.meta.leagues[0]?.name).toBe("Test League");
    expect(sections.players.rankings).toHaveLength(1);
  });

  it("reassembles a full dashboard from section slices", () => {
    const sections = splitDashboardIntoSections(sampleDashboard);
    const assembled = assembleDashboardFromSections(sections);
    expect(assembled).not.toBeNull();
    expect(assembled!.leagues[0]?.tradeTeams).toEqual(sampleDashboard.leagues[0]?.tradeTeams);
    expect(assembled!.leagues[0]?.tradeWaiverPool).toEqual(sampleDashboard.leagues[0]?.tradeWaiverPool);
    expect(assembled!.rankings).toEqual(sampleDashboard.rankings);
    expect(assembled!.weeklyChartRankings).toEqual(sampleDashboard.rankings);
    expect(assembled!.asOf).toBe(sampleDashboard.asOf);
  });

  it("carries standings, waivers and game lines through the section split", () => {
    const standings = [{
      rosterId: 1, teamName: "Mine", isUser: true, rank: 1, wins: 5, losses: 2, ties: 0,
      pointsFor: 812.4, pointsAgainst: 700.1, playoffSeed: 1, gamesOutOfPlayoffs: null,
    }];
    const waivers = { type: "faab" as const, budget: 100, remaining: 63, position: 4, teams: 12 };
    const gameLines = [{ team: "KC", opponent: "TEN", isHome: false, spread: -7, total: 44.5, impliedPoints: 25.8 }];
    const withExtras: Dashboard = {
      ...sampleDashboard,
      gameLines,
      leagues: sampleDashboard.leagues.map((league) => ({
        ...league, standings, playoffs: { teams: 6, weekStart: 15 }, waivers,
      })),
    };
    const assembled = assembleDashboardFromSections(splitDashboardIntoSections(withExtras));
    expect(assembled!.gameLines).toEqual(gameLines);
    expect(assembled!.leagues[0]).toMatchObject({ standings, playoffs: { teams: 6, weekStart: 15 }, waivers });
  });

  it("still parses a dashboard cached before standings, waivers and game lines existed", () => {
    const { gameLines: _gameLines, ...legacy } = sampleDashboard;
    const legacyLeagues = legacy.leagues.map(({ standings: _s, playoffs: _p, waivers: _w, ...league }) => league);
    const parsed = parseUsableDashboard(encodeSourceCachePayload({ ...legacy, leagues: legacyLeagues }));
    expect(parsed).not.toBeNull();
    expect(parsed!.gameLines).toEqual([]);
    expect(parsed!.leagues[0]).toMatchObject({ standings: [], playoffs: { teams: null, weekStart: null }, waivers: null });
  });

  it("fills empty trade fields on team API data unless trade / waiver slices are provided", () => {
    const sections = splitDashboardIntoSections(sampleDashboard);
    const withoutTrade = teamSectionApiData(sections.team, null);
    expect(withoutTrade.leagues[0]?.tradeTeams).toEqual([]);
    expect(withoutTrade.leagues[0]?.tradeWaiverPool).toEqual([]);
    const withTradeOnly = teamSectionApiData(sections.team, sections.trade);
    expect(withTradeOnly.leagues[0]?.tradeTeams).toHaveLength(1);
    expect(withTradeOnly.leagues[0]?.tradeWaiverPool).toEqual([]);
    const withBoth = teamSectionApiData(sections.team, sections.trade, sections["trade-waiver"]);
    expect(withBoth.leagues[0]?.tradeWaiverPool).toHaveLength(1);
  });

  it("projects legacy full-row team slices with trade fields still present", () => {
    const team = projectDashboardSection(sampleDashboard, "team") as {
      leagues: Array<{ tradeTeams: unknown[]; tradeWaiverPool: unknown[] }>;
    };
    expect(team.leagues[0]?.tradeTeams).toHaveLength(1);
    expect(team.leagues[0]?.tradeWaiverPool).toHaveLength(1);
    const trade = projectDashboardSection(sampleDashboard, "trade") as {
      leagues: Array<{ tradeStarterSlots: string[] }>;
    };
    expect(trade.leagues[0]?.tradeStarterSlots).toEqual(["QB", "RB", "WR", "TE", "FLEX"]);
  });

  it("serves slim team data from a fresh build and keeps trade on the legacy projection", () => {
    const api = apiSectionDataFromDashboard(sampleDashboard, "team") as {
      leagues: Array<{ tradeTeams: unknown[]; tradeWaiverPool: unknown[] }>;
    };
    expect(api.leagues[0]?.tradeTeams).toEqual([]);
    expect(api.leagues[0]?.tradeWaiverPool).toEqual([]);
    const legacy = projectDashboardSection(sampleDashboard, "team") as {
      leagues: Array<{ tradeTeams: unknown[] }>;
    };
    expect(legacy.leagues[0]?.tradeTeams).toHaveLength(1);
  });

  it("treats a rostered live game as a live snapshot", () => {
    expect(dashboardSnapshotIsLive(sampleDashboard)).toBe(false);
    const live = {
      ...sampleDashboard,
      leagues: sampleDashboard.leagues.map((league) => ({
        ...league,
        starters: [{ gamePhase: "live" }],
      })),
    };
    expect(dashboardSnapshotIsLive(live)).toBe(true);
  });

  it("wraps section envelopes with a shared version and live flag", () => {
    const envelope = wrapSectionEnvelope(sampleDashboard, { ok: true }, true);
    expect(envelope.version).toBe(sampleDashboard.asOf);
    expect(envelope.live).toBe(true);
    expect(envelope.data).toEqual({ ok: true });
  });
});

describe("missing-section / legacy full-row fallback", () => {
  it("still parses a legacy uncompressed full dashboard row", () => {
    const legacy = JSON.stringify({
      ...sampleDashboard,
      weeklyChartRankings: sampleDashboard.rankings,
    });
    const parsed = parseUsableDashboard(legacy);
    expect(parsed?.leagues[0]?.id).toBe("league-1");
    expect(parsed?.weeklyChartRankings).toEqual(sampleDashboard.rankings);
  });

  it("round-trips a compressed full dashboard row", () => {
    // Force compression by embedding a large field.
    const bulky: Dashboard = {
      ...sampleDashboard,
      sourceErrors: ["x".repeat(60_000)],
    };
    const encoded = serializeDashboardForCache(bulky);
    expect(encoded.startsWith("gz1:")).toBe(true);
    const parsed = parseUsableDashboard(encoded);
    expect(parsed?.sourceErrors[0]?.length).toBe(60_000);
    expect(parsed?.weeklyChartRankings).toEqual(bulky.rankings);
  });

  it("hydrates a section envelope payload after gzip encode/decode", () => {
    const sections = splitDashboardIntoSections(sampleDashboard);
    const envelope = wrapSectionEnvelope(sampleDashboard, sections.meta, false);
    const encoded = encodeSourceCachePayload(envelope);
    const decoded = decodeSourceCachePayload(encoded) as typeof envelope;
    expect(decoded.version).toBe(sampleDashboard.asOf);
    expect(decoded.data).toEqual(sections.meta);
  });

  it("returns null when assembling incomplete section sets (missing-section fallback signal)", () => {
    const sections = splitDashboardIntoSections(sampleDashboard);
    const incomplete = {
      ...sections,
      trade: { leagues: [] },
    };
    // Empty trade leagues still assembles (defaults to []); drop meta leagues instead.
    const missingMeta = {
      ...sections,
      meta: { ...sections.meta, leagues: [] },
    };
    expect(assembleDashboardFromSections(missingMeta)).toBeNull();
    expect(assembleDashboardFromSections(incomplete)?.leagues[0]?.tradeTeams).toEqual([]);
  });
});

describe("serialize still omits weeklyChartRankings", () => {
  it("keeps the PR #94 dedupe behavior through encode/decode", () => {
    const encoded = serializeDashboardForCache(sampleDashboard);
    const decoded = decodeSourceCachePayload(encoded) as Record<string, unknown>;
    expect(decoded).not.toHaveProperty("weeklyChartRankings");
    expect(hydrateDashboardFromCache(decoded)?.weeklyChartRankings).toEqual(sampleDashboard.rankings);
  });
});
