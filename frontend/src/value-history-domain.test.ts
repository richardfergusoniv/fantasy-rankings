import { describe, expect, it } from "vitest";
import {
  continuousStartAmongValueSeries,
  continuousValueHistoryStartDate,
  isRealValueHistoryValue,
  sliceValueHistoryFromDate,
  trimValueHistoryToContinuousStart,
  utcDateKeyDiffDays,
  VALUE_HISTORY_OUTLIER_GAP_DAYS,
} from "./value-history-domain";

describe("isRealValueHistoryValue", () => {
  it("accepts finite values above zero only", () => {
    expect(isRealValueHistoryValue(1)).toBe(true);
    expect(isRealValueHistoryValue(0)).toBe(false);
    expect(isRealValueHistoryValue(-3)).toBe(false);
    expect(isRealValueHistoryValue(null)).toBe(false);
    expect(isRealValueHistoryValue(undefined)).toBe(false);
    expect(isRealValueHistoryValue(Number.NaN)).toBe(false);
  });
});

describe("utcDateKeyDiffDays", () => {
  it("counts whole UTC calendar days", () => {
    expect(utcDateKeyDiffDays("2026-01-03", "2026-05-01")).toBe(118);
    expect(utcDateKeyDiffDays("2026-05-01", "2026-05-02")).toBe(1);
  });
});

describe("continuousValueHistoryStartDate", () => {
  it("starts at the first real date when the series is continuous", () => {
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-15"];
    expect(continuousValueHistoryStartDate(dates)).toBe("2026-01-01");
  });

  it("ignores isolated early outliers separated by a large gap", () => {
    const dates = ["2026-01-03", "2026-05-01", "2026-05-02", "2026-05-03"];
    expect(continuousValueHistoryStartDate(dates)).toBe("2026-05-01");
    expect(VALUE_HISTORY_OUTLIER_GAP_DAYS).toBe(30);
  });

  it("drops a sparse early cluster before the continuous redraft window", () => {
    const dates = [
      "2026-01-03",
      "2026-01-10",
      "2026-02-01",
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ];
    expect(continuousValueHistoryStartDate(dates)).toBe("2026-05-01");
  });

  it("returns null for an empty list", () => {
    expect(continuousValueHistoryStartDate([])).toBeNull();
  });
});

describe("continuousStartAmongValueSeries", () => {
  it("uses the earliest continuous start among primary and compare", () => {
    const primary = [
      { date: "2026-05-01", value: 100 },
      { date: "2026-05-02", value: 110 },
    ];
    const compare = [
      { date: "2026-01-03", value: 90 },
      { date: "2026-04-20", value: 95 },
      { date: "2026-04-21", value: 96 },
      { date: "2026-05-01", value: 97 },
    ];
    // Compare's April cluster continues into May; Jan outlier is dropped.
    expect(continuousStartAmongValueSeries([primary, compare])).toBe("2026-04-20");
  });

  it("ignores null and non-positive values when choosing the start", () => {
    const primary = [
      { date: "2026-01-03", value: 0 },
      { date: "2026-01-04", value: null },
      { date: "2026-05-01", value: 200 },
      { date: "2026-05-02", value: 210 },
    ];
    expect(continuousStartAmongValueSeries([primary])).toBe("2026-05-01");
  });
});

describe("trimValueHistoryToContinuousStart", () => {
  it("trims leading non-positive points and early gap outliers", () => {
    const points = [
      { date: "2026-01-01", value: 0 },
      { date: "2026-01-03", value: 50 },
      { date: "2026-05-01", value: 100 },
      { date: "2026-05-02", value: 110 },
    ];
    expect(trimValueHistoryToContinuousStart(points)).toEqual([
      { date: "2026-05-01", value: 100 },
      { date: "2026-05-02", value: 110 },
    ]);
  });

  it("keeps a continuous dynasty-style series from the first real value", () => {
    const points = [
      { date: "2026-01-01", value: 0 },
      { date: "2026-01-02", value: 500 },
      { date: "2026-01-03", value: 510 },
      { date: "2026-02-01", value: 520 },
      { date: "2026-03-01", value: 530 },
    ];
    expect(trimValueHistoryToContinuousStart(points).map((point) => point.date)).toEqual([
      "2026-01-02",
      "2026-01-03",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("returns empty when every value is non-positive", () => {
    expect(trimValueHistoryToContinuousStart([
      { date: "2026-01-01", value: 0 },
      { date: "2026-01-02", value: -1 },
    ])).toEqual([]);
  });
});

describe("sliceValueHistoryFromDate", () => {
  it("keeps points on or after the start date", () => {
    const rows = [
      { date: "2026-01-03", value: 1 },
      { date: "2026-05-01", value: 2 },
      { date: "2026-05-02", value: 3 },
    ];
    expect(sliceValueHistoryFromDate(rows, "2026-05-01")).toEqual([
      { date: "2026-05-01", value: 2 },
      { date: "2026-05-02", value: 3 },
    ]);
  });
});
