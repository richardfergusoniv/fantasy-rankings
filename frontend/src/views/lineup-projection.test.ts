import { describe, expect, it } from "vitest";
import { isOptimizedSlotChanged, matchupProjectionClassName } from "./lineup-projection";

describe("isOptimizedSlotChanged", () => {
  it("is false when the same player stays in the slot", () => {
    expect(isOptimizedSlotChanged("hurts", "hurts")).toBe(false);
  });

  it("is true when the optimizer puts a different player in the slot", () => {
    expect(isOptimizedSlotChanged("dell", "arsb")).toBe(true);
  });

  it("treats empty vs occupied as a change", () => {
    expect(isOptimizedSlotChanged(undefined, "arsb")).toBe(true);
    expect(isOptimizedSlotChanged("dell", undefined)).toBe(true);
    expect(isOptimizedSlotChanged(undefined, undefined)).toBe(false);
    expect(isOptimizedSlotChanged(null, null)).toBe(false);
  });
});

describe("matchupProjectionClassName", () => {
  it("highlights changed slots and leaves unchanged projections unmarked", () => {
    expect(matchupProjectionClassName({ scoreLabel: "PROJ", slotChanged: true })).toBe(
      "matchup-number matchup-player-score is-optimized-change",
    );
    expect(matchupProjectionClassName({ scoreLabel: "PROJ", slotChanged: false })).toBe(
      "matchup-number matchup-player-score",
    );
  });

  it("keeps the actual-points modifier alongside a changed highlight", () => {
    expect(matchupProjectionClassName({ scoreLabel: "PTS", slotChanged: true })).toBe(
      "matchup-number matchup-player-score actual is-optimized-change",
    );
  });
});
