import { describe, expect, it } from "vitest";
import { valueChartYDomain, valueChartZoomStartIndex } from "./value-chart-zoom";

describe("valueChartZoomStartIndex", () => {
  it("starts at zero when not zoomed", () => {
    expect(valueChartZoomStartIndex(20, false)).toBe(0);
  });

  it("keeps short series fully visible", () => {
    expect(valueChartZoomStartIndex(3, true)).toBe(0);
  });

  it("zooms into the recent window", () => {
    expect(valueChartZoomStartIndex(20, true)).toBe(7);
  });
});

describe("valueChartYDomain", () => {
  it("stays auto when not zoomed", () => {
    expect(valueChartYDomain([10, 20], false)).toEqual([0, "auto"]);
  });

  it("pads the visible range when zoomed", () => {
    const [lo, hi] = valueChartYDomain([100, 200, 300], true);
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(300);
  });
});
