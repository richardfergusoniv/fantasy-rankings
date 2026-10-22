import { describe, expect, it } from "vitest";
import {
  assetContributionOnDate,
  buildAggregateTradeHistoryData,
  nearestHistoryValue,
  tradeBarTotals,
} from "./aggregate-trade-history";

function asset(playerId: string, value: number) {
  return { playerId, value };
}

describe("nearestHistoryValue", () => {
  const points = [
    { date: "2026-09-01", value: 100 },
    { date: "2026-09-03", value: 120 },
    { date: "2026-09-10", value: 140 },
  ];

  it("returns the exact date when present", () => {
    expect(nearestHistoryValue(points, "2026-09-03")).toBe(120);
  });

  it("carries the prior value across a gap", () => {
    expect(nearestHistoryValue(points, "2026-09-05")).toBe(120);
  });

  it("uses the next value when asked before the first point", () => {
    expect(nearestHistoryValue(points, "2026-08-20")).toBe(100);
  });

  it("returns null for an empty series", () => {
    expect(nearestHistoryValue([], "2026-09-03")).toBeNull();
  });
});

describe("assetContributionOnDate", () => {
  it("stays flat at the bar value when history is missing", () => {
    expect(assetContributionOnDate(asset("a", 2148), [], "2026-09-05", "2026-09-05")).toBe(2148);
  });

  it("pins the anchor date to the bar value and scales other dates", () => {
    const history = [
      { date: "2026-09-01", value: 1000 },
      { date: "2026-09-05", value: 2000 },
      { date: "2026-09-10", value: 2500 },
    ];
    expect(assetContributionOnDate(asset("a", 4000), history, "2026-09-05", "2026-09-05")).toBe(4000);
    expect(assetContributionOnDate(asset("a", 4000), history, "2026-09-01", "2026-09-05")).toBe(2000);
    expect(assetContributionOnDate(asset("a", 4000), history, "2026-09-10", "2026-09-05")).toBe(5000);
  });

  it("carries the nearest history value across a gap before scaling", () => {
    const history = [
      { date: "2026-09-01", value: 1000 },
      { date: "2026-09-10", value: 2000 },
    ];
    // Gap day 09-05 → nearest prior 1000; scale 4000/2000 at anchor 09-10 → 2000.
    expect(assetContributionOnDate(asset("a", 4000), history, "2026-09-05", "2026-09-10")).toBe(2000);
  });
});

describe("buildAggregateTradeHistoryData", () => {
  /**
   * Mixed trade mirroring the Week 1 2026 screenshot shape:
   * give Bernard + Tyson + Olave; get Black + Nabers + waiver (1-for-2 credit on get).
   * Bernard/Tyson history is sparse/missing; pick history uses a different raw level
   * than the bar's tiered value so scaling must reconcile them.
   */
  const give = [
    asset("bernard", 2_148),
    asset("tyson", 3_130),
    asset("olave", 5_113),
  ];
  const get = [
    asset("black", 1_285),
    asset("nabers", 6_377),
    asset("pick-early", 4_618),
  ];

  const historyByPlayerId = new Map([
    // Olave present every day.
    ["olave", [
      { date: "2026-09-01", value: 4_800 },
      { date: "2026-09-05", value: 5_000 },
      { date: "2026-09-10", value: 5_200 },
    ]],
    // Tyson has a gap on the trade/anchor day.
    ["tyson", [
      { date: "2026-09-01", value: 2_900 },
      { date: "2026-09-10", value: 3_200 },
    ]],
    // Bernard: no history at all.
    // Black: short series.
    ["black", [
      { date: "2026-09-05", value: 1_100 },
      { date: "2026-09-10", value: 1_200 },
    ]],
    ["nabers", [
      { date: "2026-09-01", value: 6_000 },
      { date: "2026-09-05", value: 6_200 },
      { date: "2026-09-10", value: 6_500 },
    ]],
    // Pick history is the Mid market row; bar value is the Early tier.
    ["pick-early", [
      { date: "2026-09-01", value: 3_000 },
      { date: "2026-09-05", value: 3_100 },
      { date: "2026-09-10", value: 3_200 },
    ]],
  ]);

  it("matches bar totals at the anchor date for a mixed trade with gaps and a waiver", () => {
    const bars = tradeBarTotals(give, get);
    // 3-for-3 → no waiver in this shape; force the screenshot 3-for-2 waiver case below.
    expect(bars.give).toBe(2_148 + 3_130 + 5_113);
    expect(bars.get).toBe(1_285 + 6_377 + 4_618);

    const withWaiverGive = give;
    const withWaiverGet = [asset("black", 1_285), asset("nabers", 6_377)];
    const waiverBars = tradeBarTotals(withWaiverGive, withWaiverGet);
    expect(waiverBars.give).toBe(10_391);
    expect(waiverBars.get).toBe(8_415);

    const rows = buildAggregateTradeHistoryData({
      give: withWaiverGive,
      get: withWaiverGet,
      historyByPlayerId,
      anchorDate: "2026-09-05",
    });
    const anchor = rows.find((row) => row.date === "2026-09-05");
    expect(anchor).toEqual({
      date: "2026-09-05",
      give: 10_391,
      get: 8_415,
    });
  });

  it("includes a pick whose history tier differs from the bar value", () => {
    const bars = tradeBarTotals(give, get);
    const rows = buildAggregateTradeHistoryData({
      give,
      get,
      historyByPlayerId,
      anchorDate: "2026-09-05",
    });
    const anchor = rows.find((row) => row.date === "2026-09-05");
    expect(anchor?.give).toBe(bars.give);
    expect(anchor?.get).toBe(bars.get);
  });

  it("keeps a side total when one asset has no history and another has a gap", () => {
    const rows = buildAggregateTradeHistoryData({
      give,
      get: [asset("black", 1_285), asset("nabers", 6_377)],
      historyByPlayerId,
      anchorDate: "2026-09-05",
    });
    // Every plotted date should have numeric give/get (never null from a gap).
    for (const row of rows) {
      expect(row.give).toEqual(expect.any(Number));
      expect(row.get).toEqual(expect.any(Number));
    }
  });

  it("pins the latest point to bar totals when no anchorDate is provided (live calculator)", () => {
    const liveGive = [asset("olave", 5_113)];
    const liveGet = [asset("nabers", 6_377)];
    const bars = tradeBarTotals(liveGive, liveGet);
    const rows = buildAggregateTradeHistoryData({
      give: liveGive,
      get: liveGet,
      historyByPlayerId,
    });
    const latest = rows[rows.length - 1];
    expect(latest?.give).toBe(bars.give);
    expect(latest?.get).toBe(bars.get);
  });

  it("ignores a historical anchor before the plotted history window and pins the latest point instead", () => {
    const liveGive = [asset("olave", 5_113)];
    const liveGet = [asset("nabers", 6_377)];
    const bars = tradeBarTotals(liveGive, liveGet);
    const rows = buildAggregateTradeHistoryData({
      give: liveGive,
      get: liveGet,
      historyByPlayerId,
      anchorDate: "2025-09-01",
    });
    expect(rows.some((row) => row.date === "2025-09-01")).toBe(false);
    const latest = rows[rows.length - 1];
    expect(latest?.give).toBe(bars.give);
    expect(latest?.get).toBe(bars.get);
  });
});
