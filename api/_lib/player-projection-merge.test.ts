import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { rankingSchema } from "./dashboard-schemas.js";
import {
  applyActualRanks,
  applyDefenseActualRanks,
  bookRangePoints,
  finalizeDefenseActualDisplay,
  mergePlayerProjections,
  nonKickerProjectionCount,
  projectionBoardIsUsable,
  type DefenseActualRow,
  type ProjectionSnapshot,
  type SleeperProjection,
} from "./player-projection-merge.js";
import { scoreProjectedPlayerStats } from "./sleeper.js";

type Ranking = z.infer<typeof rankingSchema>;

const LEAGUE_ID = "league-1";
const PPR = { rec: 1, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, pass_yd: 0.04, pass_td: 4, pass_int: -2 } as const;

function baseRow(partial: Partial<Ranking> & Pick<Ranking, "playerId" | "name" | "position" | "team">): Ranking {
  return {
    leagueId: "",
    opponent: "BUF",
    isAway: false,
    isBye: false,
    pprRank: 999,
    halfPprRank: 999,
    leagueRank: 999,
    ppr: null,
    halfPpr: null,
    standard: null,
    leagueProjection: null,
    vegasProjection: null,
    sleeperProjection: null,
    projectionSource: "fallback",
    projectionComponents: null,
    injuryStatus: null,
    gameTime: null,
    actual: null,
    gamePhase: null,
    ...partial,
  };
}

function vegasRow(player: string, team: string, position: string, stats: Record<string, number>, points: number) {
  return {
    player,
    team,
    position,
    opponent: "BUF",
    expected_stats: stats,
    td_probability: stats.rec_td ?? stats.rush_td ?? null,
    coverage: { stats: Object.keys(stats), provider_count: 2, book_count: 3 },
    leagues: { [LEAGUE_ID]: points },
    components: { [LEAGUE_ID]: { projected_points: points } },
  };
}

function firstDownRow(player: string, team: string, position: string, points: number) {
  return {
    player,
    team,
    position,
    opponent: "BUF",
    expected_stats: { projected_points: points },
    td_probability: 0,
    coverage: { stats: ["projected_points"], provider_count: 1, book_count: 1 },
    leagues: { [LEAGUE_ID]: points },
    components: { [LEAGUE_ID]: { projected_points: points } },
  };
}

function snapshot(source: string, projections: ProjectionSnapshot["projections"]): ProjectionSnapshot {
  return {
    season: 2026,
    week: 7,
    built_at: "2026-10-14T12:00:00.000Z",
    source,
    leagues: [{ league_id: LEAGUE_ID, name: "Test" }],
    projections,
  };
}

describe("projectionBoardIsUsable", () => {
  it("keeps a thin Vegas board that has at least one non-K player", () => {
    const thin = snapshot("vegas-consensus", [
      vegasRow("Tyler Warren", "IND", "TE", { rec: 4, rec_yards: 45 }, 8.5),
      vegasRow("Some Kicker", "IND", "K", { xpm: 2 }, 2),
    ]);
    expect(thin.projections.length).toBeLessThan(200);
    expect(projectionBoardIsUsable(thin)).toBe(true);
    expect(nonKickerProjectionCount(thin)).toBe(1);
  });

  it("rejects empty or kickers-only Vegas boards", () => {
    expect(projectionBoardIsUsable(snapshot("vegas-consensus", []))).toBe(false);
    expect(projectionBoardIsUsable(snapshot("vegas-consensus", [
      vegasRow("Only Kicker", "KC", "K", { xpm: 3 }, 3),
    ]))).toBe(false);
  });

  it("keeps the First Down 150-player floor", () => {
    const rows = Array.from({ length: 149 }, (_, i) => firstDownRow(`Player ${i}`, "KC", "WR", 10));
    expect(projectionBoardIsUsable(snapshot("first_down", rows))).toBe(false);
    rows.push(firstDownRow("Player 149", "KC", "WR", 10));
    expect(projectionBoardIsUsable(snapshot("first_down", rows))).toBe(true);
  });
});

