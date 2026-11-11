import { describe, expect, it } from "vitest";
import { assignTiers, groupByTier } from "./tiers";

describe("assignTiers", () => {
  it("keeps a smooth list in one tier", () => {
    const smooth = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11];
    expect(new Set(assignTiers(smooth)).size).toBe(1);
  });

  it("starts a new tier at a cliff", () => {
    const withCliff = [20, 19.5, 19, 18.5, 12, 11.5, 11, 10.5];
    expect(assignTiers(withCliff)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it("finds more than one cliff", () => {
    const values = [30, 29, 28, 20, 19, 18, 10, 9, 8];
    expect(assignTiers(values)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it("never leaves a single player alone in a tier", () => {
    const loneLeader = [30, 20, 19.5, 19, 18.5];
    const tiers = assignTiers(loneLeader);
    expect(tiers[0]).toBe(1);
    expect(tiers.filter((tier) => tier === 1).length).toBeGreaterThanOrEqual(2);
    const loneTail = [20, 19.5, 19, 18.5, 10];
    expect(assignTiers(loneTail).filter((tier) => tier === 2).length).not.toBe(1);
  });

  it("ignores tiny drops even when their neighbours are flat", () => {
    expect(new Set(assignTiers([100, 100, 100, 100, 99, 99, 99, 99])).size).toBe(1);
  });

  it("puts players with no value in the tier above them", () => {
    expect(assignTiers([20, 19.5, 19, 12, 11.5, null, 11])).toEqual([1, 1, 1, 2, 2, 2, 2]);
    expect(assignTiers([null, 20, 19.5])).toEqual([1, 1, 1]);
  });

  it("handles empty and tiny lists", () => {
    expect(assignTiers([])).toEqual([]);
    expect(assignTiers([5])).toEqual([1]);
    expect(assignTiers([5, 4])).toEqual([1, 1]);
  });
});

describe("groupByTier", () => {
  it("groups consecutive rows and records where each group starts", () => {
    const groups = groupByTier(["a", "b", "c", "d"], [1, 1, 2, 2]);
    expect(groups).toEqual([
      { tier: 1, start: 0, items: ["a", "b"] },
      { tier: 2, start: 2, items: ["c", "d"] },
    ]);
  });
});

describe("assignTiers size limit", () => {
  it("splits a long run with no cliff so no tier exceeds the maximum", () => {
    const gentle = Array.from({ length: 50 }, (_, i) => 100 * Math.exp(-i / 14));
    const sizes = new Map<number, number>();
    for (const tier of assignTiers(gentle)) sizes.set(tier, (sizes.get(tier) ?? 0) + 1);
    expect(Math.max(...sizes.values())).toBeLessThanOrEqual(12);
    expect(Math.min(...sizes.values())).toBeGreaterThanOrEqual(2);
  });
});
