import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";
import type { ChatToolContext } from "./chat-tools.js";

const selectResults: unknown[][] = [];

function chainable(result: unknown[] = []) {
  const api: Record<string, unknown> = {};
  const resolve = () => Promise.resolve(result);
  for (const key of ["from", "where", "orderBy", "limit", "offset", "innerJoin", "leftJoin"]) {
    api[key] = () => api;
  }
  Object.assign(api, {
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected),
  });
  return api;
}

vi.mock("./db.js", () => {
  const table = new Proxy({}, {
    get: (_target, prop) => String(prop),
  });
  return {
    db: {
      select: () => chainable(selectResults.shift() ?? []),
    },
    schema: {
      sharedPlayerNews: table,
      playerNewsItems: table,
      sourceCache: table,
      playerValueSnapshots: table,
      projectionAccuracy: table,
      propLineSnapshots: table,
    },
  };
});

vi.mock("./prop-line-week.js", () => ({
  loadPropLineWeek: vi.fn(async () => ({
    season: 2026,
    week: 7,
    pulledAt: null,
    sleeperPulledAt: null,
    lines: [
      {
        playerId: "p1",
        name: "Alpha Receiver",
        team: "KC",
        position: "WR",
        stat: "rec_yards",
        line: 62.5,
        openLine: 60.5,
        move: 2,
        medianOverOdds: -110,
        medianUnderOdds: -110,
        bookCount: 8,
        pulledAt: new Date().toISOString(),
        sleeperProjection: 58,
      },
    ],
  })),
}));

vi.mock("./pfn-tables.js", () => {
  const receivingYardsByWeek: Record<number, number> = { 1: 70, 2: 40, 3: 80, 4: 62, 5: 90, 6: 30 };
  const statRow = (week: number) => ({
    playerId: "00-0001",
    name: "Alpha Receiver",
    team: "KC",
    opponent: "BUF",
    position: "WR",
    week,
    targets: 8,
    receptions: 5,
    receivingYards: receivingYardsByWeek[week] ?? 0,
    carries: 0,
    rushingYards: 0,
    receivingTds: 0,
    rushingTds: 0,
    passingTds: 0,
    fantasyPpr: 12,
    targetShare: 22,
    completions: 0,
    passAttempts: 0,
    passingYards: 0,
    interceptions: 0,
    passingFirstDowns: 0,
    rushingFirstDowns: 0,
    receivingFirstDowns: 0,
    sacksTaken: 0,
    fumblesLost: 0,
    passing2pt: 0,
    rushing2pt: 0,
    receiving2pt: 0,
  });
  return {
    loadTeamWeekStats: vi.fn(async () => ({
      season: 2026,
      stats: [1, 2, 3, 4, 5, 6].map(statRow),
      snaps: [1, 2, 3, 4, 5, 6].map((week) => ({
        name: "Alpha Receiver",
        team: "KC",
        position: "WR",
        week,
        offenseSnaps: 40,
        offensePct: 80,
      })),
    })),
    handlePfnTables: vi.fn(),
    resetTeamWeekStatsCaches: vi.fn(),
  };
});

vi.mock("./nflverse-chart-extras.js", () => ({
  readChartExtrasSnapshot: vi.fn(async () => ({
    fetchedAt: new Date().toISOString(),
    season: 2026,
    snaps: [{ week: 6, player: "Alpha Receiver", team: "KC", position: "WR", offensePct: 0.88 }],
    players: { p1: { rzTargetShare: 0.22 } },
    teams: { KC: { proe: 1.5 } },
  })),
}));

vi.mock("./sleeper.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sleeper.js")>();
  return {
    ...actual,
    loadSleeperPlayerWeeklySeason: vi.fn(async () => []),
  };
});

import { dispatchChatTool } from "./chat-tools.js";
import {
  toolGetDraftInfo,
  toolGetPlayerAdvanced,
  toolGetPlayerNews,
  toolGetProjections,
  toolGetPropBoard,
  toolGetValueHistory,
  toolSuggestLineup,
  toolSuggestTrades,
  toolSuggestWaivers,
} from "./chat-tools-extended.js";

