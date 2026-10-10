import { describe, expect, it } from "vitest";
import {
  isOptimizedLineupChanged,
  matchupProjectionClassName,
  optimizedTotalProjectionClassName,
} from "./lineup-projection";

describe("isOptimizedLineupChanged", () => {
  it("is false when every starter slot already matches the optimized lineup", () => {
    expect(isOptimizedLineupChanged(["hurts", "bijan", "dell"], ["hurts", "bijan", "dell"])).toBe(false);
  });

  it("is true when any starter slot differs from the current lineup", () => {
    expect(isOptimizedLineupChanged(["hurts", "bijan", "dell"], ["hurts", "bijan", "arsb"])).toBe(true);
  });

  it("treats empty vs occupied slots as a change", () => {
    expect(isOptimizedLineupChanged(["hurts", undefined], ["hurts", "arsb"])).toBe(true);
    expect(isOptimizedLineupChanged(["hurts", "dell"], ["hurts"])).toBe(true);
    expect(isOptimizedLineupChanged([], [])).toBe(false);
    expect(isOptimizedLineupChanged([null], [null])).toBe(false);
  });
});

describe("matchupProjectionClassName", () => {
  it("never marks row projections as optimized-change", () => {
    expect(matchupProjectionClassName({ scoreLabel: "PROJ" })).toBe(
      "matchup-number matchup-player-score",
    );
    expect(matchupProjectionClassName({ scoreLabel: "PTS" })).toBe(
      "matchup-number matchup-player-score actual",
    );
  });
});

describe("optimizedTotalProjectionClassName", () => {
  it("ambers the total only in Optimized mode when the lineup is not already set", () => {
    expect(optimizedTotalProjectionClassName({ optimizedMode: true, lineupChanged: true })).toBe(
      "is-optimized-total",
    );
  });

  it("keeps the normal total color when the lineup is already optimal", () => {
    expect(optimizedTotalProjectionClassName({ optimizedMode: true, lineupChanged: false })).toBeUndefined();
  });

  it("keeps the normal total color on Current lineup even when an upgrade exists", () => {
    expect(optimizedTotalProjectionClassName({ optimizedMode: false, lineupChanged: true })).toBeUndefined();
  });
});
