import { describe, expect, it } from "vitest";
import { chartWeeklyAxes, preferredWeeklyPreset } from "./chart-weekly-axes";

const kickerPresets = [
  { label: "Vegas implied total", x: "teamTotal", y: "league" },
  { label: "Game total vs projection", x: "gameTotal", y: "league" },
  { label: "Projection vs Sleeper", x: "sleeperProjection", y: "league" },
  { label: "Projected kicker ranks", x: "leaguePositionRank", y: "league" },
];

describe("chartWeeklyAxes", () => {
  it("uses Vegas teamTotal axes for kickers when implied totals exist", () => {
    expect(chartWeeklyAxes("K", [
      { position: "K", values: { league: 9.2, teamTotal: 24.5, leaguePositionRank: 3 } },
    ])).toEqual(["teamTotal", "league"]);
  });

  it("falls back to projection-versus-rank when kicker teamTotal is absent", () => {
    expect(chartWeeklyAxes("K", [
      { position: "K", values: { league: 9.2, leaguePositionRank: 3 } },
      { position: "RB", values: { league: 18, teamTotal: 27 } },
    ])).toEqual(["leaguePositionRank", "league"]);
  });
});

describe("preferredWeeklyPreset", () => {
  it("picks the Vegas preset when teamTotal is available and ranks otherwise", () => {
    expect(preferredWeeklyPreset("K", kickerPresets, [
      { position: "K", values: { teamTotal: 22, league: 8 } },
    ])?.label).toBe("Vegas implied total");
    expect(preferredWeeklyPreset("K", kickerPresets, [
      { position: "K", values: { league: 8, leaguePositionRank: 4 } },
    ])?.label).toBe("Projected kicker ranks");
  });
});
