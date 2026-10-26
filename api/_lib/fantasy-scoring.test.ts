import { describe, expect, it } from "vitest";
import { scoreProjectedPlayerStats } from "./fantasy-scoring.js";

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
