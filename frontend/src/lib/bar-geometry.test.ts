import { describe, expect, it } from "vitest";
import { gapBarShare, rankStripLabelShift, rankStripLead, rankStripPosition } from "./bar-geometry";

describe("rankStripPosition", () => {
  it("puts #1 at the left end and the last rank at the right end", () => {
    expect(rankStripPosition(1, 32)).toBe(0);
    expect(rankStripPosition(32, 32)).toBe(100);
  });

  it("places middle ranks proportionally", () => {
    expect(rankStripPosition(6, 32)).toBeCloseTo(16.13, 1);
    expect(rankStripPosition(28, 32)).toBeCloseTo(87.1, 1);
  });

  it("clamps out-of-range ranks and degenerate totals", () => {
    expect(rankStripPosition(0, 32)).toBe(0);
    expect(rankStripPosition(40, 32)).toBe(100);
    expect(rankStripPosition(3, 1)).toBe(0);
  });
});

describe("rankStripLead", () => {
  it("favors the lower rank", () => {
    expect(rankStripLead(6, 28)).toBe("first");
    expect(rankStripLead(20, 8)).toBe("second");
  });

  it("is null when the ranks match", () => {
    expect(rankStripLead(10, 10)).toBeNull();
  });
});

describe("rankStripLabelShift", () => {
  it("centers labels except near the ends", () => {
    expect(rankStripLabelShift(50)).toBe(-50);
    expect(rankStripLabelShift(5)).toBe(-10);
    expect(rankStripLabelShift(95)).toBe(-90);
  });
});

describe("gapBarShare", () => {
  it("grows toward the higher value by default", () => {
    const result = gapBarShare(17.4, 14.0);
    expect(result.side).toBe("left");
    expect(result.share).toBeCloseTo(21.7, 1);
  });

  it("grows toward the lower value when lower is better", () => {
    expect(gapBarShare(4, 6, { lowerIsBetter: true }).side).toBe("left");
    expect(gapBarShare(6, 4, { lowerIsBetter: true }).side).toBe("right");
  });

  it("has no bar for a tie, a neutral metric or two zeros", () => {
    expect(gapBarShare(5, 5)).toEqual({ side: null, share: 0 });
    expect(gapBarShare(9, 3, { neutral: true })).toEqual({ side: null, share: 0 });
    expect(gapBarShare(0, 0)).toEqual({ side: null, share: 0 });
  });

  it("caps the bar at half the track", () => {
    expect(gapBarShare(100, 1).share).toBe(50);
    expect(gapBarShare(5, 0).share).toBe(50);
  });
});
