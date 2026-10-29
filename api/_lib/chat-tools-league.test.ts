import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";
import { dispatchChatTool, CHAT_TOOL_NAMES, type ChatToolContext } from "./chat-tools.js";
import { leagueRulesPromptLine, summarizeLeagueRules } from "./league-rules.js";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));
vi.mock("./sleeper.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sleeper.js")>();
  return {
    ...actual,
    fetchJson: vi.fn(async (url: string) => {
      const week = Number(url.split("/").pop());
      return week >= 9
        ? [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }]
        : [];
    }),
  };
});

const power = (rosterId: number, teamName: string, isUser: boolean, rb: number, wr: number) => ({
  rosterId,
  teamName,
  record: { wins: 4, losses: 4, ties: 0 },
  rank: rosterId,
  totalValue: rb + wr + 3000,
  futurePickValue: 0,
  positionValues: { QB: 1000, RB: rb, WR: wr, TE: 1000, FLEX: 0, K: 0, DEF: 0 },
  isUser,
});

const standing = (rosterId: number, teamName: string, isUser: boolean, wins: number, pointsFor: number) => ({
  rosterId,
  teamName,
  isUser,
  rank: rosterId,
  wins,
  losses: 8 - wins,
  ties: 0,
  pointsFor,
  pointsAgainst: 800,
  playoffSeed: null,
  gamesOutOfPlayoffs: null,
});

const player = (playerId: string, name: string, position: string) => ({
  playerId,
  name,
  team: "KC",
  position,
  lineupSlot: null,
  isStarter: false,
  projection: 10,
  injuryStatus: null,
});

const dashboard = {
  season: 2026,
  week: 9,
  playerTrending: { p3: { adds: 20000, drops: 100 } },
  leagues: [
    {
      id: "lg1",
      name: "Test League",
      scoringLabel: "PPR",
      scoringSettings: { rec: 1, bonus_rec_te: 0.5, pass_td: 4, rush_td: 6, pass_int: 0 },
      starters: [player("p1", "Alpha Receiver", "WR")],
      bench: [],
      rosteredPlayerIds: ["p1", "p2"],
      rosterAssignments: [
        { playerId: "p1", teamName: "My Team", isUser: true },
        { playerId: "p2", teamName: "Rival", isUser: false },
      ],
      rankingPositions: ["QB", "RB", "WR", "TE"],
      seasonLongFormat: { key: "redraft", isDynasty: false, numQbs: 1, numTeams: 2, ppr: 1, label: "Redraft" },
      tradeValuation: { unsupportedSettings: [], projectionAsOf: null, optimizerVersion: "lineup-dp-v1" },
      tradeStarterSlots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"],
      tradeTeams: [
        { rosterId: 1, ownerId: "a", teamName: "My Team", isUser: true, players: [player("p1", "Alpha Receiver", "WR")], ownedPicks: [] },
        { rosterId: 2, ownerId: "b", teamName: "Rival", isUser: false, players: [player("p2", "Beta Back", "RB")], ownedPicks: [] },
      ],
      powerRankingsWeek: [],
      powerRankingsSeasonLong: [power(1, "My Team", true, 2000, 6000), power(2, "Rival", false, 6000, 2000)],
      powerRankingsDynasty: [],
      standings: [standing(1, "My Team", true, 4, 800), standing(2, "Rival", false, 4, 790)],
      playoffs: { teams: 1, weekStart: 11, positionKnown: true },
      waivers: { type: "faab", budget: 100, remaining: 80, position: 3, teams: 2 },
    },
  ],
  rankings: [
    { leagueId: "lg1", playerId: "p1", name: "Alpha Receiver", team: "KC", position: "WR", leagueProjection: 18, leagueRank: 1, opponent: "LV", isBye: false, injuryStatus: null },
    { leagueId: "lg1", playerId: "p2", name: "Beta Back", team: "SF", position: "RB", leagueProjection: 15, leagueRank: 2, opponent: "LV", isBye: false, injuryStatus: null },
    { leagueId: "lg1", playerId: "p3", name: "Free Agent WR", team: "DEN", position: "WR", leagueProjection: 12, leagueRank: 30, opponent: "LV", isBye: false, injuryStatus: null },
  ],
  seasonLongRankings: [
    { formatKey: "redraft", playerId: "p1", name: "Alpha Receiver", team: "KC", position: "WR", overallRank: 5, positionRank: 2, value: 8000, trend30Day: 100, isRookie: false },
    { formatKey: "redraft", playerId: "p3", name: "Free Agent WR", team: "DEN", position: "WR", overallRank: 90, positionRank: 40, value: 1500, trend30Day: 50, isRookie: false },
  ],
} as unknown as Dashboard;

function ctx(): ChatToolContext {
  return { userId: "u", sleeperUserId: "s", dashboardPromise: Promise.resolve(dashboard), defaultLeagueId: "lg1" };
}