function baseDashboard(): Dashboard {
  return {
    status: "ok",
    season: 2026,
    week: 7,
    asOf: new Date().toISOString(),
    rankingsAsOf: null,
    fantasyCalcAsOf: null,
    playerTrending: {},
    playerInsights: {
      depth: { p1: { position: "WR", rank: 1 } },
      depthAsOf: null,
      depthPrevious: { p1: { position: "WR", rank: 2 } },
    },
    leagues: [
      {
        id: "lg1",
        name: "Test League",
        scoringLabel: "PPR",
        scoringSettings: { rec: 1 },
        rankingField: "ppr",
        record: { wins: 4, losses: 2, ties: 0 },
        teamActual: null,
        teamProjection: 120.5,
        starters: [
          {
            playerId: "p1",
            name: "Alpha Receiver",
            team: "KC",
            position: "WR",
            lineupSlot: "WR",
            isStarter: true,
            rank: 1,
            projection: 12,
            projectionSource: "vegas",
            actual: null,
            gamePhase: "pregame",
            gameTime: null,
            gamePeriod: null,
            gameClockSeconds: null,
            opponent: "LV",
            isAway: false,
            isBye: false,
            injuryStatus: null,
            defenseComponents: null,
            projectionComponents: null,
          },
          {
            playerId: "p-low",
            name: "Low Bench Starter",
            team: "CHI",
            position: "WR",
            lineupSlot: "FLEX",
            isStarter: true,
            rank: 40,
            projection: 4,
            projectionSource: "vegas",
            actual: null,
            gamePhase: "pregame",
            gameTime: null,
            gamePeriod: null,
            gameClockSeconds: null,
            opponent: "DET",
            isAway: true,
            isBye: false,
            injuryStatus: null,
            defenseComponents: null,
            projectionComponents: null,
          },
        ],
        bench: [
          {
            playerId: "p-bench",
            name: "Hot Bench",
            team: "BUF",
            position: "WR",
            lineupSlot: null,
            isStarter: false,
            rank: 20,
            projection: 14,
            projectionSource: "vegas",
            actual: null,
            gamePhase: "pregame",
            gameTime: null,
            gamePeriod: null,
            gameClockSeconds: null,
            opponent: "MIA",
            isAway: false,
            isBye: false,
            injuryStatus: null,
            defenseComponents: null,
            projectionComponents: null,
          },
        ],
        opponentTeam: {
          name: "Rival",
          teamActual: null,
          teamProjection: 110,
          starters: [
            {
              playerId: "opp1",
              name: "Opponent Ace",
              team: "SF",
              position: "RB",
              lineupSlot: "RB",
              isStarter: true,
              rank: 3,
              projection: 15,
              projectionSource: "vegas",
              actual: null,
              gamePhase: "pregame",
              gameTime: null,
              gamePeriod: null,
              gameClockSeconds: null,
              opponent: "SEA",
              isAway: false,
              isBye: false,
              injuryStatus: null,
              defenseComponents: null,
              projectionComponents: null,
            },
          ],
          bench: [],
        },
        suggestion: null,
        rosteredPlayerIds: ["p1", "p-low", "p-bench", "opp1"],
        rosterAssignments: [],
        rankingPositions: ["QB", "RB", "WR", "TE"],
        showSuperFilter: false,
        seasonLongFormat: {
          key: "dynasty-1qb-12t-1ppr",
          isDynasty: true,
          numQbs: 1,
          numTeams: 12,
          ppr: 1,
          label: "Dynasty 1QB",
        },
        tradeValuation: {
          unsupportedSettings: [],
          projectionAsOf: null,
          optimizerVersion: "lineup-dp-v1",
        },
        tradeTeams: [
          {
            rosterId: 1,
            ownerId: "sleeper-1",
            teamName: "My Team",
            isUser: true,
            players: [
              { playerId: "p1", name: "Alpha Receiver", team: "KC", position: "WR", lineupSlot: null, isStarter: true, rank: 1, projection: 12, projectionSource: "vegas", actual: null, gamePhase: "pregame", gameTime: null, gamePeriod: null, gameClockSeconds: null, opponent: null, isAway: null, isBye: false, injuryStatus: null, defenseComponents: null, projectionComponents: null },
              { playerId: "p-surplus", name: "Surplus WR", team: "DAL", position: "WR", lineupSlot: null, isStarter: false, rank: 30, projection: 8, projectionSource: "vegas", actual: null, gamePhase: "pregame", gameTime: null, gamePeriod: null, gameClockSeconds: null, opponent: null, isAway: null, isBye: false, injuryStatus: null, defenseComponents: null, projectionComponents: null },
            ],
            ownedPicks: [
              {
                formatKey: "dynasty-1qb-12t-1ppr",
                playerId: "pick:2027:1:1",
                name: "2027 1st",
                team: null,
                position: "PICK",
                overallRank: 50,
                positionRank: 5,
                value: 4000,
                trend30Day: null,
                isRookie: false,
              },
            ],
            record: { wins: 4, losses: 2, ties: 0 },
          },
          {
            rosterId: 2,
            ownerId: "sleeper-2",
            teamName: "Rival",
            isUser: false,
            players: [
              { playerId: "p-need", name: "Need RB", team: "PHI", position: "RB", lineupSlot: null, isStarter: true, rank: 12, projection: 13, projectionSource: "vegas", actual: null, gamePhase: "pregame", gameTime: null, gamePeriod: null, gameClockSeconds: null, opponent: null, isAway: null, isBye: false, injuryStatus: null, defenseComponents: null, projectionComponents: null },
            ],
            ownedPicks: [],
            record: { wins: 3, losses: 3, ties: 0 },
          },
        ],
        tradeWaiverPool: [
          {
            playerId: "fa1",
            name: "Free Agent WR",
            team: "TB",
            position: "WR",
            lineupSlot: null,
            isStarter: false,
            rank: 55,
            projection: 11.5,
            projectionSource: "vegas",
            actual: null,
            gamePhase: "pregame",
            gameTime: null,
            gamePeriod: null,
            gameClockSeconds: null,
            opponent: "ATL",
            isAway: false,
            isBye: false,
            injuryStatus: null,
            defenseComponents: null,
            projectionComponents: null,
          },
        ],
        tradeStarterSlots: ["QB", "RB", "WR", "TE", "FLEX"],
        powerRankingsWeek: [],
        powerRankingsSeasonLong: [
          {
            rosterId: 1,
            teamName: "My Team",
            record: { wins: 4, losses: 2, ties: 0 },
            rank: 2,
            totalValue: 20_000,
            futurePickValue: 4_000,
            positionValues: { QB: 3000, RB: 2000, WR: 8000, TE: 2000, FLEX: 0, K: 0, DEF: 0 },
            isUser: true,
          },
          {
            rosterId: 2,
            teamName: "Rival",
            record: { wins: 3, losses: 3, ties: 0 },
            rank: 1,
            totalValue: 22_000,
            futurePickValue: 2_000,
            positionValues: { QB: 3500, RB: 7000, WR: 3000, TE: 2000, FLEX: 0, K: 0, DEF: 0 },
            isUser: false,
          },
        ],
        standings: [],
        playoffs: { teams: null, weekStart: null },
        waivers: null,
        powerRankingsDynasty: [],
      },
    ],
    rankings: [
      {
        leagueId: "lg1",
        playerId: "p1",
        name: "Alpha Receiver",
        team: "KC",
        opponent: "LV",
        isAway: false,
        isBye: false,
        position: "WR",
        pprRank: 1,
        halfPprRank: 1,
        leagueRank: 1,
        ppr: 18.2,
        halfPpr: 14.1,
        standard: 10,
        leagueProjection: 18.2,
        vegasProjection: 17.5,
        sleeperProjection: 16,
        projectionSource: "vegas",
        projectionComponents: null,
        injuryStatus: null,
        gameTime: null,
        actual: null,
        gamePhase: null,
      },
      {
        leagueId: "lg1",
        playerId: "fa1",
        name: "Free Agent WR",
        team: "TB",
        opponent: "ATL",
        isAway: false,
        isBye: false,
        position: "WR",
        pprRank: 55,
        halfPprRank: 55,
        leagueRank: 55,
        ppr: 11.5,
        halfPpr: 9,
        standard: 7,
        leagueProjection: 11.5,
        vegasProjection: 11,
        sleeperProjection: 10,
        projectionSource: "vegas",
        projectionComponents: null,
        injuryStatus: null,
        gameTime: null,
        actual: null,
        gamePhase: null,
      },
    ],
    weeklyChartRankings: [],
    seasonLongRankings: [
      {
        formatKey: "dynasty-1qb-12t-1ppr",
        playerId: "p1",
        name: "Alpha Receiver",
        team: "KC",
        position: "WR",
        overallRank: 12,
        positionRank: 5,
        value: 8_000,
        trend30Day: 200,
        isRookie: false,
      },
      {
        formatKey: "dynasty-1qb-12t-1ppr",
        playerId: "p-surplus",
        name: "Surplus WR",
        team: "DAL",
        position: "WR",
        overallRank: 40,
        positionRank: 18,
        value: 4_200,
        trend30Day: 0,
        isRookie: false,
      },
      {
        formatKey: "dynasty-1qb-12t-1ppr",
        playerId: "p-need",
        name: "Need RB",
        team: "PHI",
        position: "RB",
        overallRank: 25,
        positionRank: 10,
        value: 4_500,
        trend30Day: 50,
        isRookie: false,
      },
      {
        formatKey: "dynasty-1qb-12t-1ppr",
        playerId: "fa1",
        name: "Free Agent WR",
        team: "TB",
        position: "WR",
        overallRank: 70,
        positionRank: 30,
        value: 1_200,
        trend30Day: null,
        isRookie: false,
      },
      {
        formatKey: "dynasty-1qb-12t-1ppr",
        playerId: "pick:2027:1:1",
        name: "2027 Mid 1st",
        team: null,
        position: "PICK",
        overallRank: 50,
        positionRank: 5,
        value: 4000,
        trend30Day: null,
        isRookie: false,
      },
      // Redraft twin for Season Long window (never fall back to dynasty board).
      {
        formatKey: "redraft-1qb-12t-1ppr",
        playerId: "p1",
        name: "Alpha Receiver",
        team: "KC",
        position: "WR",
        overallRank: 10,
        positionRank: 4,
        value: 8_000,
        trend30Day: 100,
        isRookie: false,
      },
      {
        formatKey: "redraft-1qb-12t-1ppr",
        playerId: "p-surplus",
        name: "Surplus WR",
        team: "DAL",
        position: "WR",
        overallRank: 35,
        positionRank: 16,
        value: 4_200,
        trend30Day: 0,
        isRookie: false,
      },
      {
        formatKey: "redraft-1qb-12t-1ppr",
        playerId: "p-need",
        name: "Need RB",
        team: "PHI",
        position: "RB",
        overallRank: 22,
        positionRank: 9,
        value: 4_500,
        trend30Day: 40,
        isRookie: false,
      },
      {
        formatKey: "redraft-1qb-12t-1ppr",
        playerId: "fa1",
        name: "Free Agent WR",
        team: "TB",
        position: "WR",
        overallRank: 65,
        positionRank: 28,
        value: 1_200,
        trend30Day: null,
        isRookie: false,
      },
    ],
    defenses: [],
    analytics: {
      asOf: null,
      throughWeek: 6,
      sourceUrl: "",
      entities: [
        {
          id: "p1",
          name: "Alpha Receiver",
          team: "KC",
          position: "WR",
          playerId: "p1",
          seasonGames: 6,
          rollingGames: 6,
          season: { targets: 48, receptions: 32 },
          rolling17: { targets: 48, receptions: 32 },
          weeklySnaps: [{ week: 6, snapShare: 0.9 }],
          weeklyExpected: [{ week: 6, expected: 14, actual: 16 }],
        },
      ],
      teamUsage: [],
      teamRecords: [],
    },
    gameLines: [],
    strengthOfSchedule: [
      {
        leagueId: "lg1",
        season: 2026,
        throughWeek: 6,
        computedAt: new Date().toISOString(),
        table: { KC: { WR: { avg: 18.2, weeks: 4, rank: 8 }, QB: { avg: 20, weeks: 4, rank: 10 }, RB: { avg: 15, weeks: 4, rank: 12 }, TE: { avg: 10, weeks: 4, rank: 14 } } },
      },
    ],
    sourceErrors: [],
  };
}

