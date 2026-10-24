import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";
import {
  dispatchChatTool,
  parseToolCallArguments,
  waiverAdjustments,
  type ChatToolContext,
} from "./chat-tools.js";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));
vi.mock("./trades.js", () => ({
  loadHistoricalTrades: vi.fn(async () => ({
    trades: [],
    seasons: [2026],
    asOf: new Date().toISOString(),
    isStale: false,
    sourceErrors: [],
  })),
}));
vi.mock("./sleeper.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sleeper.js")>();
  return {
    ...actual,
    loadSleeperPlayerWeeklySeason: vi.fn(async () => []),
  };
});

function baseDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    status: "ok",
    season: 2026,
    week: 7,
    asOf: new Date().toISOString(),
    rankingsAsOf: null,
    fantasyCalcAsOf: null,
    playerTrending: {},
    playerInsights: {
      depth: {},
      depthAsOf: null,
      depthPrevious: {},
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
            projection: 18.2,
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
        ],
        bench: [],
        opponentTeam: {
          name: "Rival",
          teamActual: null,
          teamProjection: 110,
          starters: [],
          bench: [],
        },
        suggestion: null,
        rosteredPlayerIds: ["p1", "p2"],
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
            players: [],
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
        ],
        tradeWaiverPool: [],
        tradeStarterSlots: ["QB", "RB", "WR", "TE", "FLEX"],
        powerRankingsWeek: [
          {
            rosterId: 1,
            teamName: "My Team",
            record: { wins: 4, losses: 2, ties: 0 },
            rank: 1,
            totalValue: 100,
            futurePickValue: 0,
            positionValues: { QB: 20, RB: 25, WR: 30, TE: 15, FLEX: 10, K: 0, DEF: 0 },
            isUser: true,
          },
          {
            rosterId: 2,
            teamName: "Rival",
            record: { wins: 3, losses: 3, ties: 0 },
            rank: 2,
            totalValue: 80,
            futurePickValue: 0,
            positionValues: { QB: 18, RB: 20, WR: 22, TE: 12, FLEX: 8, K: 0, DEF: 0 },
            isUser: false,
          },
        ],
        powerRankingsSeasonLong: [],
        powerRankingsDynasty: [
          {
            rosterId: 1,
            teamName: "My Team",
            record: { wins: 4, losses: 2, ties: 0 },
            rank: 2,
            totalValue: 20_000,
            futurePickValue: 4_000,
            positionValues: { QB: 3000, RB: 5000, WR: 6000, TE: 2000, FLEX: 0, K: 0, DEF: 0 },
            isUser: true,
          },
          {
            rosterId: 2,
            teamName: "Rival",
            record: { wins: 3, losses: 3, ties: 0 },
            rank: 1,
            totalValue: 22_000,
            futurePickValue: 2_000,
            positionValues: { QB: 3500, RB: 5500, WR: 7000, TE: 2000, FLEX: 0, K: 0, DEF: 0 },
            isUser: false,
          },
        ],
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
        playerId: "p2",
        name: "Beta Back",
        team: "SF",
        position: "RB",
        overallRank: 20,
        positionRank: 8,
        value: 6_000,
        trend30Day: -100,
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
        playerId: "p2",
        name: "Beta Back",
        team: "SF",
        position: "RB",
        overallRank: 18,
        positionRank: 7,
        value: 6_000,
        trend30Day: -50,
        isRookie: false,
      },
    ],
    defenses: [],
    analytics: {
      asOf: null,
      throughWeek: null,
      sourceUrl: "",
      entities: [],
      teamUsage: [],
      teamRecords: [],
    },
    strengthOfSchedule: [],
    sourceErrors: [],
    ...overrides,
  };
}

function ctxWithDashboard(dashboard: Dashboard): ChatToolContext {
  return {
    userId: "user-1",
    sleeperUserId: "sleeper-1",
    dashboardPromise: Promise.resolve(dashboard),
  };
}

describe("parseToolCallArguments", () => {
  it("parses JSON and falls back on bad input", () => {
    expect(parseToolCallArguments('{"leagueId":"lg1"}')).toEqual({ leagueId: "lg1" });
    expect(parseToolCallArguments(undefined)).toEqual({});
    expect(parseToolCallArguments("{nope")).toMatchObject({ __parseError: expect.any(String) });
  });
});

describe("waiverAdjustments", () => {
  it("credits the side sending fewer pieces", () => {
    expect(waiverAdjustments([{ value: 8000 }], [{ value: 3000 }, { value: 2500 }])).toEqual({
      give: 753,
      get: 0,
    });
    expect(waiverAdjustments([{ value: 1000 }, { value: 1000 }], [{ value: 2000 }])).toEqual({
      give: 0,
      get: 698,
    });
    expect(waiverAdjustments([{ value: 1 }], [{ value: 1 }])).toEqual({ give: 0, get: 0 });
  });
});

