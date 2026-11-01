import { describe, expect, it } from "vitest";
import { rangeDomain } from "./range-bar";

describe("rangeDomain", () => {
  it("spans the lowest low to the highest high, padded so ends don't touch the edge", () => {
    const domain = rangeDomain([{ low: 14, high: 18 }, null, { low: 20, high: 26 }]);
    expect(domain.min).toBeLessThan(14);
    expect(domain.max).toBeGreaterThan(26);
    expect(domain.min).toBeGreaterThanOrEqual(0);
  });

  it("falls back to a unit scale when no player has a range", () => {
    expect(rangeDomain([null, undefined])).toEqual({ min: 0, max: 1 });
  });

  it("never goes below zero", () => {
    expect(rangeDomain([{ low: 0.2, high: 1 }]).min).toBe(0);
  });

  it("reaches below zero when a book's low is negative", () => {
    expect(rangeDomain([{ low: -1.5, high: 6 }]).min).toBeLessThan(-1.5);
  });
});
