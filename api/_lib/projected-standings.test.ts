import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));
vi.mock("./dashboard-build.js", () => ({ readUserDashboardCache: vi.fn() }));
vi.mock("./auth.js", () => ({ resolveSleeperUserId: vi.fn() }));
vi.mock("./viewer-league-access.js", () => ({ viewerBelongsToLeague: vi.fn() }));

import {
  alignToSlots,
  currentWeekLineupTotal,
  bestLineupTotal,
  buildProjectedStandings,
  loadLeagueAverageMatch,
  loadProjectedStandings,
  projectedPlayerPoints,
  sleeperWeekPoints,
} from "./projected-standings.js";
import { compactWeekProjections, type WeekProjections } from "./sleeper-week-projections.js";

type League = Dashboard["leagues"][number];

const week = (week: number, entries: Record<string, Record<string, number>>, asOf = "2026-10-29T00:00:00.000Z"): WeekProjections => ({
  season: 2026,
  week,
  asOf,
  players: new Map(Object.entries(entries).map(([id, stats]) => [id, { opponent: null, stats }])),
});

const player = (playerId: string, position: string, injuryStatus: string | null = null, projection: number | null = null, isBye = false) => ({
  playerId, name: playerId, team: "KC", position, lineupSlot: null, isStarter: false, rank: null, projection,
  projectionSource: null, actual: null, gamePhase: null, gameTime: null, opponent: null, isAway: null, isBye,
  injuryStatus, defenseComponents: null, projectionComponents: null,
});

const standing = (rosterId: number, teamName: string, wins: number, losses: number, pointsFor: number, isUser = false) => ({
  rosterId, teamName, isUser, rank: rosterId, wins, losses, ties: 0, pointsFor, pointsAgainst: 0, playoffSeed: null, gamesOutOfPlayoffs: null,
});

const league = {
  id: "lg",
  scoringSettings: { rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5 },
  rankingField: "ppr",
  tradeStarterSlots: ["WR", "TE"],
  starters: [],
  standings: [standing(1, "A", 3, 1, 400, true), standing(2, "B", 2, 2, 380), standing(3, "C", 1, 3, 350)],
  playoffs: { teams: 1, weekStart: 7, positionKnown: true },
  tradeTeams: [
    { rosterId: 1, players: [player("a_wr", "WR"), player("a_te", "TE"), player("a_wr2", "WR")] },
    { rosterId: 2, players: [player("b_wr", "WR"), player("b_te", "TE")] },
    { rosterId: 3, players: [player("c_wr", "WR", "Out"), player("c_te", "TE")] },
  ],
} as unknown as League;

const WK = { a_wr: { rec: 5, rec_yd: 60, rec_td: 0.5, pts_ppr: 14 }, a_wr2: { rec: 2, rec_yd: 20, pts_ppr: 4 }, a_te: { rec: 4, rec_yd: 40, pts_ppr: 10 },
  b_wr: { rec: 6, rec_yd: 80, rec_td: 0.6, pts_ppr: 18 }, b_te: { rec: 3, rec_yd: 30, pts_ppr: 8 },
  c_wr: { rec: 9, rec_yd: 100, pts_ppr: 25 }, c_te: { rec: 2, rec_yd: 20, pts_ppr: 5 } };

describe("compactWeekProjections", () => {
  it("keeps only projected players and scoring keys", () => {
    const stored = compactWeekProjections([
      { player_id: "1", opponent: "CHI", stats: { pts_ppr: 12.5, rec: 4, rec_yd: 50, adp_dd_ppr: 9, gp: 1, rec_0_4: 1 } },
      { player_id: "2", stats: {} },
      { player_id: "3", stats: { pts_ppr: 0, rec: 0 } },
      { stats: { pts_ppr: 5 } },
    ], "2026-10-29T00:00:00.000Z");
    expect(Object.keys(stored.rows)).toEqual(["1"]);
    expect(stored.rows["1"]).toEqual(["CHI", { pts_ppr: 12.5, rec: 4, rec_yd: 50 }]);
  });

  it("tolerates non-array input", () => {
    expect(compactWeekProjections({ error: true }, "x").rows).toEqual({});
  });
});

