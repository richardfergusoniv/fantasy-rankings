import { describe, expect, it } from "vitest";
import { MOVE_BAR_CAP, moveBarLabel, moveBarSpan } from "./move-bar";

describe("moveBarSpan", () => {
  it("grows right from the middle for a rise", () => {
    expect(moveBarSpan(25)).toEqual({ left: 50, width: 25, direction: "up" });
  });

  it("grows left from the middle for a fall", () => {
    expect(moveBarSpan(-10)).toEqual({ left: 40, width: 10, direction: "down" });
  });

  it("stops at the end of the track past the cap", () => {
    expect(moveBarSpan(MOVE_BAR_CAP * 3)).toEqual({ left: 50, width: 50, direction: "up" });
    expect(moveBarSpan(-MOVE_BAR_CAP * 3)).toEqual({ left: 0, width: 50, direction: "down" });
  });

  it("fills the right half for a rise from zero", () => {
    expect(moveBarSpan(Number.POSITIVE_INFINITY)).toEqual({ left: 50, width: 50, direction: "up" });
  });

  it("draws no bar for no change", () => {
    expect(moveBarSpan(0)).toEqual({ left: 50, width: 0, direction: "flat" });
    expect(moveBarSpan(Number.NaN)).toEqual({ left: 50, width: 0, direction: "flat" });
  });
});

describe("moveBarLabel", () => {
  it("says the direction and size of the move", () => {
    expect(moveBarLabel(12.34)).toBe("Up 12.3% in 30 days");
    expect(moveBarLabel(-4)).toBe("Down 4.0% in 30 days");
  });

  it("names a rise from zero and no change", () => {
    expect(moveBarLabel(Number.POSITIVE_INFINITY)).toBe("Up from 0 in 30 days");
    expect(moveBarLabel(0)).toBe("No change in 30 days");
  });
});
