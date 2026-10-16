import { describe, expect, it } from "vitest";
import { waiverAdjustments } from "./trade-adjustment";
import type { TradeAsset } from "../dashboard-types";

function asset(value: number): TradeAsset {
  return { playerId: `p-${value}-${Math.random()}`, name: "Asset", value } as TradeAsset;
}

function assets(...values: number[]): TradeAsset[] {
  return values.map(asset);
}

describe("waiverAdjustments (FantasyCalc trade adjustment)", () => {
  it("is zero for equal piece counts and empty sides", () => {
    expect(waiverAdjustments(assets(100, 200), assets(300, 400))).toEqual({ give: 0, get: 0 });
    expect(waiverAdjustments([], assets(300))).toEqual({ give: 0, get: 0 });
    expect(waiverAdjustments(assets(300), [])).toEqual({ give: 0, get: 0 });
  });

  it("credits the fewer-piece side ~70% of the other side's cheapest piece, capped near 753", () => {
    // 1-for-2: give sends 1 piece, get sends 2 (cheapest 2,000 -> capped).
    const result = waiverAdjustments(assets(9_000), assets(2_000, 5_000));
    expect(result.give).toBe(753);
    expect(result.get).toBe(0);
    // A cheap throw-in credits its 70% instead of the cap.
    const cheap = waiverAdjustments(assets(9_000), assets(500, 5_000));
    expect(cheap.give).toBe(Math.floor(500 * 0.6982));
  });

  it("credits once per extra piece, cheapest first", () => {
    // 1-for-3: gap 2, cheapest two pieces of the larger side.
    const result = waiverAdjustments(assets(10_000), assets(100, 400, 6_000));
    expect(result.give).toBe(Math.floor(100 * 0.6982) + Math.floor(400 * 0.6982));
    expect(result.get).toBe(0);
    // Symmetric: the credit follows whichever side sends fewer.
    const flipped = waiverAdjustments(assets(100, 400, 6_000), assets(10_000));
    expect(flipped.get).toBe(result.give);
    expect(flipped.give).toBe(0);
  });
});
