import { describe, expect, it } from "vitest";
import {
  dashboardFreshness,
  updatedAgoLabel,
  type FreshnessInput,
} from "./dashboard-freshness";

const NOW = new Date("2026-10-24T18:00:00Z").getTime();

function fixture(overrides: Partial<FreshnessInput> = {}): FreshnessInput {
  return {
    status: "ok",
    asOf: "2026-10-24T17:55:00Z",
    rankingsAsOf: null,
    fantasyCalcAsOf: null,
    sourceErrors: [],
    ...overrides,
  };
}

describe("updatedAgoLabel", () => {
  it("reports minutes, hours, and dates", () => {
    expect(updatedAgoLabel("2026-10-24T17:59:40Z", NOW)).toBe("Updated just now");
    expect(updatedAgoLabel("2026-10-24T17:55:00Z", NOW)).toBe("Updated 5m ago");
    expect(updatedAgoLabel("2026-10-24T15:00:00Z", NOW)).toBe("Updated 3h ago");
    expect(updatedAgoLabel("2026-10-20T17:00:00Z", NOW)).toBe("Updated Oct 20");
    expect(updatedAgoLabel("not-a-date", NOW)).toBeNull();
    // A prior-year snapshot shows its year so old data is recognizable.
    expect(updatedAgoLabel("2025-10-24T17:00:00Z", NOW)).toBe("Updated Oct 24, 2025");
  });
});

describe("dashboardFreshness", () => {
  it("distinguishes our build time from underlying source times", () => {
    const info = dashboardFreshness(fixture({
      rankingsAsOf: "2026-10-24T12:00:00Z",
      fantasyCalcAsOf: "2026-10-23T09:00:00Z",
    }), NOW);
    expect(info.updatedLabel).toBe("Updated 5m ago");
    expect(info.sourceLabels).toEqual(["Rankings Oct 24", "Values Oct 23"]);
    expect(info.partial).toBe(false);
    expect(info.notes).toEqual([]);
  });

  it("surfaces simulated Sleeper, nflverse, and FantasyCalc failures while data stays usable", () => {
    // Mirrors the sourceErrors the build records when each source is down:
    // the dashboard still serves cached data, but the notes name what is out.
    const info = dashboardFreshness(fixture({
      status: "partial",
      sourceErrors: [
        "Sleeper projections are unavailable; kicker and DST rankings cannot update, and in-progress players may show their pregame projection.",
        "nflverse advanced stats are temporarily unavailable.",
        "FantasyCalc season-long rankings are unavailable for one or more league formats.",
      ],
    }), NOW);
    expect(info.partial).toBe(true);
    expect(info.notes).toHaveLength(3);
    expect(info.notes.join(" ")).toMatch(/Sleeper/);
    expect(info.notes.join(" ")).toMatch(/nflverse/);
    expect(info.notes.join(" ")).toMatch(/FantasyCalc/);
    // Cached data retained: build time still reported, not an error screen.
    expect(info.updatedLabel).toBe("Updated 5m ago");
  });

  it("treats non-empty sourceErrors as partial even when status is ok", () => {
    const info = dashboardFreshness(fixture({
      status: "ok",
      sourceErrors: ["NFL game status is unavailable; player rows are showing projections."],
    }), NOW);
    expect(info.partial).toBe(true);
    expect(info.notes).toHaveLength(1);
  });
});