describe("mergePlayerProjections", () => {
  const warren = baseRow({ playerId: "warren", name: "Tyler Warren", position: "TE", team: "IND" });
  const judkins = baseRow({ playerId: "judkins", name: "Quinshon Judkins", position: "RB", team: "CLE" });
  const outRb = baseRow({
    playerId: "out-rb",
    name: "Out Back",
    position: "RB",
    team: "DAL",
    injuryStatus: "Out",
  });

  it("uses thin Vegas as primary and First Down gap-fill for missing players", () => {
    const vegas = snapshot("vegas-consensus", [
      vegasRow("Tyler Warren", "IND", "TE", { rec: 5, rec_yards: 55, rec_tds: 0.3 }, 12.5),
    ]);
    const firstDown = snapshot("first_down", [
      firstDownRow("Tyler Warren", "IND", "TE", 11),
      firstDownRow("Quinshon Judkins", "CLE", "RB", 14.2),
    ]);
    const sleeper = new Map<string, SleeperProjection>([
      ["judkins", { player_id: "judkins", stats: { rush_yd: 60, rush_td: 0.4, rec: 2, rec_yd: 15 } }],
    ]);

    const merged = mergePlayerProjections(
      LEAGUE_ID,
      "ppr",
      [warren, judkins],
      vegas,
      firstDown,
      true,
      sleeper,
      PPR,
    );

    const warrenRow = merged.find((row) => row.playerId === "warren");
    const judkinsRow = merged.find((row) => row.playerId === "judkins");
    expect(warrenRow?.projectionSource).toBe("vegas");
    expect(warrenRow?.leagueProjection).not.toBeNull();
    expect(judkinsRow?.projectionSource).toBe("first_down");
    expect(judkinsRow?.leagueProjection).toBe(14.2);
  });

  it("uses Sleeper as last-resort when both boards miss the player", () => {
    const vegas = snapshot("vegas-consensus", [
      vegasRow("Tyler Warren", "IND", "TE", { rec: 4, rec_yards: 40 }, 8),
    ]);
    const firstDown = snapshot("first_down", [
      firstDownRow("Tyler Warren", "IND", "TE", 9),
    ]);
    const sleeper = new Map<string, SleeperProjection>([
      ["judkins", { player_id: "judkins", stats: { rush_yd: 70, rush_td: 0.5, rec: 1, rec_yd: 8 } }],
    ]);

    const merged = mergePlayerProjections(
      LEAGUE_ID,
      "ppr",
      [warren, judkins],
      vegas,
      firstDown,
      true,
      sleeper,
      PPR,
    );

    const judkinsRow = merged.find((row) => row.playerId === "judkins");
    expect(judkinsRow?.projectionSource).toBe("sleeper");
    expect(judkinsRow?.leagueProjection).toBeCloseTo(70 * 0.1 + 0.5 * 6 + 1 + 8 * 0.1, 5);
    expect(judkinsRow?.sleeperProjection).toBe(judkinsRow?.leagueProjection);
  });

  it("keeps unavailable players at 0 even when Sleeper has a projection", () => {
    const sleeper = new Map<string, SleeperProjection>([
      ["out-rb", { player_id: "out-rb", stats: { rush_yd: 80, rush_td: 1 } }],
    ]);

    const merged = mergePlayerProjections(
      LEAGUE_ID,
      "ppr",
      [outRb],
      snapshot("vegas-consensus", []),
      null,
      false,
      sleeper,
      PPR,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.leagueProjection).toBe(0);
    expect(merged[0]?.projectionSource).toBe("fallback");
    expect(merged[0]?.sleeperProjection).toBeNull();
  });

  it("ranks kickers by projection, not by opposing defense", () => {
    const lowKicker = baseRow({ playerId: "k-low", name: "Low Kicker", position: "K", team: "MIA", opponent: "CLE" });
    const highKicker = baseRow({ playerId: "k-high", name: "High Kicker", position: "K", team: "DAL", opponent: "BUF" });
    const sleeper = new Map<string, SleeperProjection>([
      ["k-low", { player_id: "k-low", stats: { fgm: 2, xpm: 1 } }],
      ["k-high", { player_id: "k-high", stats: { fgm: 3, xpm: 2 } }],
    ]);

    const merged = mergePlayerProjections(
      LEAGUE_ID,
      "ppr",
      [lowKicker, highKicker],
      snapshot("vegas-consensus", []),
      null,
      false,
      sleeper,
      { fgm: 3, xpm: 1 },
    );

    const highRow = merged.find((row) => row.playerId === "k-high");
    const lowRow = merged.find((row) => row.playerId === "k-low");
    expect(highRow?.leagueProjection).toBe(11);
    expect(lowRow?.leagueProjection).toBe(7);
    expect(highRow?.pprRank).toBe(1);
    expect(lowRow?.pprRank).toBe(2);
  });
});