describe("currentWeekLineupTotal", () => {
  const slots = ["WR", "TE"];

  it("uses the app's projection for players who have not played", () => {
    expect(currentWeekLineupTotal([player("w", "WR", null, 12.5), player("t", "TE", null, 7)], slots)).toBe(19.5);
  });

  it("zeroes bye and unavailable players, and treats missing projections as zero", () => {
    expect(currentWeekLineupTotal([player("w", "WR", null, 12.5, true), player("t", "TE", "Out", 7)], slots)).toBe(0);
    expect(currentWeekLineupTotal([player("w", "WR", null, null)], slots)).toBe(0);
  });

  it("counts actual points for a starter whose game is final, not the pregame projection", () => {
    const scored = { ...player("w", "WR", null, 8), isStarter: true, lineupSlot: "WR", gamePhase: "final" as const, actual: 35 };
    const total = currentWeekLineupTotal([scored, { ...player("t", "TE", null, 7), isStarter: true, lineupSlot: "TE", gamePhase: "pregame" as const }], slots);
    expect(total).toBe(42);
  });

  it("scores the lineup a team has set, not its best lineup, like the Matchup view", () => {
    const starter = { ...player("w", "WR", null, 5), isStarter: true, lineupSlot: "WR", gamePhase: "pregame" as const };
    const byeStarter = { ...player("t", "TE", null, 9, true), isStarter: true, lineupSlot: "TE" };
    const benchStar = player("w2", "WR", null, 20);
    expect(currentWeekLineupTotal([starter, byeStarter, benchStar], slots)).toBe(5);
  });
});

describe("projectedPlayerPoints", () => {
  it("scores in the league's rules, including TE premium", () => {
    const wr = projectedPlayerPoints({ position: "WR" }, { stats: { rec: 5, rec_yd: 60, rec_td: 0.5 } }, league);
    const te = projectedPlayerPoints({ position: "TE" }, { stats: { rec: 5, rec_yd: 60, rec_td: 0.5 } }, league);
    expect(wr).toBeCloseTo(5 + 6 + 3, 5);
    expect(te - wr).toBeCloseTo(2.5, 5);
  });

  it("is zero when Sleeper has no row (bye, or out that week)", () => {
    expect(projectedPlayerPoints({ position: "WR" }, undefined, league)).toBe(0);
  });

  it("counts a currently injured player in a later week Sleeper projects him", () => {
    const w = week(11, { c_wr: { rec: 9, rec_yd: 100, pts_ppr: 25 } });
    const injured = player("c_wr", "WR", "Out");
    expect(sleeperWeekPoints(w, league)(injured)).toBeGreaterThan(0);
    expect(sleeperWeekPoints(week(9, {}), league)(injured)).toBe(0);
  });

  it("rescores a defense in the league's rules and falls back to Sleeper's total without settings", () => {
    const defStats = { sack: 3, int: 1, pts_allow: 17, pts_ppr: 8.9, pts_half_ppr: 8.9 };
    const custom = { scoringSettings: { sack: 2, int: 3, pts_allow_14_20: 1 }, rankingField: "ppr" } as unknown as League;
    expect(projectedPlayerPoints({ position: "DEF" }, { stats: defStats }, custom)).toBe(3 * 2 + 1 * 3 + 1);
    const bare = { scoringSettings: undefined, rankingField: "ppr" } as unknown as League;
    expect(projectedPlayerPoints({ position: "DEF" }, { stats: defStats }, bare)).toBe(8.9);
  });

  it("falls back to Sleeper's own total for DEF and when scoring settings are missing", () => {
    expect(projectedPlayerPoints({ position: "DEF" }, { stats: { pts_ppr: 8.9, pts_half_ppr: 8.9 } }, league)).toBe(8.9);
    const bare = { scoringSettings: undefined, rankingField: "halfPpr" } as unknown as League;
    expect(projectedPlayerPoints({ position: "WR" }, { stats: { rec: 5, pts_ppr: 14, pts_half_ppr: 11.5 } }, bare)).toBe(11.5);
  });
});

describe("bestLineupTotal", () => {
  it("fills slots with the best players and skips bye players", () => {
    const wk = week(5, WK);
    // WR slot takes a_wr (5 + 6 + 3 = 14); TE slot a_te (4 + 4 + 2 premium = 10).
    const total = bestLineupTotal(league.tradeTeams[0]!.players, ["WR", "TE"], sleeperWeekPoints(wk, league));
    expect(total).toBeCloseTo(24, 5);
    const bye = bestLineupTotal(league.tradeTeams[0]!.players, ["WR", "TE"], sleeperWeekPoints(week(6, {}), league));
    expect(bye).toBe(0);
  });
});

