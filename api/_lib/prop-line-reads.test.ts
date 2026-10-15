import { describe, expect, it } from "vitest";
import type { TeamWeekStatRow } from "./nflverse-team-week-stats.js";
import {
  blendedPropEdge,
  buildOpponentGroupAllowances,
  buildPlayerStatShares,
  buildPropEdgeHistory,
  currentWeekPropLines,
  medianOf,
  opponentAllowanceKey,
  propPlayerMatchKey,
  propStatActual,
  summarizePropLineMovement,
  weightedRecentProjection,
} from "./prop-line-reads.js";

function weekRow(partial: Partial<TeamWeekStatRow> & Pick<TeamWeekStatRow, "week" | "name">): TeamWeekStatRow {
  return {
    playerId: "00-001",
    team: "KC",
    opponent: "BUF",
    position: "QB",
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    carries: 0,
    rushingYards: 0,
    receivingTds: 0,
    rushingTds: 0,
    passingTds: 0,
    fantasyPpr: 0,
    targetShare: null,
    completions: 0,
    passAttempts: 0,
    passingYards: 0,
    interceptions: 0,
    ...partial,
  };
}

describe("summarizePropLineMovement", () => {
  it("returns null for an empty pull list", () => {
    expect(summarizePropLineMovement([])).toBeNull();
  });

  it("keeps move null when there is only one pull", () => {
    const summary = summarizePropLineMovement([
      { pulledAt: new Date("2026-10-12T10:00:00.000Z"), line: 275.5 },
    ]);
    expect(summary).toMatchObject({
      openingLine: 275.5,
      latestLine: 275.5,
      move: null,
    });
    expect(summary?.history).toHaveLength(1);
  });

  it("computes opening, latest, move, and chronological history", () => {
    const summary = summarizePropLineMovement([
      { pulledAt: new Date("2026-10-13T12:00:00.000Z"), line: 272.5 },
      { pulledAt: new Date("2026-10-12T10:00:00.000Z"), line: 275.5 },
      { pulledAt: new Date("2026-10-14T08:00:00.000Z"), line: 270.5 },
    ]);
    expect(summary).toEqual({
      history: [
        { pulledAt: new Date("2026-10-12T10:00:00.000Z"), line: 275.5 },
        { pulledAt: new Date("2026-10-13T12:00:00.000Z"), line: 272.5 },
        { pulledAt: new Date("2026-10-14T08:00:00.000Z"), line: 270.5 },
      ],
      openingLine: 275.5,
      latestLine: 270.5,
      move: -5,
      latestPulledAt: new Date("2026-10-14T08:00:00.000Z"),
      openingPulledAt: new Date("2026-10-12T10:00:00.000Z"),
    });
  });
});

describe("currentWeekPropLines", () => {
  it("collapses pulls to latest per player/stat and exposes move when 2+ pulls", () => {
    const lines = currentWeekPropLines([
      {
        playerId: "4046",
        stat: "pass_yards",
        line: 275.5,
        medianOverOdds: -110,
        medianUnderOdds: -108,
        bookCount: 8,
        pulledAt: new Date("2026-10-12T10:00:00.000Z"),
      },
      {
        playerId: "4046",
        stat: "pass_yards",
        line: 270.5,
        medianOverOdds: -112,
        medianUnderOdds: -105,
        bookCount: 9,
        pulledAt: new Date("2026-10-14T08:00:00.000Z"),
      },
      {
        playerId: "4606",
        stat: "receptions",
        line: 5.5,
        medianOverOdds: -115,
        medianUnderOdds: -105,
        bookCount: 6,
        pulledAt: new Date("2026-10-12T10:00:00.000Z"),
      },
    ]);

    expect(lines).toEqual([
      {
        playerId: "4046",
        stat: "pass_yards",
        line: 270.5,
        medianOverOdds: -112,
        medianUnderOdds: -105,
        bookCount: 9,
        pulledAt: new Date("2026-10-14T08:00:00.000Z"),
        openLine: 275.5,
        move: -5,
      },
      {
        playerId: "4606",
        stat: "receptions",
        line: 5.5,
        medianOverOdds: -115,
        medianUnderOdds: -105,
        bookCount: 6,
        pulledAt: new Date("2026-10-12T10:00:00.000Z"),
        openLine: null,
        move: null,
      },
    ]);
  });
});