describe("applyActualRanks", () => {
  it("moves a final player who outscored every projection to the top of his group", () => {
    const rows = [
      baseRow({ playerId: "a", name: "Alpha", position: "WR", team: "BUF", leagueProjection: 18, gamePhase: "pregame" }),
      baseRow({ playerId: "b", name: "Bravo", position: "WR", team: "MIA", leagueProjection: 15, gamePhase: "final", actual: 27.4 }),
      baseRow({ playerId: "c", name: "Charlie", position: "WR", team: "NYJ", leagueProjection: 12, gamePhase: "pregame" }),
    ];
    applyActualRanks(rows, "ppr");
    expect(rows.map((row) => [row.playerId, row.leagueRank, row.pprRank])).toEqual([
      ["a", 2, 2],
      ["b", 1, 1],
      ["c", 3, 3],
    ]);
  });

  it("drops a final player who underscored below the remaining projections", () => {
    const rows = [
      baseRow({ playerId: "a", name: "Alpha", position: "RB", team: "BUF", leagueProjection: 20, gamePhase: "pregame" }),
      baseRow({ playerId: "b", name: "Bravo", position: "RB", team: "MIA", leagueProjection: 19, gamePhase: "final", actual: 4.2 }),
      baseRow({ playerId: "c", name: "Charlie", position: "RB", team: "NYJ", leagueProjection: 10, gamePhase: "pregame" }),
    ];
    applyActualRanks(rows, "halfPpr");
    expect(rows.map((row) => [row.playerId, row.leagueRank, row.halfPprRank])).toEqual([
      ["a", 1, 1],
      ["b", 3, 3],
      ["c", 2, 2],
    ]);
    // The other lens rank is untouched.
    expect(rows.every((row) => row.pprRank === 999)).toBe(true);
  });

  it("keeps live and pregame players on projection order, and a final player without an actual on his projection", () => {
    const rows = [
      baseRow({ playerId: "a", name: "Alpha", position: "QB", team: "BUF", leagueProjection: 22, gamePhase: "live", actual: 30 }),
      baseRow({ playerId: "b", name: "Bravo", position: "QB", team: "MIA", leagueProjection: 24, gamePhase: "pregame" }),
      baseRow({ playerId: "c", name: "Charlie", position: "QB", team: "NYJ", leagueProjection: 21, gamePhase: "final", actual: null }),
    ];
    applyActualRanks(rows, "ppr");
    expect(rows.map((row) => [row.playerId, row.leagueRank])).toEqual([
      ["a", 2],
      ["b", 1],
      ["c", 3],
    ]);
  });

  it("ranks each position group independently, with a final zero counting as a real score", () => {
    const rows = [
      baseRow({ playerId: "a", name: "Alpha", position: "TE", team: "BUF", leagueProjection: 9, gamePhase: "final", actual: 0 }),
      baseRow({ playerId: "b", name: "Bravo", position: "TE", team: "MIA", leagueProjection: 8, gamePhase: "pregame" }),
      baseRow({ playerId: "c", name: "Charlie", position: "K", team: "NYJ", leagueProjection: 7, gamePhase: "pregame" }),
    ];
    applyActualRanks(rows, "ppr");
    expect(rows.map((row) => [row.playerId, row.leagueRank])).toEqual([
      ["a", 2],
      ["b", 1],
      ["c", 1],
    ]);
  });
});

function defenseRow(partial: Partial<DefenseActualRow> & Pick<DefenseActualRow, "team">): DefenseActualRow {
  return {
    pregameProjection: 8,
    displayProjection: 8,
    actualScore: null,
    gamePhase: "pregame",
    rank: null,
    ...partial,
  };
}

describe("applyDefenseActualRanks", () => {
  it("re-ranks finals on actuals and keeps pregame defenses on projection order", () => {
    const rows = [
      defenseRow({ team: "BUF", pregameProjection: 12, gamePhase: "pregame", rank: 1 }),
      defenseRow({ team: "MIA", pregameProjection: 10, gamePhase: "final", actualScore: 18, rank: 2 }),
      defenseRow({ team: "NYJ", pregameProjection: 9, gamePhase: "final", actualScore: 3, rank: 3 }),
    ];
    applyDefenseActualRanks(rows);
    expect(rows.map((row) => [row.team, row.rank])).toEqual([
      ["BUF", 2],
      ["MIA", 1],
      ["NYJ", 3],
    ]);
  });

  it("keeps a final defense without an actual on its projection rank", () => {
    const rows = [
      defenseRow({ team: "BUF", pregameProjection: 11, gamePhase: "final", actualScore: null }),
      defenseRow({ team: "MIA", pregameProjection: 9, gamePhase: "pregame" }),
    ];
    applyDefenseActualRanks(rows);
    expect(rows.map((row) => [row.team, row.rank])).toEqual([
      ["BUF", 1],
      ["MIA", 2],
    ]);
  });

  it("isolates ranks per league row set so shared team codes cannot bleed", () => {
    const leagueA = [
      defenseRow({ team: "KC", pregameProjection: 10, gamePhase: "final", actualScore: 4 }),
      defenseRow({ team: "BUF", pregameProjection: 9, gamePhase: "final", actualScore: 15 }),
    ];
    const leagueB = [
      defenseRow({ team: "KC", pregameProjection: 10, gamePhase: "final", actualScore: 22 }),
      defenseRow({ team: "BUF", pregameProjection: 9, gamePhase: "final", actualScore: 2 }),
    ];
    applyDefenseActualRanks(leagueA);
    applyDefenseActualRanks(leagueB);
    expect(leagueA.map((row) => [row.team, row.rank, row.actualScore])).toEqual([
      ["KC", 2, 4],
      ["BUF", 1, 15],
    ]);
    expect(leagueB.map((row) => [row.team, row.rank, row.actualScore])).toEqual([
      ["KC", 1, 22],
      ["BUF", 2, 2],
    ]);
  });
});

