import { describe, expect, it } from "vitest";
import type { TeamWeekStatRow } from "./nflverse-team-week-stats.js";
import {
  buildPropHistory,
  compareHitRateDesc,
  currentWeekPropLines,
  impliedProbability,
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

  it("reports overs / unders / cells against the line", () => {
    const history = buildPropHistory("pass_yards", 270.5, [
      weekRow({ week: 1, name: "Patrick Mahomes", passingYards: 220 }),
      weekRow({ week: 2, name: "Patrick Mahomes", passingYards: 260 }),
      weekRow({ week: 3, name: "Patrick Mahomes", passingYards: 310 }),
    ]);
    expect(history.games).toBe(3);
    expect(history.overs).toBe(1);
    expect(history.unders).toBe(2);
    expect(history.hitRate).toBeCloseTo(1 / 3);
    expect(history.underRate).toBeCloseTo(2 / 3);
    expect(history.cells.map((cell) => cell.result)).toEqual(["under", "under", "over"]);
    expect(history.cells.map((cell) => cell.actual)).toEqual([220, 260, 310]);
  });

  it("counts anytime_td from combined touchdowns and marks pushes", () => {
    const history = buildPropHistory("anytime_td", 0.5, [
      weekRow({ week: 1, name: "Isiah Pacheco", position: "RB", rushingTds: 1, receivingTds: 0 }),
      weekRow({ week: 2, name: "Isiah Pacheco", position: "RB", rushingTds: 0, receivingTds: 0 }),
      weekRow({ week: 3, name: "Isiah Pacheco", position: "RB", rushingTds: 0, receivingTds: 1 }),
    ]);
    expect(history.overs).toBe(2);
    expect(history.cells.map((cell) => cell.actual)).toEqual([1, 0, 1]);

    const pushHistory = buildPropHistory("receptions", 5, [
      weekRow({ week: 1, name: "Travis Kelce", position: "TE", receptions: 5 }),
      weekRow({ week: 2, name: "Travis Kelce", position: "TE", receptions: 7 }),
    ]);
    expect(pushHistory.pushes).toBe(1);
    expect(pushHistory.cells[0]?.result).toBe("push");
    expect(pushHistory.hitRate).toBe(1);
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
    rows.sort(compareHitRateDesc);
    expect(rows.map((row) => row.name)).toEqual([
      "Always Over",
      "Aaron First",
      "Zed Last",
      "Never Over",
      "No History",
    ]);
  });
});