describe("propStatActual / edge history", () => {
  it("maps canonical prop stats onto week-row fields", () => {
    const row = weekRow({
      week: 1,
      name: "Patrick Mahomes",
      passingYards: 280,
      passingTds: 2,
      completions: 22,
      passAttempts: 34,
      interceptions: 1,
      rushingYards: 18,
      carries: 4,
      receivingYards: 0,
      receptions: 0,
    });
    expect(propStatActual("pass_yards", row)).toBe(280);
    expect(propStatActual("pass_tds", row)).toBe(2);
    expect(propStatActual("pass_completions", row)).toBe(22);
    expect(propStatActual("pass_attempts", row)).toBe(34);
    expect(propStatActual("pass_interceptions", row)).toBe(1);
    expect(propStatActual("rush_yards", row)).toBe(18);
    expect(propStatActual("rush_attempts", row)).toBe(4);
    expect(propStatActual("longest_reception", row)).toBeNull();
  });

  it("weights recent games more and reports overs / cells / edge", () => {
    const history = buildPropEdgeHistory("pass_yards", 270.5, [
      weekRow({ week: 1, name: "Patrick Mahomes", passingYards: 220 }),
      weekRow({ week: 2, name: "Patrick Mahomes", passingYards: 260 }),
      weekRow({ week: 3, name: "Patrick Mahomes", passingYards: 310 }),
    ]);
    // weights 1,2,3 → (220 + 520 + 930) / 6 = 278.333…
    expect(history.games).toBe(3);
    expect(history.average).toBe(263.333);
    expect(history.median).toBe(260);
    expect(history.overs).toBe(1);
    expect(history.unders).toBe(2);
    expect(history.hitRate).toBeCloseTo(1 / 3);
    expect(history.cells.map((cell) => cell.result)).toEqual(["under", "under", "over"]);
    expect(history.last3).toEqual([220, 260, 310]);
    expect(history.projection).toBe(278.333);
    expect(history.edge).toBe(7.833);
  });

  it("counts anytime_td from combined touchdowns and marks pushes", () => {
    const history = buildPropEdgeHistory("anytime_td", 0.5, [
      weekRow({ week: 1, name: "Isiah Pacheco", position: "RB", rushingTds: 1, receivingTds: 0 }),
      weekRow({ week: 2, name: "Isiah Pacheco", position: "RB", rushingTds: 0, receivingTds: 0 }),
      weekRow({ week: 3, name: "Isiah Pacheco", position: "RB", rushingTds: 0, receivingTds: 1 }),
    ]);
    expect(history.overs).toBe(2);
    expect(history.last3).toEqual([1, 0, 1]);

    const pushHistory = buildPropEdgeHistory("receptions", 5, [
      weekRow({ week: 1, name: "Travis Kelce", position: "TE", receptions: 5 }),
      weekRow({ week: 2, name: "Travis Kelce", position: "TE", receptions: 7 }),
    ]);
    expect(pushHistory.pushes).toBe(1);
    expect(pushHistory.cells[0]?.result).toBe("push");
    expect(pushHistory.hitRate).toBe(1);
  });
});

