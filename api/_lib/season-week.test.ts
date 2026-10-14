import { describe, expect, it } from "vitest";
import { isNflValueHistoryInSeason, usesRegularSeasonWeek } from "./season-week.js";

describe("usesRegularSeasonWeek", () => {
  it("attaches week context only during the regular season", () => {
    expect(usesRegularSeasonWeek("regular")).toBe(true);
    expect(usesRegularSeasonWeek("pre")).toBe(false);
    expect(usesRegularSeasonWeek("post")).toBe(false);
    expect(usesRegularSeasonWeek("off")).toBe(false);
    expect(usesRegularSeasonWeek("")).toBe(false);
  });
});

describe("isNflValueHistoryInSeason", () => {
  it("treats preseason, regular season, and playoffs as in-season", () => {
    expect(isNflValueHistoryInSeason("pre")).toBe(true);
    expect(isNflValueHistoryInSeason("regular")).toBe(true);
    expect(isNflValueHistoryInSeason("post")).toBe(true);
  });

  it("treats only the NFL offseason as out of season", () => {
    expect(isNflValueHistoryInSeason("off")).toBe(false);
    expect(isNflValueHistoryInSeason("")).toBe(true);
    expect(isNflValueHistoryInSeason("unknown")).toBe(true);
  });
});
