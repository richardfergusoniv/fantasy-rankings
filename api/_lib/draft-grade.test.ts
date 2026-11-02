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
    expect(gradeDraft({ ...options, picks: fair, draftDayBoard: empty, todayBoard: marketBoard })).toEqual({ draftDay: null, today: null, picks: [], strategies: null, hindsight: null, rookieHindsight: null });
    const noToday = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: empty });
    expect(noToday.draftDay).not.toBeNull();
    expect(noToday.today).toBeNull();
  });

  it("lists the user's own picks in draft order with a grade for each day", () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p2" ? 450 : value] as [string, number]));
    const grades = gradeDraft({ ...options, picks: [...fair].reverse(), draftDayBoard: marketBoard, todayBoard: today });
    expect(grades.picks).toEqual([
      { playerId: "p2", pickNo: 2, draftDay: { letter: "A+", percent: 100 }, today: { letter: "F", percent: 50 }, better: { yours: { playerId: "p4", name: "Name p4", position: "WR", team: "TM" }, best: { playerId: "p3", name: "Name p3", position: "RB", team: "TM" } } },
      { playerId: "p7", pickNo: 7, draftDay: { letter: "A+", percent: 100 }, today: { letter: "A+", percent: 100 }, better: { yours: null, best: null } },
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

describe("gradeDraft hindsight", () => {
  const options = { ownRosterId: 2, teams: 4, minBoardPlayers: 1 };

  it("sums the replay up in lineup-value percentages, pick counts and the biggest swap", () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p2" ? 450 : value] as [string, number]));
    const hindsight = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: today }).hindsight;
    expect(hindsight).not.toBeNull();
    expect(hindsight!.gapToBest).toBeGreaterThan(0);
    expect(hindsight!.gapYours).toBeLessThanOrEqual(hindsight!.gapToBest);
    expect(hindsight!.of).toBe(2);
    expect(hindsight!.changes).toBeGreaterThan(0);
    expect(hindsight!.biggestSwap).toMatchObject({ from: "Name p2", to: { playerId: "p3" } });
    expect(hindsight!.biggestSwap!.gain).toBeGreaterThan(0);
  });

  it("lists every strategy with the best first, marks the user's own, and names where each differs", () => {
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p2" ? 450 : value] as [string, number]));
    const plans = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: today }).hindsight!.plans;
    expect(plans.length).toBeGreaterThanOrEqual(12);
    expect(plans[0]!.best).toBe(true);
    expect(plans.filter((plan) => plan.yours)).toHaveLength(1);
    const possible = plans.filter((plan) => plan.gap !== null);
    expect(possible.every((plan) => typeof plan.gap === "number")).toBe(true);
    expect(plans.filter((plan) => plan.gap === null).every((plan) => Object.keys(plan.swaps).length === 0)).toBe(true);
    expect(plans[0]!.swaps["p2"]).toMatchObject({ playerId: "p3" });
  });

  it("has no hindsight without today's board", () => {
    expect(gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: board([]) }).hindsight).toBeNull();
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
    expect(grades).toEqual({ draftDay: null, today: null, picks: [], strategies: null, hindsight: null, rookieHindsight: null });
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

