import { describe, expect, it } from "vitest";
import {
  draftSurplusByTeam,
  expectedValue,
  GRADE_LETTERS,
  gradeDraft,
  gradeLetter,
  loadDraftGrade,
  pickGrades,
  placeOf,
  schoolGrade,
  shiftDateKey,
  type GradedPick,
  type ValueBoard,
} from "./draft-grade.js";

const board = (entries: Array<[string, number]>): ValueBoard => new Map(entries);
const positionOf: Record<string, string> = { p1: "RB", p2: "WR", p3: "RB", p4: "WR", p5: "QB", p6: "TE", p7: "RB", p8: "WR" };
const pick = (pickNo: number, rosterId: number, playerId: string, position = positionOf[playerId] ?? "RB"): GradedPick => ({ pickNo, rosterId, playerId, position, name: `Name ${playerId}`, team: "TM" });

// Four teams, two rounds, snake order. The market ranks p1..p8 in that order.
const marketBoard = board([["p1", 1000], ["p2", 900], ["p3", 800], ["p4", 700], ["p5", 600], ["p6", 500], ["p7", 400], ["p8", 300]]);
const fair: GradedPick[] = [
  pick(1, 1, "p1"), pick(2, 2, "p2"), pick(3, 3, "p3"), pick(4, 4, "p4"),
  pick(5, 4, "p5"), pick(6, 3, "p6"), pick(7, 2, "p7"), pick(8, 1, "p8"),
];

describe("gradeLetter", () => {
  it("gives a 10-team league one letter per place, A+ through D", () => {
    expect(Array.from({ length: 10 }, (_, i) => gradeLetter(i + 1, 10))).toEqual([...GRADE_LETTERS]);
  });

  it("spreads other league sizes across the same letters", () => {
    expect(gradeLetter(1, 12)).toBe("A+");
    expect(gradeLetter(12, 12)).toBe("D");
    expect(gradeLetter(4, 12)).toBe("A−");
    expect(gradeLetter(3, 8)).toBe("B+");
    expect(gradeLetter(2, 2)).toBe("D");
  });
});

describe("placeOf", () => {
  it("ranks higher totals first and lets ties share the better place", () => {
    const totals = new Map([[1, 50], [2, 80], [3, 50], [4, 10]]);
    expect(placeOf(totals, 2)).toBe(1);
    expect(placeOf(totals, 1)).toBe(2);
    expect(placeOf(totals, 3)).toBe(2);
    expect(placeOf(totals, 4)).toBe(4);
    expect(placeOf(totals, 9)).toBeNull();
  });
});

describe("expectedValue", () => {
  it("reads the value at the pick's rank and holds the last value past the end of the board", () => {
    expect(expectedValue([1000, 900, 800], 1)).toBe(1000);
    expect(expectedValue([1000, 900, 800], 3)).toBe(800);
    expect(expectedValue([1000, 900, 800], 40)).toBe(800);
    expect(expectedValue([], 3)).toBe(0);
  });
});

describe("draftSurplusByTeam", () => {
  it("is zero for every team when each pick is the player the market ranked there", () => {
    const totals = draftSurplusByTeam({ picks: fair, slotBoard: marketBoard, values: marketBoard });
    expect([...totals.values()]).toEqual([0, 0, 0, 0]);
  });

  it("charges a reach and credits the steal on the other side", () => {
    const swapped = [pick(1, 1, "p2"), pick(2, 2, "p1"), ...fair.slice(2)];
    const totals = draftSurplusByTeam({ picks: swapped, slotBoard: marketBoard, values: marketBoard });
    expect(totals.get(1)).toBe(-100);
    expect(totals.get(2)).toBe(100);
  });

  it("scores a pick by today's value against the slot's draft-day expectation", () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p1" ? 200 : value] as [string, number]));
    const totals = draftSurplusByTeam({ picks: fair, slotBoard: marketBoard, values: today });
    expect(totals.get(1)).toBe(-800);
    expect(totals.get(2)).toBe(0);
  });

  it("skips kickers and defenses and values a player missing from the board at the floor", () => {
    const picks = [pick(1, 1, "p1"), pick(2, 1, "k1", "K"), pick(3, 2, "d1", "DEF"), pick(4, 2, "unlisted")];
    const totals = draftSurplusByTeam({ picks, slotBoard: marketBoard, values: marketBoard });
    expect(totals.get(1)).toBe(0);
    // Kickers and defenses use up no slot, so the unlisted player is the draft's second skill pick.
    expect(totals.get(2)).toBe(300 - 900);
  });
});

