import { describe, expect, it } from "vitest";
import {
  byeWeeksByTeam,
  injuryExposureFacts,
  loadRosContext,
  regularSeasonEndWeek,
  rosLineupDelta,
  type RosContext,
} from "./ros.js";
import type { WeekProjections } from "./sleeper-week-projections.js";

const league = { scoringSettings: undefined, rankingField: "ppr" } as const;

const weekRows = (week: number, rows: Record<string, number>): WeekProjections => ({
  season: 2025,
  week,
  asOf: `2025-11-0${week}T00:00:00Z`,
  players: new Map(
    Object.entries(rows).map(([playerId, pts]) => [playerId, { opponent: null, stats: { pts_ppr: pts } }]),
  ),
});

const ros = (weeks: Record<number, Record<string, number>>): RosContext => ({
  weeks: new Map(Object.entries(weeks).map(([week, rows]) => [Number(week), weekRows(Number(week), rows)])),
  coveredWeeks: Object.keys(weeks).map(Number).sort((a, b) => a - b),
  missingWeeks: [],
  asOf: "2025-11-01T00:00:00Z",
});

describe("byeWeeksByTeam", () => {
  const normalize = (team: string) => team.toUpperCase();

  it.each([
    ["first gap is the bye week", [{ week: 1, home: "KC", away: "BUF" }, { week: 7, home: "KC", away: "BUF" }], "KC", 2],
    ["earliest gap wins", [{ week: 1, home: "KC", away: "BUF" }, { week: 5, home: "KC", away: "BUF" }, { week: 8, home: "KC", away: "BUF" }], "KC", 2],
    ["team playing every week gets no entry", [{ week: 1, home: "KC", away: "BUF" }, { week: 2, home: "KC", away: "BUF" }], "KC", undefined, 2],
    ["normalization applies", [{ week: 1, home: "Jax", away: "BUF" }, { week: 2, home: "BUF", away: "KC" }], "JAX", 2],
    ["games without a week are skipped", [{ home: "KC", away: "BUF" }, { week: 2, home: "KC", away: "BUF" }], "KC", 1],
  ])("%s", (_label, schedule, team, expected, lastWeek = 18) => {
    const map = byeWeeksByTeam(schedule, normalize, lastWeek);
    expect(map.get(team)).toBe(expected);
  });
});

describe("loadRosContext", () => {
  it("marks failed weeks missing and keeps loaded weeks covered", async () => {
    const context = await loadRosContext(2025, 10, 12, async (_season, week) => {
      if (week === 11) throw new Error("boom");
      return weekRows(week, { p1: 10 });
    });
    expect(context.coveredWeeks).toEqual([10, 12]);
    expect(context.missingWeeks).toEqual([11]);
    expect(context.asOf).toBe("2025-11-010T00:00:00Z");
  });

  it("empty span yields no coverage", async () => {
    const context = await loadRosContext(2025, 15, 14);
    expect(context.coveredWeeks).toEqual([]);
    expect(context.missingWeeks).toEqual([]);
    expect(context.asOf).toBeNull();
  });
});