describe("buildProjectedStandings", () => {
  const weeks = new Map([[5, week(5, WK)], [6, week(6, WK)]]);
  it("awards each game to the higher projected lineup and re-ranks", () => {
    const result = buildProjectedStandings({
      league,
      weeks,
      games: [{ week: 5, a: 1, b: 2 }, { week: 6, a: 2, b: 3 }],
      throughWeek: 4,
      regularSeasonEndsWeek: 6,
      missingWeeks: [],
    });
    const byName = Object.fromEntries(result.teams.map((t) => [t.teamName, t]));
    // A: 14+TE vs B: 18+TE -> B wins week 5. B vs C (C's WR is out) -> B wins week 6.
    expect(byName.B!.projectedRecord).toEqual({ wins: 4, losses: 2, ties: 0 });
    expect(byName.A!.projectedRecord).toEqual({ wins: 3, losses: 2, ties: 0 });
    expect(byName.C!.projectedRecord).toEqual({ wins: 1, losses: 4, ties: 0 });
    expect(result.teams.map((t) => t.teamName)).toEqual(["B", "A", "C"]);
    expect(result.teams.map((t) => t.rank)).toEqual([1, 2, 3]);
    expect(byName.A!.currentRank).toBe(1);
    expect(result.teams.filter((t) => t.inPlayoffs).map((t) => t.teamName)).toEqual(["B"]);
    expect(result.games).toHaveLength(2);
    expect(result.projectionsAsOf).toBe("2026-10-29T00:00:00.000Z");
    expect(byName.B!.projectedPointsFor).toBeGreaterThan(byName.B!.pointsFor);
  });

  it("returns the viewer's games with both lineups slot by slot and a win chance", () => {
    const result = buildProjectedStandings({
      league,
      weeks,
      games: [{ week: 5, a: 1, b: 2 }, { week: 6, a: 2, b: 3 }],
      throughWeek: 4,
      regularSeasonEndsWeek: 6,
      missingWeeks: [],
    });
    // Only team A's game (week 5 vs B) belongs to the viewer.
    expect(result.userGames).toHaveLength(1);
    const game = result.userGames[0]!;
    expect(game.week).toBe(5);
    expect(game.opponentRosterId).toBe(2);
    expect(game.mine.map((slot) => slot.slot)).toEqual(["WR", "TE"]);
    expect(game.mine.map((slot) => slot.playerId)).toEqual(["a_wr", "a_te"]);
    expect(game.theirs.map((slot) => slot.playerId)).toEqual(["b_wr", "b_te"]);
    // Lineup slots add up to the game's projected totals.
    expect(game.mine.reduce((sum, slot) => sum + slot.points, 0)).toBeCloseTo(game.myTotal, 1);
    expect(game.theirs.reduce((sum, slot) => sum + slot.points, 0)).toBeCloseTo(game.theirTotal, 1);
    // A projects lower than B, so the win chance is under a coin flip but not zero.
    expect(game.winProbability).toBeGreaterThan(0);
    expect(game.winProbability).toBeLessThan(0.5);
  });

  it("adds playoff odds that sum to the number of playoff spots", () => {
    const result = buildProjectedStandings({
      league,
      weeks,
      games: [{ week: 5, a: 1, b: 2 }, { week: 6, a: 2, b: 3 }],
      throughWeek: 4,
      regularSeasonEndsWeek: 6,
      missingWeeks: [],
    });
    const odds = result.teams.map((team) => team.playoffOdds ?? 0);
    expect(odds.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2);
    const byName = Object.fromEntries(result.teams.map((t) => [t.teamName, t.playoffOdds ?? 0]));
    expect(byName.C).toBeLessThan(byName.B!);
  });

  it("scores the current week from the app's projections and later weeks from Sleeper", () => {
    const appLeague = {
      ...league,
      tradeTeams: [
        { rosterId: 1, players: [player("a_wr", "WR", null, 30), player("a_te", "TE", null, 10)] },
        { rosterId: 2, players: [player("b_wr", "WR", null, 5), player("b_te", "TE", null, 5)] },
        { rosterId: 3, players: [player("c_wr", "WR", null, 1), player("c_te", "TE", null, 1)] },
      ],
    } as unknown as League;
    const result = buildProjectedStandings({
      league: appLeague,
      weeks: new Map([[6, week(6, WK)]]),
      appWeek: 5,
      games: [{ week: 5, a: 1, b: 2 }, { week: 6, a: 1, b: 2 }],
      throughWeek: 4,
      regularSeasonEndsWeek: 6,
      missingWeeks: [],
    });
    // Week 5 (app): A 40 vs B 10 -> A. Week 6 (Sleeper): B's WR out-scores A's -> B.
    const a = result.teams.find((t) => t.teamName === "A")!;
    const game5 = result.games.find((g) => g.week === 5)!;
    expect(game5.projectedA).toBe(40);
    expect(game5.projectedB).toBe(10);
    expect(a.projectedRecord).toEqual({ wins: 4, losses: 2, ties: 0 });
  });

  it("draws no playoff cut when divisions are not modeled", () => {
    const divisional = { ...league, playoffs: { teams: 1, weekStart: 7, positionKnown: false } } as unknown as League;
    const result = buildProjectedStandings({
      league: divisional, weeks, games: [{ week: 5, a: 1, b: 2 }], throughWeek: 4, regularSeasonEndsWeek: 6, missingWeeks: [],
    });
    expect(result.divisionsIgnored).toBe(true);
    expect(result.teams.some((t) => t.inPlayoffs)).toBe(false);
    expect(result.teams.every((t) => t.playoffOdds === null)).toBe(true);
  });

  it("leaves current standings untouched when nothing remains", () => {
    const result = buildProjectedStandings({ league, weeks: new Map(), games: [], throughWeek: 4, regularSeasonEndsWeek: 4, missingWeeks: [] });
    expect(result.teams.map((t) => t.teamName)).toEqual(["A", "B", "C"]);
    expect(result.teams[0]!.projectedRecord).toEqual({ wins: 3, losses: 1, ties: 0 });
  });

  it("uses a team's average for a week without projections", () => {
    const result = buildProjectedStandings({
      league, weeks: new Map([[5, week(5, WK)]]), games: [{ week: 5, a: 1, b: 2 }, { week: 6, a: 1, b: 2 }],
      throughWeek: 4, regularSeasonEndsWeek: 6, missingWeeks: [6],
    });
    expect(result.missingWeeks).toEqual([6]);
    expect(result.games).toHaveLength(2);
  });
});

