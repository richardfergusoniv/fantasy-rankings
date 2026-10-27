import { describe, expect, it } from "vitest";
import type { TeamWeekStatRow } from "./nflverse-team-week-stats.js";
import {
  buildPropHistory,
  compareHitsDesc,
  currentWeekPropLines,
  impliedProbability,
  indexPlayedWeeks,
  isHiddenHalfPointPropStat,
  propPlayerMatchKey,
  propStatActual,
  summarizePropLineMovement,
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
    passingFirstDowns: 0,
    rushingFirstDowns: 0,
    receivingFirstDowns: 0,
    sacksTaken: 0,
    fumblesLost: 0,
    passing2pt: 0,
    rushing2pt: 0,
    receiving2pt: 0,
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

describe("propStatActual / history", () => {
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

  it("grades every played week against this week's line", () => {
    const history = buildPropHistory(
      "pass_yards",
      270.5,
      [
        weekRow({ week: 1, name: "Patrick Mahomes", passingYards: 220 }),
        weekRow({ week: 2, name: "Patrick Mahomes", passingYards: 260 }),
        weekRow({ week: 3, name: "Patrick Mahomes", passingYards: 310 }),
        weekRow({ week: 4, name: "Patrick Mahomes", passingYards: 400 }),
      ],
      new Set([1, 2, 3, 4]),
      new Set([1, 2, 3, 4]),
    );
    expect(history.games).toBe(4);
    expect(history.overs).toBe(2);
    expect(history.unders).toBe(2);
    expect(history.hitRate).toBeCloseTo(0.5);
    expect(history.underRate).toBeCloseTo(0.5);
    expect(history.cells.map((cell) => cell.result)).toEqual(["under", "under", "over", "over"]);
    expect(history.cells.map((cell) => cell.actual)).toEqual([220, 260, 310, 400]);
    expect(history.cells.map((cell) => cell.line)).toEqual([270.5, 270.5, 270.5, 270.5]);

    // No usable line, no history.
    const noLine = buildPropHistory(
      "pass_yards",
      Number.NaN,
      [weekRow({ week: 1, name: "Patrick Mahomes", passingYards: 400 })],
      new Set([1]),
      new Set([1]),
    );
    expect(noLine.games).toBe(0);
    expect(noLine.hitRate).toBeNull();
  });

  it("counts anytime_td from combined touchdowns and marks pushes", () => {
    const history = buildPropHistory(
      "anytime_td",
      0.5,
      [
        weekRow({ week: 1, name: "Isiah Pacheco", position: "RB", rushingTds: 1, receivingTds: 0 }),
        weekRow({ week: 2, name: "Isiah Pacheco", position: "RB", rushingTds: 0, receivingTds: 0 }),
        weekRow({ week: 3, name: "Isiah Pacheco", position: "RB", rushingTds: 0, receivingTds: 1 }),
      ],
      new Set([1, 2, 3]),
      new Set([1, 2, 3]),
    );
    expect(history.overs).toBe(2);
    expect(history.cells.map((cell) => cell.actual)).toEqual([1, 0, 1]);

    const pushHistory = buildPropHistory(
      "receptions",
      5,
      [
        weekRow({ week: 1, name: "Travis Kelce", position: "TE", receptions: 5 }),
        weekRow({ week: 2, name: "Travis Kelce", position: "TE", receptions: 7 }),
      ],
      new Set([1, 2]),
      new Set([1, 2]),
    );
    expect(pushHistory.pushes).toBe(1);
    expect(pushHistory.cells[0]?.result).toBe("push");
    expect(pushHistory.hitRate).toBe(1);
  });

  it("counts a played week with no stat row as a zero, and skips weeks not played", () => {
    // Jonnu Smith, Week 6 2026: on the field for 9 snaps, never targeted,
    // so nflverse carries no stat row for him. Against a 0.5 receptions
    // line that week is an under, not a missing game.
    const history = buildPropHistory(
      "receptions",
      0.5,
      [weekRow({ week: 5, name: "Jonnu Smith", position: "TE", receptions: 2 })],
      new Set([5, 6]),
      new Set([4, 5, 6]),
    );
    expect(history.games).toBe(2);
    expect(history.overs).toBe(1);
    expect(history.unders).toBe(1);
    expect(history.cells.map((cell) => cell.week)).toEqual([5, 6]);
    expect(history.cells[1]).toMatchObject({ week: 6, line: 0.5, actual: 0, result: "under" });

    // A market with no nflverse actual never grades, even for a zero week.
    const ungradeable = buildPropHistory(
      "longest_reception",
      12.5,
      [],
      new Set([6]),
      new Set([6]),
    );
    expect(ungradeable.games).toBe(0);
    expect(ungradeable.hitRate).toBeNull();
  });

  it("does not zero-fill a week the stats dataset has not published yet", () => {
    // Snap counts for the newest week can land before the stats file does;
    // a played week with no stats coverage is missing data, not a zero.
    const history = buildPropHistory(
      "receptions",
      0.5,
      [],
      new Set([6]),
      new Set([1, 2, 3, 4, 5]),
    );
    expect(history.games).toBe(0);
    expect(history.cells).toEqual([]);
    expect(history.hitRate).toBeNull();
  });

  it("converts American odds to implied probability", () => {
    expect(impliedProbability(-150)).toBeCloseTo(0.6);
    expect(impliedProbability(150)).toBeCloseTo(0.4);
    expect(impliedProbability(-110)).toBeCloseTo(110 / 210);
    expect(impliedProbability(null)).toBeNull();
    expect(impliedProbability(0)).toBeNull();
  });

  it("orders props by hit rate, unrated rows last", () => {
    const rows = [
      { hitRate: null, name: "No History", stat: "targets" },
      { hitRate: 0, name: "Never Over", stat: "targets" },
      { hitRate: 0.5, name: "Zed Last", stat: "targets" },
      { hitRate: 1, name: "Always Over", stat: "targets" },
      { hitRate: 0.5, name: "Aaron First", stat: "targets" },
    ];
    rows.sort(compareHitsDesc);
    expect(rows.map((row) => row.name)).toEqual([
      "Always Over",
      "Aaron First",
      "Zed Last",
      "Never Over",
      "No History",
    ]);
  });

  it("orders by quantity of hits before percentage", () => {
    const rows = [
      { hitRate: 1, hits: 1, name: "One Timer", stat: "targets" },
      { hitRate: 0, hits: 0, name: "Never Hit", stat: "targets" },
      { hitRate: null, hits: 0, name: "No History", stat: "targets" },
      { hitRate: 0.5, hits: 5, name: "Five Hits", stat: "targets" },
      { hitRate: 1, hits: 2, name: "Perfect Two", stat: "targets" },
    ];
    rows.sort(compareHitsDesc);
    expect(rows.map((row) => row.name)).toEqual([
      "Five Hits",
      "Perfect Two",
      "One Timer",
      "Never Hit",
      "No History",
    ]);
  });

  it("breaks a hit-count tie by rate", () => {
    const rows = [
      { hitRate: 0.5, hits: 3, name: "Low Rate", stat: "targets" },
      { hitRate: 0.75, hits: 3, name: "High Rate", stat: "targets" },
    ];
    rows.sort(compareHitsDesc);
    expect(rows.map((row) => row.name)).toEqual(["High Rate", "Low Rate"]);
  });

  it("stays transitive when only some rows carry a hit count", () => {
    const oneTimer = { hitRate: 1, hits: 1, name: "One Timer", stat: "targets" };
    const noCount = { hitRate: 0.9, name: "No Count", stat: "targets" };
    const proven = { hitRate: 0.8, hits: 5, name: "Proven", stat: "targets" };
    // A count-less row sorts below every counted row, so the counted rows
    // order purely by hits — no comparison cycle.
    expect(compareHitsDesc(proven, oneTimer)).toBeLessThan(0);
    expect(compareHitsDesc(oneTimer, noCount)).toBeLessThan(0);
    expect(compareHitsDesc(proven, noCount)).toBeLessThan(0);
    const rows = [oneTimer, proven, noCount];
    rows.sort(compareHitsDesc);
    expect(rows.map((row) => row.name)).toEqual(["Proven", "One Timer", "No Count"]);
  });
});

describe("history indexes", () => {
  it("indexes played weeks from snap rows with at least one offensive snap", () => {
    const index = indexPlayedWeeks([
      { name: "Jonnu Smith", team: "GB", position: "TE", week: 6, offenseSnaps: 9, offensePct: 12 },
      { name: "Jonnu Smith", team: "GB", position: "TE", week: 5, offenseSnaps: 0, offensePct: 0 },
    ]);
    const key = propPlayerMatchKey("Jonnu Smith", "GB", "TE");
    expect([...(index.get(key) ?? [])]).toEqual([6]);
  });
});

describe("isHiddenHalfPointPropStat", () => {
  it("hides the three always-0.5 markets from UI", () => {
    expect(isHiddenHalfPointPropStat("anytime_td")).toBe(true);
    expect(isHiddenHalfPointPropStat("first_td")).toBe(true);
    expect(isHiddenHalfPointPropStat("pass_interceptions")).toBe(true);
    expect(isHiddenHalfPointPropStat("pass_yards")).toBe(false);
    expect(isHiddenHalfPointPropStat("receptions")).toBe(false);
  });
});

