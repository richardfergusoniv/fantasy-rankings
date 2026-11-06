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
  // A complete 4-team schedule: every team plays every week 1-18. Removing a
  // game's week models a bye (one missing week) or an omitted game (data gap).
  const fullSchedule = (omit: { home: string; away: string; weeks: number[] }[] = []) => {
    const games: { week?: number; home?: string; away?: string }[] = [];
    for (let week = 1; week <= 18; week += 1) {
      games.push({ week, home: "KC", away: "BUF" }, { week, home: "JAX", away: "DEN" });
    }
    return games.filter(
      (game) => !omit.some((o) => o.weeks.includes(game.week!) && [o.home, o.away].includes(game.home!) && [o.home, o.away].includes(game.away!)),
    );
  };

  it("the single missing window week is the bye", () => {
    const map = byeWeeksByTeam(fullSchedule([{ home: "KC", away: "BUF", weeks: [10] }]), normalize);
    expect(map.get("KC")).toBe(10);
    expect(map.get("BUF")).toBe(10);
    expect(map.get("JAX")).toBeUndefined();
  });

  it("normalization applies to schedule teams", () => {
    const schedule = fullSchedule([{ home: "JAX", away: "DEN", weeks: [12] }])
      .map((game) => ({ ...game, home: game.home === "JAX" ? "Jac" : game.home }));
    expect(byeWeeksByTeam(schedule, normalize).get("JAC")).toBe(12);
  });

  it("games without a week are skipped", () => {
    const schedule = [...fullSchedule([{ home: "KC", away: "BUF", weeks: [10] }]), { home: "KC", away: "BUF" }];
    expect(byeWeeksByTeam(schedule, normalize).get("KC")).toBe(10);
  });

  it("an omitted game inside the bye window means no bye is inferred", () => {
    // Regression: the schedule is missing KC's week-9 game and KC's real bye is
    // week 12. Two window gaps cannot be told apart, so the week must stay
    // disclosed-unknown rather than misread as a real bye 0.
    const map = byeWeeksByTeam(fullSchedule([{ home: "KC", away: "BUF", weeks: [9, 12] }]), normalize);
    expect(map.get("KC")).toBeUndefined();
  });

  it("a gap outside the bye window is a data gap, not a bye", () => {
    const map = byeWeeksByTeam(fullSchedule([{ home: "KC", away: "BUF", weeks: [2] }]), normalize);
    expect(map.get("KC")).toBeUndefined();
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
    expect(result.startedInWeeks.map((row) => row.note)).toEqual([
      "Starts for you in week 10.",
      "Starts for you in week 11.",
    ]);
    expect(result.unknownPlayerWeeks).toEqual([]);
  });

  it("keeps the start note neutral even when a before-starter is on bye", () => {
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
    // Regression: the lineup shows the add starts, not why - the bye is a
    // fact about the week but cannot be proven to be the cause, so the note
    // must not name it (or any out-projection claim) as the reason.
    expect(result.startedInWeeks[0]!.note).toBe("Starts for you in week 10.");
    expect(result.startedInWeeks[0]!.note).not.toContain("bye");
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

  it.each(["K", "DEF"])("counts %s starters in lineup totals", (position) => {
    const result = rosLineupDelta({
      before: [{ playerId: "drop", position }],
      after: [{ playerId: "add", position }],
      slots: [position],
      league,
      ros: ros({ 10: { drop: 5, add: 9 } }),
      addId: "add",
    });
    expect(result.weeks).toEqual([
      { week: 10, before: 5, after: 9, delta: 4, addSlot: position },
    ]);
    expect(result.totalDelta).toBe(4);
  });

  it("a draft pick asset never blocks coverage", () => {
    // Regression: a traded pick has no projection row and no team — treating it
    // as a rostered player used to exclude every covered week and report a
    // misleading zero delta.
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "b", position: "RB" }],
      after: [
        { playerId: "a", position: "RB" },
        { playerId: "add", position: "RB" },
        { playerId: "pick-2027-1", position: "PICK", name: "2027 1st" },
      ],
      slots,
      league,
      ros: ros({ 10: { a: 10, b: 5, add: 8 }, 11: { a: 10, b: 5, add: 12 } }),
      addId: "add",
    });
    expect(result.weeks.map((row) => row.delta)).toEqual([3, 7]);
    expect(result.totalDelta).toBe(10);
    expect(result.unknownPlayerWeeks).toEqual([]);
  });

  it("roster team aliases resolve to schedule bye teams", () => {
    // Regression: Sleeper roster rows keep the source alias (LA) while the
    // schedule/bye map is keyed canonically (LAR); the alias used to defeat
    // the bye lookup and exclude the whole week as unknown.
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "gone", position: "RB", team: "LA" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, add: 4 } }),
      addId: "add",
      byeWeeks: new Map([["LAR", 10]]),
    });
    expect(result.totalDelta).toBe(4);
    expect(result.unknownPlayerWeeks).toEqual([]);
  });

  it("a stale projection row on the player's bye week scores a real 0", () => {
    // Regression: a cached row from before a move to a team with a different
    // bye used to count its points on the new team's bye.
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "b", position: "RB", team: "KC" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "b", position: "RB", team: "KC" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, b: 9 } }),
      byeWeeks: new Map([["KC", 10]]),
    });
    expect(result.weeks).toEqual([{ week: 10, before: 10, after: 10, delta: 0, addSlot: null }]);
  });

  it("a row without a usable score excludes and discloses the week", () => {
    // Regression: in a half-PPR league a row carrying only pts_ppr used to be
    // counted as covered but scored a silent 0, manufacturing a delta.
    const halfPpr = { scoringSettings: undefined, rankingField: "halfPpr" } as const;
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "gone", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league: halfPpr,
      ros: ros({ 10: { a: 10, gone: 5, add: 8 } }),
      addId: "add",
    });
    expect(result.weeks).toHaveLength(0);
    expect(result.totalDelta).toBe(0);
    expect(result.unknownPlayerWeeks).toEqual([{ week: 10, players: ["a", "gone", "add"] }]);
  });

  it("an explicit zero fallback is a real score, not unknown", () => {
    const result = rosLineupDelta({
      before: [{ playerId: "a", position: "RB" }, { playerId: "b", position: "RB" }],
      after: [{ playerId: "a", position: "RB" }, { playerId: "add", position: "RB" }],
      slots,
      league,
      ros: ros({ 10: { a: 10, b: 0, add: 8 } }),
      addId: "add",
    });
    // b's explicit 0 counts: before a+b=10, after a+add=18.
    expect(result.weeks).toEqual([{ week: 10, before: 10, after: 18, delta: 8, addSlot: "RB" }]);
    expect(result.unknownPlayerWeeks).toEqual([]);
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

  it("names players missing a covered non-bye week as partial", () => {
    const facts = injuryExposureFacts({
      roster: [
        { playerId: "a", name: "A", position: "RB", injuryStatus: null },
        { playerId: "b", name: "B", position: "RB", injuryStatus: "Out" },
      ],
      involved: [{ playerId: "b", name: "B", position: "RB", injuryStatus: "Out" }],
      ros: ros({ 10: { a: 10, b: 10 }, 11: { a: 10 } }),
      league,
      isDesignated,
    });
    // b is covered in week 10 but missing in week 11: disclosed as partial,
    // not silently dropped from that week's total.
    expect(facts.partialPlayers).toEqual(["B"]);
    expect(facts.absentPlayers).toEqual([]);
    expect(facts.designatedProjectedShare).toBe(0.333);
  });

  it("a schedule bye is a real 0, never a coverage gap", () => {
    const facts = injuryExposureFacts({
      roster: [{ playerId: "a", name: "A", position: "RB", team: "KC", injuryStatus: null }],
      involved: [],
      ros: ros({ 10: { a: 10 }, 11: {} }),
      league,
      isDesignated,
      byeWeeks: new Map([["KC", 11]]),
    });
    expect(facts.partialPlayers).toEqual([]);
    expect(facts.absentPlayers).toEqual([]);
    expect(facts.designatedProjectedShare).toBe(0);
  });

  it("a stale bye-week row counts 0 in the exposure share", () => {
    const facts = injuryExposureFacts({
      roster: [
        { playerId: "a", name: "A", position: "RB", team: "KC", injuryStatus: "Out" },
        { playerId: "b", name: "B", position: "RB", injuryStatus: null },
      ],
      involved: [{ playerId: "a", name: "A", position: "RB", team: "KC", injuryStatus: "Out" }],
      // Week 10 is KC's bye but a stale cached row still holds points for a.
      ros: ros({ 10: { a: 10, b: 10 }, 11: { a: 10, b: 10 } }),
      league,
      isDesignated,
      byeWeeks: new Map([["KC", 10]]),
    });
    // a's stale week-10 points are ignored: designated 10 / total 30.
    expect(facts.designatedProjectedShare).toBe(0.333);
    expect(facts.partialPlayers).toEqual([]);
    expect(facts.absentPlayers).toEqual([]);
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
