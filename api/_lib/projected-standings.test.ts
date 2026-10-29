import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));
vi.mock("./dashboard-build.js", () => ({ readUserDashboardCache: vi.fn() }));
vi.mock("./auth.js", () => ({ resolveSleeperUserId: vi.fn() }));
vi.mock("./viewer-league-access.js", () => ({ viewerBelongsToLeague: vi.fn() }));

import {
  bestLineupTotal,
  buildProjectedStandings,
  loadProjectedStandings,
  projectedPlayerPoints,
} from "./projected-standings.js";
import { compactWeekProjections, type WeekProjections } from "./sleeper-week-projections.js";

type League = Dashboard["leagues"][number];

const week = (week: number, entries: Record<string, Record<string, number>>, asOf = "2026-10-29T00:00:00.000Z"): WeekProjections => ({
  season: 2026,
  week,
  asOf,
  players: new Map(Object.entries(entries).map(([id, stats]) => [id, { opponent: null, stats }])),
});

const player = (playerId: string, position: string, injuryStatus: string | null = null) => ({
  playerId, name: playerId, team: "KC", position, lineupSlot: null, isStarter: false, rank: null, projection: null,
  projectionSource: null, actual: null, gamePhase: null, gameTime: null, opponent: null, isAway: null, isBye: false,
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

describe("projectedPlayerPoints", () => {
  it("scores in the league's rules, including TE premium", () => {
    const wr = projectedPlayerPoints({ position: "WR", injuryStatus: null }, { stats: { rec: 5, rec_yd: 60, rec_td: 0.5 } }, league);
    const te = projectedPlayerPoints({ position: "TE", injuryStatus: null }, { stats: { rec: 5, rec_yd: 60, rec_td: 0.5 } }, league);
    expect(wr).toBeCloseTo(5 + 6 + 3, 5);
    expect(te - wr).toBeCloseTo(2.5, 5);
  });

  it("is zero for bye (no row) and for players currently out", () => {
    expect(projectedPlayerPoints({ position: "WR", injuryStatus: null }, undefined, league)).toBe(0);
    expect(projectedPlayerPoints({ position: "WR", injuryStatus: "Out" }, { stats: { rec: 9, pts_ppr: 25 } }, league)).toBe(0);
  });

  it("falls back to Sleeper's own total for DEF and when scoring settings are missing", () => {
    expect(projectedPlayerPoints({ position: "DEF", injuryStatus: null }, { stats: { pts_ppr: 8.9, pts_half_ppr: 8.9 } }, league)).toBe(8.9);
    const bare = { scoringSettings: undefined, rankingField: "halfPpr" } as unknown as League;
    expect(projectedPlayerPoints({ position: "WR", injuryStatus: null }, { stats: { rec: 5, pts_ppr: 14, pts_half_ppr: 11.5 } }, bare)).toBe(11.5);
  });
});

describe("bestLineupTotal", () => {
  it("fills slots with the best players and skips bye players", () => {
    const wk = week(5, WK);
    // WR slot takes a_wr (5 + 6 + 3 = 14); TE slot a_te (4 + 4 + 2 premium = 10).
    const total = bestLineupTotal(league.tradeTeams[0]!.players, ["WR", "TE"], wk, league);
    expect(total).toBeCloseTo(24, 5);
    const bye = bestLineupTotal(league.tradeTeams[0]!.players, ["WR", "TE"], week(6, {}), league);
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

describe("loadProjectedStandings", () => {
  const fetchWeek = async (_id: string, w: number) => (w >= 5 ? [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }] : []);

  it("loads schedule and projections for each remaining week", async () => {
    const loadProjections = vi.fn(async (_season: number, w: number) => week(w, WK));
    const result = await loadProjectedStandings(league, 2026, { fetchWeek, loadProjections });
    if ("error" in result) throw new Error(result.error);
    expect(loadProjections.mock.calls.map((c) => c[1])).toEqual([5, 6]);
    expect(result.throughWeek).toBe(4);
    expect(result.regularSeasonEndsWeek).toBe(6);
    expect(result.games.map((g) => g.week)).toEqual([5, 6]);
  });

  it("degrades per week and fails only when nothing loads", async () => {
    const partial = await loadProjectedStandings(league, 2026, {
      fetchWeek,
      loadProjections: async (_s, w) => { if (w === 6) throw new Error("down"); return week(w, WK); },
    });
    if ("error" in partial) throw new Error(partial.error);
    expect(partial.missingWeeks).toEqual([6]);
    const none = await loadProjectedStandings(league, 2026, { fetchWeek, loadProjections: async () => { throw new Error("down"); } });
    expect(none).toEqual({ error: "Sleeper projections could not be loaded." });
  });
});