describe("league chat tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers the new tools", () => {
    for (const name of ["get_league_rules", "get_league_teams", "search_players", "get_projected_standings", "get_playoff_odds"]) {
      expect(CHAT_TOOL_NAMES).toContain(name);
    }
  });

  it("get_league_rules reports scoring, slots, playoffs and waivers", async () => {
    const result = (await dispatchChatTool("get_league_rules", { leagueId: "lg1" }, ctx())) as {
      ok: true;
      rules: ReturnType<typeof summarizeLeagueRules>;
    };
    expect(result.ok).toBe(true);
    expect(result.rules.pointsPerReception).toBe(1);
    expect(result.rules.scoringSettings).not.toHaveProperty("pass_int");
    expect(result.rules.scoringHighlights.join(" ")).toContain("TE premium");
    expect(result.rules.starterSlots).toMatchObject({ RB: 2, WR: 2, FLEX: 1 });
    expect(result.rules.hasFlex).toBe(true);
    expect(result.rules.hasSuperflex).toBe(false);
    expect(result.rules.playoffs).toEqual({ teams: 1, weekStart: 11, regularSeasonEndsWeek: 10 });
    expect(result.rules.waivers?.type).toBe("faab");
  });

  it("builds a bounded one-line prompt summary", () => {
    const line = leagueRulesPromptLine(summarizeLeagueRules(dashboard.leagues[0]!));
    expect(line).toContain("2x");
    expect(line).toContain("FAAB");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThanOrEqual(600);
  });

  it("get_league_teams finds strengths, needs and trade fit", async () => {
    const result = (await dispatchChatTool("get_league_teams", { leagueId: "lg1" }, ctx())) as {
      ok: true;
      teams: Array<{ teamName: string; strengths: string[]; needs: string[]; tradeFit: { theyCanOffer: string[]; theyNeedWhatYouHave: string[] } | null }>;
    };
    const rival = result.teams.find((team) => team.teamName === "Rival")!;
    expect(rival.strengths).toContain("RB");
    expect(rival.needs).toContain("WR");
    expect(rival.tradeFit).toEqual({ theyCanOffer: ["RB"], theyNeedWhatYouHave: ["WR"] });
    const me = result.teams.find((team) => team.teamName === "My Team")!;
    expect(me.tradeFit).toBeNull();

    const one = (await dispatchChatTool("get_league_teams", { leagueId: "lg1", teamName: "riv" }, ctx())) as {
      teams: Array<{ roster?: unknown[] }>;
    };
    expect(one.teams).toHaveLength(1);
    expect(one.teams[0]!.roster).toHaveLength(1);
  });

  it("search_players filters free agents and compares by name", async () => {
    const free = (await dispatchChatTool("search_players", { position: "WR", availability: "free_agent" }, ctx())) as {
      players: Array<{ name: string; owner: string }>;
    };
    expect(free.players.map((row) => row.name)).toEqual(["Free Agent WR"]);
    expect(free.players[0]!.owner).toBe("free agent");

    const compared = (await dispatchChatTool("search_players", { names: ["alpha", "free agent wr", "nobody"] }, ctx())) as {
      players: Array<{ name: string; owner: string; sleeperAdds: number | null }>;
      unmatched?: number;
    };
    expect(compared.players.map((row) => row.name)).toEqual(["Alpha Receiver", "Free Agent WR"]);
    expect(compared.players[0]!.owner).toBe("you");
    expect(compared.players[1]!.sleeperAdds).toBe(20000);
    expect(compared.unmatched).toBe(1);
  });

  it("get_playoff_odds simulates the remaining schedule", async () => {
    const result = (await dispatchChatTool("get_playoff_odds", { leagueId: "lg1" }, ctx())) as {
      ok: true;
      regularSeasonEndsWeek: number;
      you: { playoffPct: number; remainingGames: Array<{ opponentName: string; winProbability: number }>; finalWinScenarios: Array<{ finalWins: number }> };
      teams: unknown[];
    };
    expect(result.ok).toBe(true);
    expect(result.regularSeasonEndsWeek).toBe(10);
    expect(result.you.remainingGames.length).toBeGreaterThan(0);
    expect(result.you.remainingGames[0]!.opponentName).toBe("Rival");
    expect(result.you.remainingGames[0]!.winProbability).toBeGreaterThan(0);
    expect(result.you.playoffPct).toBeGreaterThan(0);
    expect(result.teams).toHaveLength(2);
  });

  it("rejects bad arguments and unknown leagues", async () => {
    expect(await dispatchChatTool("get_league_rules", {}, ctx())).toMatchObject({ ok: false });
    expect(await dispatchChatTool("get_playoff_odds", { leagueId: "nope" }, ctx())).toMatchObject({ ok: false });
  });
});