describe("finalizeDefenseActualDisplay", () => {
  it("shows actual PTS on final and keeps projection when actual is missing", () => {
    const rows = [
      defenseRow({ team: "BUF", pregameProjection: 11, displayProjection: null, gamePhase: "final", actualScore: 14.5 }),
      defenseRow({ team: "MIA", pregameProjection: 9, displayProjection: null, gamePhase: "final", actualScore: null }),
      defenseRow({ team: "NYJ", pregameProjection: 8, displayProjection: 8, gamePhase: "live", actualScore: 3 }),
    ];
    finalizeDefenseActualDisplay(rows);
    expect(rows.map((row) => [row.team, row.displayProjection])).toEqual([
      ["BUF", 14.5],
      ["MIA", 9],
      ["NYJ", 8],
    ]);
  });
});


describe("bookRangePoints", () => {
  const score = (stats: Record<string, number>) => scoreProjectedPlayerStats("QB", stats, PPR, { recFdProxy: true });
  const consensus = { pass_yd: 250, pass_td: 1.5, pass_int: 0.6, rush_yd: 20 };

  it("scores each end in the league's rules, with interceptions counted the right way", () => {
    const range = bookRangePoints("QB", {
      expected_stats_low: { pass_yards: 230, pass_tds: 1.5, pass_interceptions: 0.5, rush_yards: 15 },
      expected_stats_high: { pass_yards: 270, pass_tds: 1.5, pass_interceptions: 0.8, rush_yards: 25 },
      td_probability: null,
    }, consensus, score);
    // Low: 230 yds, 1.5 TD, the HIGH interception line (0.8), 15 rush yds.
    // High: 270 yds, 1.5 TD, the LOW interception line (0.5), 25 rush yds.
    expect(range).toEqual({
      low: Math.round((230 * 0.04 + 1.5 * 4 - 0.8 * 2 + 15 * 0.1) * 100) / 100,
      high: Math.round((270 * 0.04 + 1.5 * 4 - 0.5 * 2 + 25 * 0.1) * 100) / 100,
    });
    expect(range!.low).toBeLessThan(score(consensus));
    expect(range!.high).toBeGreaterThan(score(consensus));
  });

  it("keeps the consensus projection inside the range under a negative threshold bonus", () => {
    // A league that takes 3 points off at 300 passing yards: the 310-yard line scores below 290, so it becomes the
    // low end, yet it still scores above the 300-yard consensus. The range must still contain the consensus score.
    const bonus = (stats: Record<string, number>) => scoreProjectedPlayerStats("QB", stats, { ...PPR, bonus_pass_yd_300: -3 }, { recFdProxy: true });
    const line = { pass_yd: 300, pass_td: 2, pass_int: 0.6, rush_yd: 20 };
    const range = bookRangePoints("QB", {
      expected_stats_low: { pass_yards: 290, pass_tds: 2, pass_interceptions: 0.6, rush_yards: 20 },
      expected_stats_high: { pass_yards: 310, pass_tds: 2, pass_interceptions: 0.6, rush_yards: 20 },
      td_probability: null,
    }, line, bonus);
    expect(range!.low).toBeLessThanOrEqual(bonus(line));
    expect(range!.high).toBeGreaterThanOrEqual(bonus(line));
  });

  it("is null for snapshots that predate the range fields", () => {
    expect(bookRangePoints("QB", { td_probability: null }, consensus, score)).toBeNull();
  });

  it("collapses to the projection when every book agrees", () => {
    const same = { pass_yards: 250, pass_tds: 1.5, pass_interceptions: 0.6, rush_yards: 20 };
    const range = bookRangePoints("QB", { expected_stats_low: same, expected_stats_high: same, td_probability: null }, consensus, score);
    expect(range!.low).toBe(range!.high);
    expect(range!.low).toBeCloseTo(score(consensus), 2);
  });
});
