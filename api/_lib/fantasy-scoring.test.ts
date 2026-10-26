import { describe, expect, it } from "vitest";
import { scoreActualPlayerStats, scoreProjectedPlayerStats } from "./fantasy-scoring.js";

describe("scoreProjectedPlayerStats position reception bonuses", () => {
  const stats = { rec: 6, rec_yd: 60 };

  it("applies the WR reception bonus in a bonus_rec_wr league", () => {
    const withBonus = scoreProjectedPlayerStats("WR", stats, { rec: 1, rec_yd: 0.1, bonus_rec_wr: 0.5 });
    const without = scoreProjectedPlayerStats("WR", stats, { rec: 1, rec_yd: 0.1 });
    expect(withBonus - without).toBeCloseTo(3, 5);
  });

  it("applies the RB reception bonus in a bonus_rec_rb league", () => {
    const withBonus = scoreProjectedPlayerStats("RB", stats, { rec: 1, rec_yd: 0.1, bonus_rec_rb: 0.25 });
    const without = scoreProjectedPlayerStats("RB", stats, { rec: 1, rec_yd: 0.1 });
    expect(withBonus - without).toBeCloseTo(1.5, 5);
  });

  it("still applies the TE reception bonus", () => {
    const withBonus = scoreProjectedPlayerStats("TE", stats, { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 });
    const without = scoreProjectedPlayerStats("TE", stats, { rec: 1, rec_yd: 0.1 });
    expect(withBonus - without).toBeCloseTo(3, 5);
  });

  it("does not leak one position's bonus into another", () => {
    const wrInRbLeague = scoreProjectedPlayerStats("WR", stats, { rec: 1, rec_yd: 0.1, bonus_rec_rb: 0.5 });
    const plain = scoreProjectedPlayerStats("WR", stats, { rec: 1, rec_yd: 0.1 });
    expect(wrInRbLeague).toBeCloseTo(plain, 5);
  });
});

describe("actual kicker scoring", () => {
  it("uses exact yardage while leaving projection estimates unchanged", () => {
    const stats = { fgm: 1, fgm_50_59: 1, fgm_yds: 51 };
    const settings = { fgm_yds: 0.1 };
    expect(scoreActualPlayerStats("K", stats, settings)).toBe(5.1);
    expect(scoreProjectedPlayerStats("K", stats, settings)).toBe(5.5);
  });

  it("keeps actuals unavailable when yardage scoring lacks exact yards", () => {
    for (const fgm_yds of [undefined, NaN, Infinity]) {
      const stats = { fgm: 1, fgm_50_59: 1, ...(fgm_yds === undefined ? {} : { fgm_yds }) };
      expect(scoreActualPlayerStats("K", stats, { fgm_yds: 0.1 })).toBeNull();
    }
  });

  it("accepts zero yards and scores leagues without yardage scoring", () => {
    expect(scoreActualPlayerStats("K", { fgm_yds: 0, xpm: 2 }, { fgm_yds: 0.1, xpm: 1 })).toBe(2);
    expect(scoreActualPlayerStats("K", { fgm: 1, xpm: 2 }, { fgm: 3, xpm: 1 })).toBe(5);
    expect(scoreActualPlayerStats("WR", { rec: 2 }, { rec: 1, bonus_rec_wr: 0.5 })).toBe(3);
  });
});