describe("dispatchChatTool", () => {
  it("rejects unknown tools", async () => {
    const result = await dispatchChatTool("nope", {}, ctxWithDashboard(baseDashboard()));
    expect(result).toEqual({ ok: false, error: "Unknown tool: nope" });
  });

  it("returns leagues and roster values from the dashboard cache", async () => {
    const result = await dispatchChatTool("get_my_leagues", {}, ctxWithDashboard(baseDashboard())) as {
      ok: boolean;
      leagues: Array<{ leagueId: string; roster: Array<{ playerId: string; value: number | null }> }>;
    };
    expect(result.ok).toBe(true);
    expect(result.leagues[0]?.leagueId).toBe("lg1");
    expect(result.leagues[0]?.roster[0]).toMatchObject({ playerId: "p1", value: 8000 });
  });

  it("returns power rankings with a league average", async () => {
    const result = await dispatchChatTool(
      "get_power_rankings",
      { leagueId: "lg1", horizon: "week" },
      ctxWithDashboard(baseDashboard()),
    ) as {
      ok: boolean;
      teams: Array<{ rank: number }>;
      leagueAverage: { totalValue: number };
    };
    expect(result.ok).toBe(true);
    expect(result.teams).toHaveLength(2);
    expect(result.leagueAverage.totalValue).toBe(90);
  });

  it("evaluates a trade with FantasyCalc values and waiver credit", async () => {
    const result = await dispatchChatTool(
      "evaluate_trade",
      { leagueId: "lg1", givePlayerIds: ["p1"], getPlayerIds: ["p2", "pick:2027:1:1"] },
      ctxWithDashboard(baseDashboard()),
    ) as {
      ok: boolean;
      giveTotal: number;
      getTotal: number;
      waiverAdjustment: { give: number; get: number };
      verdict: string;
      primaryLabel: string;
      scoringWindow: string;
    };
    expect(result.ok).toBe(true);
    expect(result.giveTotal).toBe(8000);
    // Season Long in dynasty: pick has no redraft twin → 0 (do not mix dynasty pick value).
    expect(result.getTotal).toBe(6_000);
    // Pick at 0 means the "extra piece" waiver credit is also 0.
    expect(result.waiverAdjustment).toEqual({ give: 0, get: 0 });
    expect(result.scoringWindow).toBe("season_long");
    expect(result.primaryLabel).toMatch(/Accept|Lean accept|Decline/);
    expect(result.verdict.length).toBeGreaterThan(0);
  });

  it("returns this week's matchup projections", async () => {
    const result = await dispatchChatTool(
      "get_week_matchup",
      { leagueId: "lg1" },
      ctxWithDashboard(baseDashboard()),
    ) as {
      ok: boolean;
      teamProjection: number;
      opponent: { name: string } | null;
    };
    expect(result.ok).toBe(true);
    expect(result.teamProjection).toBe(120.5);
    expect(result.opponent?.name).toBe("Rival");
  });

  it("builds a player card from rankings and values", async () => {
    const result = await dispatchChatTool(
      "get_player_card",
      { playerName: "Alpha Receiver", leagueId: "lg1" },
      ctxWithDashboard(baseDashboard()),
    ) as {
      ok: boolean;
      playerId: string;
      weekly: { leagueProjection: number | null };
      seasonLongValues: Array<{ value: number }>;
    };
    expect(result.ok).toBe(true);
    expect(result.playerId).toBe("p1");
    expect(result.weekly?.leagueProjection).toBe(18.2);
    expect(result.seasonLongValues[0]?.value).toBe(8000);
  });

  it("rejects unknown player ids and missing identity args", async () => {
    const ctx = ctxWithDashboard(baseDashboard());
    expect(await dispatchChatTool("get_player_card", {}, ctx)).toEqual({
      ok: false,
      error: "Provide playerId or playerName.",
    });
    expect(await dispatchChatTool("get_player_card", { playerId: "missing-id" }, ctx)).toEqual({
      ok: false,
      error: "Player not found.",
    });
  });

  it("prefers the league-specific weekly ranking row", async () => {
    const dashboard = baseDashboard();
    dashboard.rankings = [
      {
        ...dashboard.rankings[0]!,
        leagueId: "other",
        leagueProjection: 9.9,
        leagueRank: 99,
      },
      {
        ...dashboard.rankings[0]!,
        leagueId: "lg1",
        leagueProjection: 18.2,
        leagueRank: 1,
      },
    ];
    const result = await dispatchChatTool(
      "get_player_card",
      { playerId: "p1", leagueId: "lg1" },
      ctxWithDashboard(dashboard),
    ) as { ok: boolean; weekly: { leagueProjection: number | null; leagueRank: number } };
    expect(result.ok).toBe(true);
    expect(result.weekly.leagueProjection).toBe(18.2);
    expect(result.weekly.leagueRank).toBe(1);
  });
});