describe("schoolGrade", () => {
  it("follows the usual school scale, with anything over 100% an A+ and under 65% an F", () => {
    const cases: Array<[number, string]> = [
      [140, "A+"], [100, "A+"], [97, "A+"], [96.9, "A"], [93, "A"], [92.9, "A−"], [90, "A−"],
      [89, "B+"], [87, "B+"], [86, "B"], [83, "B"], [82, "B−"], [80, "B−"],
      [79, "C+"], [77, "C+"], [76, "C"], [73, "C"], [72, "C−"], [70, "C−"],
      [69, "D+"], [67, "D+"], [66, "D"], [65, "D"],
      [64.9, "F"], [60, "F"], [1, "F"],
    ];
    for (const [percent, letter] of cases) expect(schoolGrade(percent), `${percent}%`).toBe(letter);
  });
});

describe("pickGrades", () => {
  it("grades a pick by the share of its slot's value, so taking a player where the market had him is an A+", () => {
    const grades = pickGrades({ picks: fair, rosterId: 1, slotBoard: marketBoard, values: marketBoard });
    expect([...grades.keys()]).toEqual(["p1", "p8"]);
    expect(grades.get("p1")).toEqual({ letter: "A+", percent: 100 });
    expect(grades.get("p8")).toEqual({ letter: "A+", percent: 100 });
  });

  it("drops a pick that has faded since, and rewards one that has risen", () => {
    const today = board([["p1", 520], ["p2", 900], ["p3", 800], ["p4", 700], ["p5", 600], ["p6", 500], ["p7", 400], ["p8", 450]]);
    const grades = pickGrades({ picks: fair, rosterId: 1, slotBoard: marketBoard, values: today });
    expect(grades.get("p1")).toEqual({ letter: "F", percent: 52 });
    expect(grades.get("p8")).toEqual({ letter: "A+", percent: 150 });
  });

  it("has no grade for a kicker or defense", () => {
    const picks = [pick(1, 1, "p1"), pick(2, 1, "k1", "K"), pick(3, 1, "d1", "DEF")];
    const grades = pickGrades({ picks, rosterId: 1, slotBoard: marketBoard, values: marketBoard });
    expect(grades.get("k1")).toBeNull();
    expect(grades.get("d1")).toBeNull();
  });

  it("measures a skill pick against its place among skill picks, not its overall pick number", () => {
    const picks = [pick(1, 1, "k1", "K"), pick(2, 1, "p1")];
    expect(pickGrades({ picks, rosterId: 1, slotBoard: marketBoard, values: marketBoard }).get("p1")).toEqual({ letter: "A+", percent: 100 });
  });
});

