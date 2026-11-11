import { describe, expect, it } from "vitest";
import { PPFD_ACTUAL_PPR_SCORING, backfillWeekCompleted, firstDownBoardPrecedesCapture, scoreWeeklyActual, weeksToBackfill } from "./finalize-accuracy.js";

describe("scoreWeeklyActual", () => {
  it("scores PPFD league actuals in canonical PPR", () => {
    const points = scoreWeeklyActual(
      "WR",
      { rec: 5, rec_yd: 60, rec_td: 1 },
      "ppfd",
    );
    // 5*1 + 60*0.1 + 1*6 = 17
    expect(points).toBe(17);
    expect(PPFD_ACTUAL_PPR_SCORING.rec).toBe(1);
  });

  it("uses half-PPR when scoring is halfPpr", () => {
    const points = scoreWeeklyActual(
      "WR",
      { rec: 5, rec_yd: 60, rec_td: 1 },
      "halfPpr",
    );
    // 5*0.5 + 60*0.1 + 1*6 = 14.5
    expect(points).toBe(14.5);
  });

  it("accepts full league scoring_settings records", () => {
    const points = scoreWeeklyActual(
      "TE",
      { rec: 4, rec_yd: 40, rec_td: 1 },
      { ...PPFD_ACTUAL_PPR_SCORING, rec: 1, bonus_rec_te: 0.5 },
    );
    // 4*1 + 4*0.5 + 40*0.1 + 1*6 = 16
    expect(points).toBe(16);
  });

  it("scores two-point conversions in canonical PPR", () => {
    const points = scoreWeeklyActual(
      "RB",
      { rush_yd: 10, rush_2pt: 1 },
      "ppr",
    );
    // 10*0.1 + 1*2 = 3
    expect(points).toBe(3);
    expect(PPFD_ACTUAL_PPR_SCORING.pass_2pt).toBe(2);
    expect(PPFD_ACTUAL_PPR_SCORING.rec_2pt).toBe(2);
  });

  it("returns null for empty stats", () => {
    expect(scoreWeeklyActual("RB", {}, "ppr")).toBeNull();
  });
});

describe("backfill cursor", () => {
  it("lists only the finished weeks after the cursor, in order, without repeats", () => {
    expect(weeksToBackfill([6, 4, 5, 5, 9, 7], 0)).toEqual([4, 5, 6, 7, 9]);
    expect(weeksToBackfill([4, 5, 6, 7, 9], 6)).toEqual([7, 9]);
    expect(weeksToBackfill([4, 5], 9)).toEqual([]);
  });
});

describe("backfillWeekCompleted", () => {
  it("is complete only with no errors and every row read", () => {
    expect(backfillWeekCompleted({ errors: 0, truncated: false })).toBe(true);
    expect(backfillWeekCompleted({ errors: 2, truncated: false })).toBe(false);
    expect(backfillWeekCompleted({ errors: 0, truncated: true })).toBe(false);
  });

  it("is not complete when copying finals onto scoring snapshots failed", () => {
    expect(backfillWeekCompleted({ errors: 0, truncated: false, snapshotsOk: false })).toBe(false);
    expect(backfillWeekCompleted({ errors: 0, truncated: false, snapshotsOk: true })).toBe(true);
    expect(backfillWeekCompleted({ errors: 0, truncated: false })).toBe(true);
  });
});

describe("firstDownBoardPrecedesCapture", () => {
  const captured = new Date("2026-10-18T16:00:00Z");
  it("uses a board built before the projection was captured", () => {
    expect(firstDownBoardPrecedesCapture("2026-10-17T20:00:00Z", captured)).toBe(true);
    expect(firstDownBoardPrecedesCapture("2026-10-18T16:00:00Z", captured)).toBe(true);
  });
  it("leaves the row empty for a board built after the capture, or an unreadable date", () => {
    expect(firstDownBoardPrecedesCapture("2026-10-18T16:00:01Z", captured)).toBe(false);
    expect(firstDownBoardPrecedesCapture("not a date", captured)).toBe(false);
  });
});