describe("median matchups", () => {
  const weeks = new Map([[5, week(5, WK)]]);

  it("detects the league-average-match setting", async () => {
    expect(await loadLeagueAverageMatch("lg", async () => ({ settings: { league_average_match: 1 } }))).toBe(true);
    expect(await loadLeagueAverageMatch("lg", async () => ({ settings: { league_average_match: 0 } }))).toBe(false);
    expect(await loadLeagueAverageMatch("lg", async () => ({}))).toBe(false);
  });

  it("adds a win or loss against the weekly median for every team", () => {
    const args = { league, weeks, games: [{ week: 5, a: 1, b: 2 }], throughWeek: 4, regularSeasonEndsWeek: 5, missingWeeks: [] };
    const plain = buildProjectedStandings(args);
    const withMedian = buildProjectedStandings({ ...args, medianMatchup: true });
    const total = (r: { wins: number; losses: number; ties: number }) => r.wins + r.losses + r.ties;
    for (const team of withMedian.teams) {
      const before = plain.teams.find((t) => t.teamName === team.teamName)!;
      expect(total(team.projectedRecord) - total(before.projectedRecord)).toBe(1);
    }
  });

  it("awards the median result by score: above wins, at it ties, below loses", () => {
    const appLeague = {
      ...league,
      tradeTeams: [
        { rosterId: 1, players: [player("a_wr", "WR", null, 30), player("a_te", "TE", null, 10)] },
        { rosterId: 2, players: [player("b_wr", "WR", null, 10), player("b_te", "TE", null, 10)] },
        { rosterId: 3, players: [player("c_wr", "WR", null, 1), player("c_te", "TE", null, 1)] },
      ],
    } as unknown as League;
    const base = { league: appLeague, weeks: new Map<number, WeekProjections>(), appWeek: 5, games: [{ week: 5, a: 1, b: 2 }], throughWeek: 4, regularSeasonEndsWeek: 5, missingWeeks: [] };
    const plain = buildProjectedStandings(base);
    const withMedian = buildProjectedStandings({ ...base, medianMatchup: true });
    const delta = (name: string) => {
      const x = withMedian.teams.find((t) => t.teamName === name)!.projectedRecord;
      const y = plain.teams.find((t) => t.teamName === name)!.projectedRecord;
      return { w: x.wins - y.wins, l: x.losses - y.losses, t: x.ties - y.ties };
    };
    expect(delta("A")).toEqual({ w: 1, l: 0, t: 0 });
    expect(delta("B")).toEqual({ w: 0, l: 0, t: 1 });
    expect(delta("C")).toEqual({ w: 0, l: 1, t: 0 });
  });

  it("counts completed weeks as half the recorded results", async () => {
    const doubled = {
      ...league,
      standings: league.standings.map((row) => ({ ...row, wins: row.wins * 2, losses: row.losses * 2 })),
    } as unknown as League;
    const result = await loadProjectedStandings(doubled, 2026, 5, {
      fetchLeague: async () => ({ settings: { league_average_match: 1 } }),
      fetchWeek: async () => [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }],
      loadProjections: async (_s, w) => week(w, WK),
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.throughWeek).toBe(4);
    expect(result.games.map((g) => g.week)).toEqual([5, 6]);
  });

  it("withholds the table when league settings cannot be read", async () => {
    const result = await loadProjectedStandings(league, 2026, 5, {
      fetchLeague: async () => { throw new Error("down"); },
      fetchWeek: async () => [],
      loadProjections: async (_s, w) => week(w, WK),
    });
    expect(result).toEqual({ error: "League settings could not be loaded from Sleeper." });
  });
});