describe("gradeDraft rookie hindsight", () => {
  const options = { ownRosterId: 2, teams: 4, minBoardPlayers: 1 };

  it("replaces the strategy replay with the best dynasty value still on the board at each pick", () => {
    // Roster 2 took p2 (pick 2) and p7 (pick 7). Today p2 has faded to 450; the best value
    // taken after pick 2 is p3 at 800, and nothing taken after pick 7 beats p7's 400.
    const today = board([...marketBoard].map(([id, value]) => [id, id === "p2" ? 450 : value] as [string, number]));
    const grades = gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: today, rookieDraft: true });
    expect(grades.strategies).toBeNull();
    expect(grades.hindsight).toBeNull();
    const rookie = grades.rookieHindsight;
    expect(rookie).not.toBeNull();
    expect(rookie!.of).toBe(2);
    expect(rookie!.changes).toBe(1);
    // Taken 450 + 400 = 850; the redo takes 800 + 400 = 1200, a 41.2% gain.
    expect(rookie!.valueGainPct).toBe(41.2);
    expect(rookie!.biggestMiss).toMatchObject({ from: "Name p2", to: { playerId: "p3" }, gain: 350 });
    expect(rookie!.picks[0]).toMatchObject({ playerId: "p2", value: 450, best: { playerId: "p3", value: 800 } });
    expect(rookie!.picks[1]).toMatchObject({ playerId: "p7", value: 400, best: null });
    // The per-pick better names the same alternative the replay found.
    expect(grades.picks[0]?.better).toEqual({ yours: null, best: { playerId: "p3", name: "Name p3", position: "RB", team: "TM" } });
    expect(grades.picks[1]?.better).toEqual({ yours: null, best: null });
    // The grades themselves are unchanged by the mode.
    expect(grades.draftDay).not.toBeNull();
    expect(grades.today).not.toBeNull();
  });

  it("never spends the same player twice and never names a player taken earlier", () => {
    const values = board([["a", 100], ["b", 200], ["star", 5000], ["c", 300]]);
    const picks = [pick(1, 1, "a", "WR"), pick(2, 1, "b", "WR"), pick(3, 2, "star", "WR"), pick(4, 2, "c", "WR")];
    const rookie = gradeDraft({ picks, ownRosterId: 1, draftDayBoard: values, todayBoard: values, minBoardPlayers: 1, rookieDraft: true }).rookieHindsight;
    // Pick 1's redo is the star; at pick 2 the star is spent, so the redo is c (300 over b's 200).
    expect(rookie!.picks.map((row) => row.best?.playerId ?? null)).toEqual(["star", "c"]);
    expect(rookie!.changes).toBe(2);
  });

  it("leaves kickers and defenses out, and has no replay without today's board", () => {
    const picks = [pick(1, 1, "p1"), pick(2, 1, "k1", "K"), pick(3, 2, "p2")];
    const rookie = gradeDraft({ picks, ownRosterId: 1, draftDayBoard: marketBoard, todayBoard: marketBoard, minBoardPlayers: 1, rookieDraft: true }).rookieHindsight;
    expect(rookie!.of).toBe(1);
    expect(gradeDraft({ ...options, picks: fair, draftDayBoard: marketBoard, todayBoard: board([]), rookieDraft: true }).rookieHindsight).toBeNull();
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

  it("gives an established dynasty league the rookie value replay, and a first-year dynasty the strategies", async () => {
    const routing = (previousLeagueId: string | null) => async <T>(url: string): Promise<T> => {
      if (url.endsWith("/league/lg/drafts")) return [draft("d1")] as T;
      if (/\/draft\/[^/]+\/picks$/.test(url)) return sleeperPicks as T;
      if (url.endsWith("/league/lg")) return { roster_positions: ["QB", "RB", "WR", "TE"], previous_league_id: previousLeagueId } as T;
      throw new Error(`unexpected url ${url}`);
    };
    const dynasty = { id: "lg", seasonLongFormat: { key: "dynasty-1qb-12t-1ppr", isDynasty: true } };
    const deps = { seasonType: inSeason, loadBoard: async () => marketBoard, minBoardPlayers: 1 };
    const established = await loadDraftGrade(dynasty, 1, { ...deps, fetchJson: routing("prev-league") });
    expect(established?.rookieHindsight).not.toBeNull();
    expect(established?.strategies).toBeNull();
    const firstYear = await loadDraftGrade(dynasty, 1, { ...deps, fetchJson: routing("0") });
    expect(firstYear?.rookieHindsight).toBeNull();
    expect(firstYear?.strategies).not.toBeNull();
    // A redraft league keeps the strategies even though its Sleeper league has a previous one.
    const redraft = await loadDraftGrade(league, 1, { ...deps, fetchJson: routing("prev-league") });
    expect(redraft?.rookieHindsight).toBeNull();
    expect(redraft?.strategies).not.toBeNull();
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
