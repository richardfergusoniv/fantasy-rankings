import { expect, it } from "vitest";
import { parsePeriodScores } from "./period-scores.js";
it("preserves real zeros and overtime scores", () => {
  expect(parsePeriodScores([{ value: 0 }, { displayValue: "7" }, { value: 3 }, { value: 0 }, { value: 6 }])).toEqual([0, 7, 3, 0, 6]);
});
it("rejects the whole line when a period is unavailable", () => {
  for (const period of [{}, { displayValue: "" }, { displayValue: "--" }, { value: NaN }, { displayValue: "7x" }]) {
    expect(parsePeriodScores([{ value: 7 }, period])).toBeNull();
  }
  expect(parsePeriodScores()).toEqual([]);
});
