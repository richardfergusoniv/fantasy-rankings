import { describe, expect, it } from "vitest";
import { valueChartRangeStartIndex, valueChartYDomain, valueChartZoomStartIndex } from "./value-chart-zoom";

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

describe("valueChartRangeStartIndex", () => {
  const dates = ["2025-10-01", "2026-01-01", "2026-05-01", "2026-08-01", "2026-09-15", "2026-10-15"];

  it("keeps everything for All", () => {
    expect(valueChartRangeStartIndex(dates, "all")).toBe(0);
  });

  it("starts at the first date inside the window", () => {
    expect(valueChartRangeStartIndex(dates, "3m")).toBe(3);
    expect(valueChartRangeStartIndex(dates, "6m")).toBe(2);
    expect(valueChartRangeStartIndex(dates, "1y")).toBe(1);
  });

  it("keeps everything when the window would leave fewer than two points", () => {
    expect(valueChartRangeStartIndex(["2026-01-01", "2026-10-15"], "3m")).toBe(0);
    expect(valueChartRangeStartIndex([], "3m")).toBe(0);
  });
});
