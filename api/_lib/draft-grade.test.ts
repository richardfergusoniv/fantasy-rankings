import { describe, expect, it } from "vitest";
import {
  betterPicks,
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

describe("betterPicks", () => {
  const idOf = (result: Map<string, GradedPick | null>, playerId: string) => result.get(playerId)?.playerId ?? null;

  it("is null at every pick of a draft that followed the market", () => {
    for (const rosterId of [1, 2, 3, 4]) {
      expect([...betterPicks({ picks: fair, rosterId, values: marketBoard, window: 4 }).values()]).toEqual([null, null]);
    }
  });

  it("names a more valuable player another team took in the next round", () => {
    // Team 1 takes the second-best player first; team 2 then takes the best.
    const swapped = [pick(1, 1, "p2"), pick(2, 2, "p1"), ...fair.slice(2)];
    const result = betterPicks({ picks: swapped, rosterId: 1, values: marketBoard, window: 4 });
    expect(result.get("p2")).toMatchObject({ playerId: "p1", name: "Name p1", position: "RB", team: "TM" });
    expect(idOf(betterPicks({ picks: swapped, rosterId: 2, values: marketBoard, window: 4 }), "p1")).toBeNull();
  });

  describe("using the league's own draft order", () => {
    const values = board([["low", 100], ["star", 5000], ["mid", 900], ["own", 8000]]);
    const picks = [
      pick(1, 1, "low", "RB"),
      pick(2, 2, "mid", "WR"),
      pick(3, 1, "own", "RB"), // the team's own later pick is never a suggestion
      pick(4, 3, "star", "WR"),
      pick(9, 4, "late", "QB"),
    ];

    it("only suggests a player who went within the window, never one the league let fall further", () => {
      expect(idOf(betterPicks({ picks, rosterId: 1, values, window: 3 }), "low")).toBe("star");
      // With a window of 2 the star (pick 4) went too late to be a realistic pick at slot 1.
      expect(idOf(betterPicks({ picks, rosterId: 1, values, window: 2 }), "low")).toBe("mid");
    });

    it("skips the team's own later picks, even if more valuable", () => {
      expect(idOf(betterPicks({ picks, rosterId: 1, values, window: 3 }), "low")).not.toBe("own");
    });

    it("ignores players off the board, kickers and defenses, and players with no name", () => {
      const noisy = [pick(1, 1, "low", "RB"), pick(2, 2, "k1", "K"), pick(3, 2, "ghost", "WR"), { ...pick(4, 2, "mid", "WR"), name: undefined }];
      expect(idOf(betterPicks({ picks: noisy, rosterId: 1, values, window: 4 }), "low")).toBeNull();
    });
  });

  it("has nothing better for a kicker or defense pick", () => {
    const picks = [pick(1, 1, "k1", "K"), pick(2, 2, "p1")];
    expect(betterPicks({ picks, rosterId: 1, values: marketBoard, window: 4 }).get("k1")).toBeNull();
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
    expect(gradeDraft({ ...options, picks: fair, draftDayBoard: empty, todayBoard: marketBoard })).toEqual({ draftDay: null, today: null, picks: [] });
    const noToday = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: empty });
    expect(noToday.draftDay).not.toBeNull();
    expect(noToday.today).toBeNull();
  });

  it("lists the user's own picks in draft order with a grade for each day", () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p2" ? 450 : value] as [string, number]));
    const grades = gradeDraft({ ...options, picks: [...fair].reverse(), draftDayBoard: marketBoard, todayBoard: today });
    expect(grades.picks).toEqual([
      { playerId: "p2", pickNo: 2, draftDay: { letter: "A+", percent: 100 }, today: { letter: "F", percent: 50 }, better: { draftDay: null, today: { playerId: "p3", name: "Name p3", position: "RB", team: "TM" } } },
      { playerId: "p7", pickNo: 7, draftDay: { letter: "A+", percent: 100 }, today: { letter: "A+", percent: 100 }, better: { draftDay: null, today: null } },
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

describe("shiftDateKey", () => {
  it("moves a date across month and year ends", () => {
    expect(shiftDateKey("2026-09-03", -120)).toBe("2026-05-06");
    expect(shiftDateKey("2026-01-02", -5)).toBe("2025-12-28");
  });
});

describe("loadDraftGrade", () => {
  const league = { id: "lg", seasonLongFormat: { key: "redraft-1qb-10t-0.5ppr" } };
  const sleeperPicks = fair.map((p) => ({ pick_no: p.pickNo, roster_id: p.rosterId, player_id: p.playerId, metadata: { position: p.position, first_name: "Name", last_name: p.playerId, team: "TM" } }));
  const draft = (id: string, extra: Record<string, unknown> = {}) => ({ draft_id: id, status: "complete", type: "snake", start_time: Date.UTC(2026, 8, 3, 23, 41), ...extra });
  const fetcher = (drafts: unknown[], picksByDraft: Record<string, unknown[]>) => async <T>(url: string): Promise<T> => {
    const match = url.match(/\/draft\/([^/]+)\/picks$/);
    return (match ? picksByDraft[match[1]!] ?? [] : drafts) as T;
  };

  it("loads the draft-day board for the draft's Pacific date and today's board for today", async () => {
    const calls: Array<[string, string, number]> = [];
    const grade = await loadDraftGrade(league, 1, {
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

  it("names the better players on draft day and today for the user's own picks", async () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p1" ? 100 : value] as [string, number]));
    const grade = await loadDraftGrade(league, 1, {
      fetchJson: fetcher([draft("d1")], { d1: sleeperPicks }),
      loadBoard: async (_format, _date, windowDays) => (windowDays === 14 ? today : marketBoard),
      minBoardPlayers: 1,
    });
    // Team 1 took p1 (pick 1) and p8 (pick 8). Today p1 has fallen, so p2 was the better first pick.
    expect(grade?.picks.map((entry) => [entry.playerId, entry.pickNo, entry.better])).toEqual([
      ["p1", 1, { draftDay: null, today: { playerId: "p2", name: "Name p2", position: "WR", team: "TM" } }],
      ["p8", 8, { draftDay: null, today: null }],
    ]);
  });

  it("returns null when no draft is complete, or the only one is an auction", async () => {
    const loadBoard = async () => marketBoard;
    expect(await loadDraftGrade(league, 1, { fetchJson: fetcher([draft("d1", { status: "drafting" })], {}), loadBoard })).toBeNull();
    expect(await loadDraftGrade(league, 1, { fetchJson: fetcher([draft("d1", { type: "auction" })], { d1: sleeperPicks }), loadBoard })).toBeNull();
  });

  it("grades the draft with the most picks when a league has more than one", async () => {
    const grade = await loadDraftGrade(league, 1, {
      fetchJson: fetcher([draft("rookie"), draft("startup")], { rookie: sleeperPicks.slice(0, 2), startup: sleeperPicks }),
      loadBoard: async () => marketBoard,
      minBoardPlayers: 1,
    });
    expect(grade?.draftId).toBe("startup");
  });

  it("returns null without a start time or when the draft-day board is missing", async () => {
    const loadBoard = async () => board([]);
    expect(await loadDraftGrade(league, 1, { fetchJson: fetcher([draft("d1", { start_time: null })], { d1: sleeperPicks }), loadBoard: async () => marketBoard, minBoardPlayers: 1 })).toBeNull();
    expect(await loadDraftGrade(league, 1, { fetchJson: fetcher([draft("d1")], { d1: sleeperPicks }), loadBoard })).toBeNull();
  });
});
