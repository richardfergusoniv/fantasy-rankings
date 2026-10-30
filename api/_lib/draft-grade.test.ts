import { describe, expect, it } from "vitest";
import {
  draftSurplusByTeam,
  expectedValue,
  GRADE_LETTERS,
  gradeDraft,
  gradeLetter,
  loadDraftGrade,
  placeOf,
  shiftDateKey,
  type GradedPick,
  type ValueBoard,
} from "./draft-grade.js";

const board = (entries: Array<[string, number]>): ValueBoard => new Map(entries);
const pick = (pickNo: number, rosterId: number, playerId: string, position = "RB"): GradedPick => ({ pickNo, rosterId, playerId, position });

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
    expect(totals.get(2)).toBe(300 - 700);
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
    expect(gradeDraft({ ...options, picks: fair, draftDayBoard: empty, todayBoard: marketBoard })).toEqual({ draftDay: null, today: null });
    const noToday = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: empty });
    expect(noToday.draftDay).not.toBeNull();
    expect(noToday.today).toBeNull();
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
  const sleeperPicks = fair.map((p) => ({ pick_no: p.pickNo, roster_id: p.rosterId, player_id: p.playerId, metadata: { position: p.position } }));
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
