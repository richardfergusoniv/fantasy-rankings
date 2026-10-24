import { describe, expect, it } from "vitest";
import { waiverStatusLabel } from "./waiver-status";

describe("waiverStatusLabel", () => {
  it("shows FAAB remaining and waiver position", () => {
    expect(waiverStatusLabel({ type: "faab", budget: 100, remaining: 63, position: 4, teams: 12 })).toBe("FAAB $63 of $100 left · Waiver #4 of 12");
  });

  it("names the order type for non-FAAB leagues and hides empty status", () => {
    expect(waiverStatusLabel({ type: "rolling", budget: null, remaining: null, position: 2, teams: 10 })).toBe("Waiver #2 of 10 · rolling");
    expect(waiverStatusLabel({ type: null, budget: null, remaining: null, position: null, teams: 10 })).toBeNull();
    expect(waiverStatusLabel(null)).toBeNull();
  });
});
