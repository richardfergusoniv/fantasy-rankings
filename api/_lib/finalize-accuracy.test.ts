import { describe, expect, it } from "vitest";
import { PPFD_ACTUAL_PPR_SCORING, advanceBackfillCursor, scoreWeeklyActual, weeksToBackfill } from "./finalize-accuracy.js";

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

  it("advances through an unbroken run of good weeks and stops at the first error", () => {
    expect(advanceBackfillCursor(0, [{ week: 4, ok: true }, { week: 5, ok: true }, { week: 6, ok: false }, { week: 7, ok: true }])).toBe(5);
    expect(advanceBackfillCursor(3, [])).toBe(3);
    expect(advanceBackfillCursor(3, [{ week: 4, ok: false }])).toBe(3);
  });
});