function ctxWithDashboard(dashboard: Dashboard = baseDashboard()): ChatToolContext {
  return {
    userId: "user-1",
    sleeperUserId: "sleeper-1",
    dashboardPromise: Promise.resolve(dashboard),
  };
}

beforeEach(() => {
  selectResults.length = 0;
});

describe("extended chat tools", () => {
  it("get_player_news returns scoped shared news", async () => {
    selectResults.push(
      [
        {
          id: "n1",
          playerId: "p1",
          player: "Alpha Receiver",
          team: "KC",
          change: "Cleared to play",
          newsType: "roster",
          roleContext: "",
          sourceLabel: "Sleeper",
          sourceUrl: "https://example.com/1",
          publishedAt: new Date("2026-10-20T12:00:00Z"),
          createdAt: new Date("2026-10-20T12:00:00Z"),
          source: "sleeper",
        },
      ],
      [], // injury snapshot row select in readSourceCacheValue uses select->limit
      [], // notes payload
      [], // legacy items
    );
    // readSourceCacheValue does select().from().where().limit(1) — one result array
    // Then notes payload select — another
    // Then legacy — another
    // First push is shared news. Injury uses readSourceCacheValue which is select/from/where/limit.
    // Order in tool: shared, injury (readSourceCacheValue), notes payload, legacy.
    // Reset and push in order:
    selectResults.length = 0;
    selectResults.push(
      [
        {
          id: "n1",
          playerId: "p1",
          player: "Alpha Receiver",
          team: "KC",
          change: "Cleared to play",
          newsType: "roster",
          roleContext: "",
          sourceLabel: "Sleeper",
          sourceUrl: "https://example.com/1",
          externalId: "injury-status:p1:Out",
          publishedAt: new Date("2026-10-20T12:00:00Z"),
          createdAt: new Date("2026-10-20T12:00:00Z"),
          source: "sleeper",
        },
        {
          id: "n2",
          playerId: "p2",
          player: "Beta Back",
          team: "KC",
          change: "Practice roundup naming several players",
          newsType: "roster",
          roleContext: "Posted by @beat on X.",
          sourceLabel: "@beat",
          sourceUrl: "https://x.com/beat/status/2115569505300811921",
          externalId: "2115569505300811921",
          publishedAt: new Date("2026-10-20T11:00:00Z"),
          createdAt: new Date("2026-10-20T11:00:00Z"),
          source: "x",
        },
        {
          id: "n3",
          playerId: "p1",
          player: "Alpha Receiver",
          team: "KC",
          change: "Practice roundup naming several players (Alpha)",
          newsType: "roster",
          roleContext: "Posted by @beat on X.",
          sourceLabel: "@beat",
          sourceUrl: "https://x.com/beat/status/2115569505300811921",
          externalId: "2115569505300811921",
          publishedAt: new Date("2026-10-20T11:00:00Z"),
          createdAt: new Date("2026-10-20T11:00:00Z"),
          source: "x",
        },
      ],
      [],
      [],
      [],
    );

    const result = await toolGetPlayerNews(ctxWithDashboard(), {
      leagueId: "lg1",
      scope: "roster",
      limit: 10,
    }) as { ok: boolean; items: Array<{ change: string; playerId: string }> };
    expect(result.ok).toBe(true);
    expect(result.items.map((row) => row.change)).toEqual([
      "Cleared to play",
      "Practice roundup naming several players",
    ]);
  });

  it("fills roster news from another page when a roundup fills the first page", async () => {
    const row = {
      id: "n1", playerId: "p1", player: "Alpha Receiver", team: "KC",
      change: "Practice roundup", newsType: "roster", roleContext: "Posted on X.",
      sourceLabel: "@beat", sourceUrl: "https://x.com/beat/status/1", externalId: "1",
      publishedAt: new Date("2026-10-20T12:00:00Z"),
      createdAt: new Date("2026-10-20T12:00:00Z"), source: "x",
    };
    selectResults.push(
      Array.from({ length: 32 }, (_, index) => ({ ...row, id: `n${index}` })),
      [row, { ...row, id: "older", externalId: "2", sourceUrl: "https://x.com/beat/status/2", change: "Another post" }],
      [], [], [],
    );
    const result = await toolGetPlayerNews(ctxWithDashboard(), {
      leagueId: "lg1", scope: "roster", limit: 2,
    }) as { items: Array<{ change: string }> };
    expect(result.items.map((item) => item.change)).toEqual(["Practice roundup", "Another post"]);
  });

  it("get_player_advanced returns analytics and insights", async () => {
    const result = await toolGetPlayerAdvanced(ctxWithDashboard(), { playerId: "p1", leagueId: "lg1" }) as {
      ok: boolean;
      analytics: { seasonGames: number } | null;
      depth: { rank: number } | null;
    };
    expect(result.ok).toBe(true);
    expect(result.analytics?.seasonGames).toBe(6);
    expect(result.depth?.rank).toBe(1);
  });

  // This test does seconds of real async work (live-shaped projection
  // loads) and sat ~1s under the 5s default timeout, so any added suite
  // load flakes it. Give it explicit headroom.
  it("get_projections returns week and ROS for roster", async () => {
    selectResults.push([]); // projection accuracy
    const result = await toolGetProjections(ctxWithDashboard(), {
      leagueId: "lg1",
      scope: "roster",
    }) as {
      ok: boolean;
      players: Array<{ playerId: string; week: { leagueProjection: number | null } }>;
      propLines: unknown[];
    };
    expect(result.ok).toBe(true);
    expect(result.players.some((p) => p.playerId === "p1")).toBe(true);
    expect(result.propLines.length).toBeGreaterThan(0);
  }, 15_000);

  it("get_projections defaults omitted leagueId to the viewing league", async () => {
    selectResults.push([]);
    const dashboard = baseDashboard();
    const second = {
      ...dashboard.leagues[0]!,
      id: "lg2",
      name: "Second League",
      starters: dashboard.leagues[0]!.starters,
      bench: dashboard.leagues[0]!.bench,
      rosteredPlayerIds: dashboard.leagues[0]!.rosteredPlayerIds,
    };
    dashboard.leagues = [
      { ...dashboard.leagues[0]!, starters: [], bench: [], rosteredPlayerIds: [] },
      second,
    ];
    const result = await toolGetProjections(
      { ...ctxWithDashboard(dashboard), defaultLeagueId: "lg2" },
      { scope: "roster" },
    ) as { ok: boolean; leagueId: string };
    expect(result.ok).toBe(true);
    expect(result.leagueId).toBe("lg2");
  });

  it("get_value_history downsamples stored snapshots", async () => {
    selectResults.push([
      { snapshotDate: "2026-09-01", playerName: "Alpha Receiver", position: "WR", value: 7000 },
      { snapshotDate: "2026-09-15", playerName: "Alpha Receiver", position: "WR", value: 7500 },
      { snapshotDate: "2026-10-01", playerName: "Alpha Receiver", position: "WR", value: 8000 },
    ]);
    const result = await toolGetValueHistory(ctxWithDashboard(), {
      leagueId: "lg1",
      playerId: "p1",
      maxPoints: 10,
    }) as { ok: boolean; points: Array<{ value: number }>; change: number | null };
    expect(result.ok).toBe(true);
    expect(result.points).toHaveLength(3);
    expect(result.change).toBe(1000);
  });

  it("suggest_lineup proposes start/sit using optimizer", async () => {
    const result = await toolSuggestLineup(ctxWithDashboard(), { leagueId: "lg1" }) as {
      ok: boolean;
      swaps: Array<{ start: { playerId: string }; sit: { playerId: string } | null }>;
      projectionDelta: number;
    };
    expect(result.ok).toBe(true);
    expect(result.swaps.some((swap) => swap.start.playerId === "p-bench")).toBe(true);
    expect(result.projectionDelta).toBeGreaterThan(0);
  });

  it("suggest_waivers ranks free agents with reasons", async () => {
    const result = await toolSuggestWaivers(ctxWithDashboard(), { leagueId: "lg1", limit: 5 }) as {
      ok: boolean;
      suggestions: Array<{ playerId: string; reason: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.suggestions[0]?.playerId).toBe("fa1");
    expect(result.suggestions[0]?.reason.length).toBeGreaterThan(0);
  });

  it("suggest_trades returns roughly fair complementary ideas", async () => {
    const result = await toolSuggestTrades(ctxWithDashboard(), { leagueId: "lg1", limit: 5 }) as {
      ok: boolean;
      suggestions: Array<{ partner: string; giveTotal: number; getTotal: number }>;
    };
    expect(result.ok).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.partner).toBe("Rival");
  });

  it("get_draft_info returns owned picks", async () => {
    selectResults.push([]); // draft market cache miss
    const result = await toolGetDraftInfo(ctxWithDashboard(), { leagueId: "lg1" }) as {
      ok: boolean;
      ownedPicks: Array<{ playerId: string; value: number }>;
      isDynasty: boolean;
    };
    expect(result.ok).toBe(true);
    expect(result.isDynasty).toBe(true);
    expect(result.ownedPicks[0]?.playerId).toBe("pick:2027:1:1");
  });

  it("dispatchChatTool routes extended tool names", async () => {
    selectResults.push([]);
    const result = await dispatchChatTool(
      "suggest_lineup",
      { leagueId: "lg1" },
      ctxWithDashboard(),
    ) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("get_projections attaches season hit records to prop lines", async () => {
    selectResults.push([]); // projection accuracy
    const result = await toolGetProjections(ctxWithDashboard(), {
      leagueId: "lg1",
      scope: "roster",
    }) as {
      ok: boolean;
      propLines: Array<{
        name: string;
        history: { games: number; overs: number; unders: number; pushes: number; hitRate: number | null } | null;
      }>;
    };
    expect(result.ok).toBe(true);
    const line = result.propLines.find((row) => row.name === "Alpha Receiver");
    expect(line?.history).toEqual({ games: 6, overs: 3, unders: 3, pushes: 0, hitRate: 0.5 });
  }, 15_000);

  it("get_prop_board returns the board with hit records", async () => {
    const result = await toolGetPropBoard(ctxWithDashboard(), { leagueId: "lg1" }) as {
      ok: boolean;
      totalLines: number;
      board: Array<{ name: string; stat: string; history: { overs: number; hitRate: number | null } | null }>;
    };
    expect(result.ok).toBe(true);
    expect(result.totalLines).toBe(1);
    expect(result.board[0]?.name).toBe("Alpha Receiver");
    expect(result.board[0]?.stat).toBe("rec_yards");
    expect(result.board[0]?.history?.overs).toBe(3);
    expect(result.board[0]?.history?.hitRate).toBe(0.5);
  });

  it("get_prop_board filters by position", async () => {
    const result = await toolGetPropBoard(ctxWithDashboard(), { leagueId: "lg1", position: "RB" }) as {
      ok: boolean;
      totalLines: number;
      board: unknown[];
    };
    expect(result.ok).toBe(true);
    expect(result.totalLines).toBe(0);
    expect(result.board).toEqual([]);
  });

  it("dispatchChatTool routes get_prop_board", async () => {
    const result = await dispatchChatTool(
      "get_prop_board",
      { leagueId: "lg1" },
      ctxWithDashboard(),
    ) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});
