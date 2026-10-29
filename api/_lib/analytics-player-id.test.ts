import { describe, expect, it } from "vitest";
import { analyticsSleeperPlayerId } from "./analytics-player-id.js";

describe("analyticsSleeperPlayerId", () => {
  it("uses the NFL team code for defenses", () => {
    expect(analyticsSleeperPlayerId("DEF", "BAL", "BAL", {})).toBe("BAL");
  });

  it("maps nflverse GSIS ids to Sleeper ids when present", () => {
    expect(analyticsSleeperPlayerId("WR", "00-0037834", "LAR", { "00-0037834": "12526" })).toBe("12526");
  });

  it("returns null when the GSIS→Sleeper map has no entry", () => {
    expect(analyticsSleeperPlayerId("K", "00-0022921", "BAL", {})).toBeNull();
    expect(analyticsSleeperPlayerId("RB", "00-0033873", "SF", undefined)).toBeNull();
  });
});