describe("loadProjectedStandings", () => {
  const fetchLeague = async () => ({});
  const fetchWeek = async (_id: string, w: number) => (w >= 5 ? [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }] : []);

  it("loads schedule and projections for each remaining week", async () => {
    const loadProjections = vi.fn(async (_season: number, w: number) => week(w, WK));
    const result = await loadProjectedStandings(league, 2026, 5, { fetchLeague, fetchWeek, loadProjections });
    if ("error" in result) throw new Error(result.error);
    // Week 5 is the current week (app projections), so only week 6 comes from Sleeper.
    expect(loadProjections.mock.calls.map((c) => c[1])).toEqual([6]);
    expect(result.throughWeek).toBe(4);
    expect(result.regularSeasonEndsWeek).toBe(6);
    expect(result.games.map((g) => g.week)).toEqual([5, 6]);
  });

  it("withholds the table when a matchup week cannot be loaded", async () => {
    const result = await loadProjectedStandings(league, 2026, 5, {
      fetchLeague,
      fetchWeek: async (_id, w) => { if (w === 6) throw new Error("down"); return fetchWeek(_id, w); },
      loadProjections: async (_s, w) => week(w, WK),
    });
    expect(result).toEqual({ error: "The remaining schedule could not be fully loaded from Sleeper." });
  });

  it("retries a failed projection week once, then withholds the table", async () => {
    let calls = 0;
    const flaky = await loadProjectedStandings(league, 2026, 3, {
      fetchLeague,
      fetchWeek,
      loadProjections: async (_s, w) => { if (w === 6 && ++calls === 1) throw new Error("down"); return week(w, WK); },
    });
    expect("error" in flaky).toBe(false);
    expect(calls).toBe(2);
    const down = await loadProjectedStandings(league, 2026, 3, {
      fetchLeague,
      fetchWeek,
      loadProjections: async (_s, w) => { if (w === 6) throw new Error("down"); return week(w, WK); },
    });
    expect(down).toEqual({ error: "Sleeper projections could not be fully loaded." });
    const none = await loadProjectedStandings(league, 2026, 5, { fetchLeague, fetchWeek, loadProjections: async () => { throw new Error("down"); } });
    expect(none).toEqual({ error: "Sleeper projections could not be fully loaded." });
  });
});


describe("alignToSlots", () => {
  const slot = (slotName: string, playerId: string) => ({ slot: slotName, playerId, name: playerId, points: 10 });

  it("keeps an unfilled slot in place so later slots still line up", () => {
    // A team with no QB: its RB must not land in the QB slot.
    const aligned = alignToSlots(["QB", "RB", "WR", "FLEX"], [slot("RB", "rb1"), slot("WR", "wr1"), slot("FLEX", "wr2")]);
    expect(aligned.map((entry) => [entry.slot, entry.playerId])).toEqual([["QB", null], ["RB", "rb1"], ["WR", "wr1"], ["FLEX", "wr2"]]);
    expect(aligned[0]!.points).toBe(0);
  });

  it("fills repeated slots in order and keeps a starter whose slot isn't listed", () => {
    const aligned = alignToSlots(["WR", "WR"], [slot("WR", "a"), slot("WR", "b"), slot("SUPER_FLEX", "c")]);
    expect(aligned.map((entry) => entry.playerId)).toEqual(["a", "b", "c"]);
  });
});