describe("weightedRecentProjection / medianOf", () => {
  it("returns null for empty samples", () => {
    expect(weightedRecentProjection([])).toBeNull();
    expect(medianOf([])).toBeNull();
  });

  it("medians even-length samples", () => {
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("buildOpponentGroupAllowances", () => {
  it("averages the whole position group's stat per game for a defense", () => {
    const allowances = buildOpponentGroupAllowances([
      // Week 1 vs KC: both BUF receivers count toward the group total (150).
      weekRow({ week: 1, name: "WR One", team: "BUF", opponent: "KC", position: "WR", receivingYards: 110 }),
      weekRow({ week: 1, name: "WR Two", team: "BUF", opponent: "KC", position: "WR", receivingYards: 40 }),
      // Week 2 vs KC: the WR group totals 70. Mean of group totals = 110.
      weekRow({ week: 2, name: "WR Three", team: "DEN", opponent: "KC", position: "WR", receivingYards: 70 }),
      // A running back's receiving yards never enter the WR allowance.
      weekRow({ week: 1, name: "RB One", team: "BUF", opponent: "KC", position: "RB", receivingYards: 55 }),
      // Rows without an opponent are skipped.
      weekRow({ week: 1, name: "No Opp", team: "BUF", opponent: "", position: "WR", receivingYards: 200 }),
    ]);
    expect(allowances.get(opponentAllowanceKey("KC", "WR", "rec_yards"))).toEqual({ allowed: 110, games: 2 });
    // KC played 2 games; no RB recorded receiving yards against them in
    // week 2, so that game counts as 0 in the average.
    expect(allowances.get(opponentAllowanceKey("KC", "RB", "rec_yards"))).toEqual({ allowed: 27.5, games: 2 });
    expect(allowances.get(opponentAllowanceKey("BUF", "WR", "rec_yards"))).toBeUndefined();
  });

  it("counts games where the defense faced no recorded player at the position as allowing 0", () => {
    const allowances = buildOpponentGroupAllowances([
      weekRow({ week: 1, name: "WR One", team: "BUF", opponent: "KC", position: "WR", receivingYards: 110 }),
      // Week 2 vs KC: only a QB row — KC played, but no WR recorded anything.
      weekRow({ week: 2, name: "QB Two", team: "DEN", opponent: "KC", position: "QB", passingYards: 200 }),
    ]);
    expect(allowances.get(opponentAllowanceKey("KC", "WR", "rec_yards"))).toEqual({ allowed: 55, games: 2 });
  });
});

describe("buildPlayerStatShares", () => {
  it("splits a group's production across its players", () => {
    const shares = buildPlayerStatShares([
      weekRow({ week: 1, name: "Alpha", team: "CIN", position: "WR", receivingYards: 60 }),
      weekRow({ week: 2, name: "Alpha", team: "CIN", position: "WR", receivingYards: 30 }),
      weekRow({ week: 1, name: "Beta", team: "CIN", position: "WR", receivingYards: 60 }),
    ]);
    expect(shares.get(`${propPlayerMatchKey("Alpha", "CIN", "WR")}|rec_yards`)).toBe(0.6);
    expect(shares.get(`${propPlayerMatchKey("Beta", "CIN", "WR")}|rec_yards`)).toBe(0.4);
    // A different team/position group is independent.
    expect(shares.get(`${propPlayerMatchKey("Alpha", "CIN", "WR")}|pass_yards`)).toBeUndefined();
  });

  it("canonicalizes variant team codes so both share keys agree", () => {
    // nflverse calls the Rams "LA"; the canonical code is LAR.
    const shares = buildPlayerStatShares([
      weekRow({ week: 1, name: "Ram One", team: "LA", position: "WR", receivingYards: 75 }),
      weekRow({ week: 1, name: "Ram Two", team: "LA", position: "WR", receivingYards: 25 }),
    ]);
    expect(shares.get(`${propPlayerMatchKey("Ram One", "LAR", "WR")}|rec_yards`)).toBe(0.75);
    expect(shares.get(`${propPlayerMatchKey("Ram Two", "LAR", "WR")}|rec_yards`)).toBe(0.25);
  });

  it("clamps negative player totals to a zero share", () => {
    const shares = buildPlayerStatShares([
      weekRow({ week: 1, name: "Neg", team: "CIN", position: "RB", rushingYards: -5 }),
      weekRow({ week: 1, name: "Pos", team: "CIN", position: "RB", rushingYards: 105 }),
    ]);
    expect(shares.get(`${propPlayerMatchKey("Neg", "CIN", "RB")}|rush_yards`)).toBe(0);
    expect(shares.get(`${propPlayerMatchKey("Pos", "CIN", "RB")}|rush_yards`)).toBe(1);
  });
});

describe("blendedPropEdge", () => {
  it("averages projection and opponent allowance against the line", () => {
    // (63.3 + 104.4) / 2 - 82.5 = 1.35
    expect(blendedPropEdge(63.3, 104.4, 82.5)).toBeCloseTo(1.35);
    // A stingy opponent drags the blend below the raw projection edge.
    expect(blendedPropEdge(258.6, 166.8, 271.5)).toBeCloseTo(-58.8);
  });

  it("falls back to projection minus line without an allowance", () => {
    expect(blendedPropEdge(258.6, null, 271.5)).toBeCloseTo(-12.9);
  });

  it("is null without a projection", () => {
    expect(blendedPropEdge(null, 100, 82.5)).toBeNull();
    expect(blendedPropEdge(null, null, 82.5)).toBeNull();
  });
});
