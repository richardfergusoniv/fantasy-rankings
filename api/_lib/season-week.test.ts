import { describe, expect, it } from "vitest";
import { usesRegularSeasonWeek } from "./season-week.js";

describe("usesRegularSeasonWeek", () => {
  it("attaches week context only during the regular season", () => {
    expect(usesRegularSeasonWeek("regular")).toBe(true);
    expect(usesRegularSeasonWeek("pre")).toBe(false);
    expect(usesRegularSeasonWeek("post")).toBe(false);
    expect(usesRegularSeasonWeek("off")).toBe(false);
    expect(usesRegularSeasonWeek("")).toBe(false);
  });
});