describe("gradeDraft", () => {
  const options = { ownRosterId: 2, minBoardPlayers: 1 };

  it("grades a steal first on draft day and last once the player has faded", () => {
    const steal = [pick(1, 1, "p2"), pick(2, 2, "p1"), ...fair.slice(2)];
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p1" ? 200 : value] as [string, number]));
    const grades = gradeDraft({ ...options, picks: steal, draftDayBoard: marketBoard, todayBoard: today });
    expect(grades.draftDay).toEqual({ letter: "A+", rank: 1, of: 4 });
    expect(grades.today?.rank).toBe(4);
    expect(grades.today?.letter).toBe("D");
  });

  it("has no grades without a usable draft-day board, and no Today without today's board", () => {
    const empty = board([]);
    expect(gradeDraft({ ...options, picks: fair, draftDayBoard: empty, todayBoard: marketBoard })).toEqual({ draftDay: null, today: null, picks: [], strategies: null });
    const noToday = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: empty });
    expect(noToday.draftDay).not.toBeNull();
    expect(noToday.today).toBeNull();
  });

  it("lists the user's own picks in draft order with a grade for each day", () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p2" ? 450 : value] as [string, number]));
    const grades = gradeDraft({ ...options, picks: [...fair].reverse(), draftDayBoard: marketBoard, todayBoard: today });
    expect(grades.picks).toEqual([
      { playerId: "p2", pickNo: 2, draftDay: { letter: "A+", percent: 100 }, today: { letter: "F", percent: 50 }, better: { yours: { playerId: "p3", name: "Name p3", position: "RB", team: "TM" }, best: { playerId: "p3", name: "Name p3", position: "RB", team: "TM" } } },
      { playerId: "p7", pickNo: 7, draftDay: { letter: "A+", percent: 100 }, today: { letter: "A+", percent: 100 }, better: { yours: { playerId: "p8", name: "Name p8", position: "WR", team: "TM" }, best: null } },
    ]);
  });

  it("has no Today grades for the picks when today's board is missing", () => {
    const grades = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: board([]) });
    expect(grades.picks.every((entry) => entry.draftDay !== null && entry.today === null)).toBe(true);
  });

  it("has no grade for a team that made no picks", () => {
    expect(gradeDraft({ ...options, ownRosterId: 9, picks: fair, draftDayBoard: marketBoard, todayBoard: marketBoard }).draftDay).toBeNull();
  });
});

describe("gradeDraft slot pool", () => {
  it("measures slots against the players the draft took, so a rookie draft is graded within its rookies", () => {
    // A veteran worth 9000 is on the board but could not be drafted in a rookie draft.
    const rookies = board([["vet", 9000], ["r1", 1000], ["r2", 900], ["r3", 800], ["r4", 700]]);
    const picks = [pick(1, 1, "r1", "RB"), pick(2, 2, "r2", "WR"), pick(3, 2, "r3", "WR"), pick(4, 1, "r4", "RB")];
    const grades = gradeDraft({ picks, ownRosterId: 1, draftDayBoard: rookies, todayBoard: rookies, minBoardPlayers: 1 });
    // Pick 1 took the best rookie where the pool's best rookie belonged: 100%, not 11% of the veteran.
    expect(grades.picks[0]?.draftDay).toEqual({ letter: "A+", percent: 100 });
    expect(grades.picks[1]?.draftDay).toEqual({ letter: "A+", percent: 100 });
  });

  it("counts a drafted player with no stored row at the board's floor in the slots, as he is scored", () => {
    // z is on the board but undrafted and sets the floor; the last pick is a player with no row at all.
    const values = board([["a", 100], ["b", 90], ["c", 80], ["z", 1]]);
    const picks = [pick(1, 1, "a", "RB"), pick(2, 2, "b", "WR"), pick(3, 2, "c", "WR"), pick(4, 1, "missing", "RB")];
    const grades = gradeDraft({ picks, ownRosterId: 1, draftDayBoard: values, todayBoard: values, minBoardPlayers: 1 });
    expect(grades.picks.map((entry) => entry.draftDay)).toEqual([{ letter: "A+", percent: 100 }, { letter: "A+", percent: 100 }]);
    expect(grades.draftDay).toEqual({ letter: "A+", rank: 1, of: 2 });
  });

  it("has no grades when none of the draft's players are on the board", () => {
    const grades = gradeDraft({ picks: [pick(1, 1, "unknown", "RB"), pick(2, 2, "other", "WR")], ownRosterId: 1, draftDayBoard: board([["x", 5]]), todayBoard: board([["x", 5]]), minBoardPlayers: 1 });
    expect(grades).toEqual({ draftDay: null, today: null, picks: [], strategies: null });
  });
});

