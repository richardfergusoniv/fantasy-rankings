import { describe, expect, it } from "vitest";
import { PPFD_ACTUAL_PPR_SCORING, scoreWeeklyActual } from "./finalize-accuracy.js";

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

  it("returns null for empty stats", () => {
    expect(scoreWeeklyActual("RB", {}, "ppr")).toBeNull();
  });
});