describe("rosLineupDelta", () => {
  const slots = ["RB", "RB"];

  it("sums the lineup delta over covered weeks only", () => {
    const result = rosLineupDelta({
      before: [
        { playerId: "a", position: "RB" },
        { playerId: "b", position: "RB" },
      ],
      after: [
        { playerId: "a", position: "RB" },
        { playerId: "add", position: "RB" },
      ],
      slots,
      league,
      ros: ros({ 10: { a: 10, b: 5, add: 8 }, 11: { a: 10, b: 5, add: 12 } }),
      addId: "add",
    });
    // week10: before a+b=15, after a+add=18 (+3); week11: +7
    expect(result.totalDelta).toBe(10);
    expect(result.weeks.map((row) => row.delta)).toEqual([3, 7]);
    expect(result.startedInWeeks.map((row) => row.week)).toEqual([10, 11]);
    expect(result.startedInWeeks[0]!.note).toContain("out-projects the last starter");
    expect(result.unknownPlayerWeeks).toEqual([]);
  });

  it("names the bye reason from the schedule map", () => {
    const result = rosLineupDelta({
      before: [
        { playerId: "a", position: "RB", team: "KC" },
        { playerId: "b", position: "RB" },
      ],
      after: [
        { playerId: "a", position: "RB", team: "KC" },
        { playerId: "add", position: "RB" },
      ],
      slots,
      league,
      ros: ros({ 10: { a: 0, b: 5, add: 8 } }),
      addId: "add",
      addName: "New Guy",
      byeWeeks: new Map([["KC", 10]]),
      teamById: new Map([["a", "KC"]]),
      nameById: new Map([["a", "Starter A"]]),
    });
    expect(result.startedInWeeks[0]!.note).toBe("Starts for you in week 10 (Starter A's bye).");
  });

  it("a missing projection row for an involved player excludes and discloses the week", () => {
    // Reproduces the reviewed defect: the dropped player has no row, so he used
    // to score 0 on the before side only and the move was credited +4 of points
    // the data does not contain. The week is now excluded from both sides.
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "gone", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, add: 4 } }),
      addId: "add",
      nameById: new Map([["gone", "Dropped Guy"]]),
    });
    expect(result.totalDelta).toBe(0);
    expect(result.weeks).toHaveLength(0);
    expect(result.unknownPlayerWeeks).toEqual([{ week: 10, players: ["Dropped Guy"] }]);
  });

  it("partial player coverage excludes only the affected weeks", () => {
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "gone", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, gone: 5, add: 8 }, 11: { a: 10, add: 12 } }),
      addId: "add",
    });
    // week 10 fully known: before a+gone=15, after a+add=18 (+3); week 11 excluded.
    expect(result.weeks.map((row) => row.delta)).toEqual([3]);
    expect(result.totalDelta).toBe(3);
    expect(result.unknownPlayerWeeks).toEqual([{ week: 11, players: ["gone"] }]);
  });

  it("a shared player with no row can change which moved player starts, so the week is excluded", () => {
    // Regression for the nonlinear-optimizer hole: one RB slot, shared back C
    // has no row. Scoring C as 0 starts the dropped player before (5) and the
    // added player after (3), manufacturing a -2 delta; if C's true projection
    // were 10 he would start on both sides and the delta would be 0. The week
    // must be excluded, not zeroed.
    const oneSlot = ["RB"];
    const result = rosLineupDelta({
      before: [{ playerId: "c", position: "RB", name: "Shared Back" }, { playerId: "drop", position: "RB" }],
      after: [{ playerId: "c", position: "RB", name: "Shared Back" }, { playerId: "add", position: "RB" }],
      slots: oneSlot,
      league,
      ros: ros({ 10: { drop: 5, add: 3 } }),
      addId: "add",
    });
    expect(result.totalDelta).toBe(0);
    expect(result.weeks).toHaveLength(0);
    expect(result.unknownPlayerWeeks).toEqual([{ week: 10, players: ["Shared Back"] }]);
  });

  it("a missing row for an uninvolved bench player also excludes the week", () => {
    const result = rosLineupDelta({
      before: [
        { playerId: "a", position: "RB" },
        { playerId: "b", position: "RB" },
        { playerId: "drop", position: "RB" },
      ],
      after: [
        { playerId: "a", position: "RB" },
        { playerId: "b", position: "RB" },
        { playerId: "add", position: "RB" },
      ],
      slots,
      league,
      // b (uninvolved) has no row: the week no longer counts.
      ros: ros({ 10: { a: 10, drop: 5, add: 8 } }),
      addId: "add",
    });
    expect(result.weeks).toHaveLength(0);
    expect(result.totalDelta).toBe(0);
    expect(result.unknownPlayerWeeks).toEqual([{ week: 10, players: ["b"] }]);
  });

  it("a schedule bye makes the involved player's missing row a real 0", () => {
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "gone", position: "RB", team: "KC" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, add: 4 } }),
      addId: "add",
      byeWeeks: new Map([["KC", 10]]),
    });
    // gone is on a schedule bye: before a+0=10, after a+add=14.
    expect(result.totalDelta).toBe(4);
    expect(result.unknownPlayerWeeks).toEqual([]);
  });

  it("an unknown team cannot confirm a bye, so the week is excluded", () => {
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "gone", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, add: 4 } }),
      addId: "add",
      byeWeeks: new Map([["KC", 10]]),
    });
    expect(result.weeks).toHaveLength(0);
    expect(result.unknownPlayerWeeks).toEqual([{ week: 10, players: ["gone"] }]);
  });

  it("an add with no projection rows anywhere cannot manufacture a loss", () => {
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "b", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "mystery", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, b: 5 }, 11: { a: 10, b: 5 } }),
      addId: "mystery",
    });
    // mystery scores 0 on the after side only in every covered week: with no
    // coverage for him at all, the move reports no delta, not a manufactured -5.
    expect(result.totalDelta).toBe(0);
    expect(result.weeks).toHaveLength(0);
    expect(result.unknownPlayerWeeks).toEqual([
      { week: 10, players: ["mystery"] },
      { week: 11, players: ["mystery"] },
    ]);
  });

  it("uncovered weeks contribute nothing", () => {
    const context = ros({ 10: { a: 10, b: 5, add: 8 } });
    context.missingWeeks = [11];
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "b", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: context,
      addId: "add",
    });
    expect(result.weeks).toHaveLength(1);
  });
});

describe("injuryExposureFacts", () => {
  const isDesignated = (status: string | null | undefined) => status != null && status !== "";

  it("lists designations, share, and absent players", () => {
    const facts = injuryExposureFacts({
      roster: [
        { playerId: "a", name: "A", position: "RB", injuryStatus: "Questionable" },
        { playerId: "b", name: "B", position: "RB", injuryStatus: null },
      ],
      involved: [
        { playerId: "a", name: "A", injuryStatus: "Questionable" },
        { playerId: "c", name: "C", injuryStatus: null },
      ],
      ros: ros({ 10: { a: 10, b: 10 } }),
      league,
      isDesignated,
    });
    expect(facts.designatedPlayers).toEqual(["A (Questionable)"]);
    expect(facts.designatedProjectedShare).toBe(0.5);
    expect(facts.absentPlayers).toEqual(["C"]);
  });

  it("share is null when the roster has no projected points", () => {
    const facts = injuryExposureFacts({
      roster: [{ playerId: "a", name: "A", position: "RB", injuryStatus: "Out" }],
      involved: [{ playerId: "a", name: "A", injuryStatus: "Out" }],
      ros: ros({ 10: {} }),
      league,
      isDesignated,
    });
    expect(facts.designatedProjectedShare).toBeNull();
  });
});

describe("regularSeasonEndWeek", () => {
  it.each([
    ["playoff start minus one", { playoffs: { weekStart: 15 } }, 14],
    ["fallback 14", { playoffs: { weekStart: null } }, 14],
  ])("%s", (_label, leagueLike, expected) => {
    expect(regularSeasonEndWeek(leagueLike as never)).toBe(expected);
  });
});