describe("gradeDraft round length", () => {
  it("uses the draft's team count for the window when given", () => {
    const values = board([["low", 100], ["a", 90], ["star", 5000]]);
    const picks = [pick(1, 1, "low", "WR"), pick(2, 2, "a", "WR"), pick(6, 2, "star", "WR")];
    const run = (teams?: number) => gradeDraft({ picks, ownRosterId: 1, draftDayBoard: values, todayBoard: values, teams, minBoardPlayers: 1 }).picks[0]?.better.yours;
    expect(run(8)?.playerId).toBe("star");
    expect(run()).toBeNull(); // two rosters seen: a two-pick window misses pick 6
  });
});

describe("shiftDateKey", () => {
  it("moves a date across month and year ends", () => {
    expect(shiftDateKey("2026-09-03", -120)).toBe("2026-05-06");
    expect(shiftDateKey("2026-01-02", -5)).toBe("2025-12-28");
  });
});

describe("loadDraftGrade", () => {
  const league = { id: "lg", seasonLongFormat: { key: "redraft-1qb-10t-0.5ppr" } };
  const inSeason = async () => "regular";
  const sleeperPicks = fair.map((p) => ({ pick_no: p.pickNo, roster_id: p.rosterId, player_id: p.playerId, metadata: { position: p.position, first_name: "Name", last_name: p.playerId, team: "TM" } }));
  const draft = (id: string, extra: Record<string, unknown> = {}) => ({ draft_id: id, status: "complete", type: "snake", start_time: Date.UTC(2026, 8, 3, 23, 41), ...extra });
  const fetcher = (drafts: unknown[], picksByDraft: Record<string, unknown[]>) => async <T>(url: string): Promise<T> => {
    const match = url.match(/\/draft\/([^/]+)\/picks$/);
    return (match ? picksByDraft[match[1]!] ?? [] : drafts) as T;
  };

  it("loads the draft-day board for the draft's Pacific date and today's board for today", async () => {
    const calls: Array<[string, string, number]> = [];
    const grade = await loadDraftGrade(league, 1, {
      seasonType: inSeason,
      fetchJson: fetcher([draft("d1")], { d1: sleeperPicks }),
      loadBoard: async (formatKey, date, windowDays) => { calls.push([formatKey, date, windowDays]); return marketBoard; },
      now: () => new Date("2026-10-30T20:00:00Z"),
      minBoardPlayers: 1,
    });
    expect(calls).toEqual([
      ["redraft-1qb-10t-0.5ppr", "2026-09-03", 120],
      ["redraft-1qb-10t-0.5ppr", "2026-10-30", 14],
    ]);
    expect(grade).toMatchObject({ draftId: "d1", draftDay: { of: 4 }, today: { of: 4 } });
  });

  it("names the strategies and the players they would have taken, on today's values", async () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p1" ? 100 : value] as [string, number]));
    const grade = await loadDraftGrade(league, 1, {
      seasonType: inSeason,
      fetchJson: fetcher([draft("d1")], { d1: sleeperPicks }),
      loadBoard: async (_format, _date, windowDays) => (windowDays === 14 ? today : marketBoard),
      minBoardPlayers: 1,
    });
    // Team 1 took p1 (RB, pick 1) and p8 (WR, pick 8). Today p1 has fallen, so taking p2 first is better.
    expect(grade?.strategies).not.toBeNull();
    expect(grade?.picks[0]?.better.yours ?? grade?.picks[0]?.better.best).toMatchObject({ playerId: expect.stringMatching(/^p[2-4]$/) });
  });

  it("returns null when no draft is complete, or the only one is an auction", async () => {
    const loadBoard = async () => marketBoard;
    expect(await loadDraftGrade(league, 1, { seasonType: inSeason, fetchJson: fetcher([draft("d1", { status: "drafting" })], {}), loadBoard })).toBeNull();
    expect(await loadDraftGrade(league, 1, { seasonType: inSeason, fetchJson: fetcher([draft("d1", { type: "auction" })], { d1: sleeperPicks }), loadBoard })).toBeNull();
  });

  it("grades the draft with the most picks when a league has more than one", async () => {
    const grade = await loadDraftGrade(league, 1, {
      seasonType: inSeason,
      fetchJson: fetcher([draft("rookie"), draft("startup")], { rookie: sleeperPicks.slice(0, 2), startup: sleeperPicks }),
      loadBoard: async () => marketBoard,
      minBoardPlayers: 1,
    });
    expect(grade?.draftId).toBe("startup");
  });

  it("returns null without a start time or when the draft-day board is missing", async () => {
    const loadBoard = async () => board([]);
    expect(await loadDraftGrade(league, 1, { seasonType: inSeason, fetchJson: fetcher([draft("d1", { start_time: null })], { d1: sleeperPicks }), loadBoard: async () => marketBoard, minBoardPlayers: 1 })).toBeNull();
    expect(await loadDraftGrade(league, 1, { seasonType: inSeason, fetchJson: fetcher([draft("d1")], { d1: sleeperPicks }), loadBoard })).toBeNull();
  });
  it("looks back as far as draft day for today's board in the offseason, when unchanged redraft values are not stored", async () => {
    const windows = async (seasonType: string, formatKey: string) => {
      const seen: number[] = [];
      await loadDraftGrade({ id: "lg", seasonLongFormat: { key: formatKey } }, 1, {
        seasonType: async () => seasonType,
        fetchJson: fetcher([draft("d1")], { d1: sleeperPicks }),
        loadBoard: async (_format, _date, windowDays) => { seen.push(windowDays); return marketBoard; },
        minBoardPlayers: 1,
      });
      return seen;
    };
    expect(await windows("off", "redraft-1qb-10t-0.5ppr")).toEqual([120, 120]);
    expect(await windows("regular", "redraft-1qb-10t-0.5ppr")).toEqual([120, 14]);
    // Dynasty rows are stored daily all year, so the short look-back is right there.
    expect(await windows("off", "dynasty-1qb-10t-0.5ppr")).toEqual([120, 14]);
  });

  it("measures the window in the draft's configured team count, not the teams still holding picks", async () => {
    // Four rosters made picks but the draft has 8 teams: a better player taken 5 picks later still counts.
    const picks = [
      { pick_no: 1, roster_id: 1, player_id: "low", metadata: { position: "WR", first_name: "Low", last_name: "Guy", team: "TM" } },
      { pick_no: 2, roster_id: 2, player_id: "a", metadata: { position: "WR", first_name: "A", last_name: "Guy", team: "TM" } },
      { pick_no: 3, roster_id: 3, player_id: "b", metadata: { position: "WR", first_name: "B", last_name: "Guy", team: "TM" } },
      { pick_no: 4, roster_id: 4, player_id: "c", metadata: { position: "WR", first_name: "C", last_name: "Guy", team: "TM" } },
      { pick_no: 6, roster_id: 2, player_id: "star", metadata: { position: "WR", first_name: "Star", last_name: "Guy", team: "TM" } },
    ];
    const values = board([["low", 100], ["a", 90], ["b", 80], ["c", 70], ["star", 5000]]);
    const grade = (teams: number) => loadDraftGrade(league, 1, {
      seasonType: inSeason,
      fetchJson: fetcher([draft("d1", { settings: { teams, rounds: 2 } })], { d1: picks }),
      loadBoard: async () => values,
      minBoardPlayers: 1,
    });
    // Without the setting the round would be the 4 rosters seen, which stops at pick 5 and misses the star at 6.
    expect((await grade(8))?.picks[0]?.better.yours?.playerId).toBe("star");
    expect((await grade(4))?.picks[0]?.better.yours).toBeNull();
  });

});
