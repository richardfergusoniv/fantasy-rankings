import { describe, expect, it } from "vitest";
import { gameLineSummary } from "./game-line-summary";

const lines = [
  { team: "KC", opponent: "TEN", spread: -7, total: 44.5, impliedPoints: 25.8 },
  { team: "TEN", opponent: "KC", spread: 7, total: 44.5, impliedPoints: 18.8 },
];

describe("gameLineSummary", () => {
  it("names the favorite and both implied totals from either side", () => {
    expect(gameLineSummary(lines, "KC", "TEN")).toBe("KC −7 · O/U 44.5 · Implied KC 25.8, TEN 18.8");
    expect(gameLineSummary(lines, "TEN", "KC")).toBe("KC −7 · O/U 44.5 · Implied TEN 18.8, KC 25.8");
  });

  it("handles a pick'em and missing lines", () => {
    expect(gameLineSummary([{ team: "A", opponent: "B", spread: 0, total: null, impliedPoints: null }], "A", "B")).toBe("Pick'em");
    expect(gameLineSummary(lines, "KC", "LV")).toBeNull();
    expect(gameLineSummary([{ team: "A", opponent: "B", spread: null, total: null, impliedPoints: null }], "A", "B")).toBeNull();
  });
});
