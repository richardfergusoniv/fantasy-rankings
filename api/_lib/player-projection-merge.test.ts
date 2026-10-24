import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { rankingSchema } from "./dashboard-schemas.js";
import {
  mergePlayerProjections,
  nonKickerProjectionCount,
  projectionBoardIsUsable,
  type ProjectionSnapshot,
  type SleeperProjection,
} from "./player-projection-merge.js";

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
