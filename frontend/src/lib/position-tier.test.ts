import { describe, expect, it } from "vitest";
import { positionTierLabel } from "./position-tier";

describe("positionTierLabel", () => {
  it("splits each 12-player band into high-end, mid and low-end thirds", () => {
    expect(positionTierLabel("RB", 1)).toBe("High-end RB1");
    expect(positionTierLabel("RB", 4)).toBe("High-end RB1");
    expect(positionTierLabel("RB", 5)).toBe("Mid RB1");
    expect(positionTierLabel("RB", 8)).toBe("Mid RB1");
    expect(positionTierLabel("RB", 9)).toBe("Low-end RB1");
    expect(positionTierLabel("RB", 12)).toBe("Low-end RB1");
    expect(positionTierLabel("WR", 13)).toBe("High-end WR2");
    expect(positionTierLabel("WR", 20)).toBe("Mid WR2");
    expect(positionTierLabel("WR", 24)).toBe("Low-end WR2");
    expect(positionTierLabel("TE", 25)).toBe("High-end TE3");
    expect(positionTierLabel("QB", 36)).toBe("Low-end QB3");
  });

  it("scales the bands to the league size", () => {
    expect(positionTierLabel("RB", 10, 10)).toBe("Low-end RB1");
    expect(positionTierLabel("RB", 11, 10)).toBe("High-end RB2");
    expect(positionTierLabel("RB", 14, 15)).toBe("Mid RB1");
  });

  it("returns null past RB3, for unranked players and for K/DEF", () => {
    expect(positionTierLabel("RB", 37)).toBeNull();
    expect(positionTierLabel("RB", null)).toBeNull();
    expect(positionTierLabel("RB", 0)).toBeNull();
    expect(positionTierLabel("K", 3)).toBeNull();
    expect(positionTierLabel("DEF", 3)).toBeNull();
  });
});
