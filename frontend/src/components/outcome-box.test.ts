import { describe, expect, it } from "vitest";
import { outcomeDomain, outcomeSummary } from "./outcome-box";

describe("outcomeSummary", () => {
  it("returns floor, quartiles, median and ceiling", () => {
    expect(outcomeSummary([12.9, 31.3, 16.7, 32.8, 1.9, 11.5, 21.9])).toEqual({ floor: 1.9, p25: 12.2, median: 16.7, p75: 26.6, ceiling: 32.8 });
  });

  it("needs at least two games", () => {
    expect(outcomeSummary([14])).toBeNull();
    expect(outcomeSummary([])).toBeNull();
  });
});

describe("outcomeDomain", () => {
  it("runs from zero to the highest ceiling, or lower for a negative week", () => {
    const a = { floor: 2, p25: 8, median: 12, p75: 18, ceiling: 30 };
    const b = { floor: -1.5, p25: 4, median: 7, p75: 10, ceiling: 20 };
    expect(outcomeDomain([a, null])).toEqual({ min: 0, max: 30 });
    expect(outcomeDomain([a, b])).toEqual({ min: -1.5, max: 30 });
  });
});
