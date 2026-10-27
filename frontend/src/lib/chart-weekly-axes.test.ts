import { describe, expect, it } from "vitest";
import { chartWeeklyAxes, preferredWeeklyPreset } from "./chart-weekly-axes";

const kickerPresets = [
  { label: "Vegas implied total", x: "teamTotal", y: "league" },
  { label: "Game total vs projection", x: "gameTotal", y: "league" },
  { label: "Projection vs Sleeper", x: "sleeperProjection", y: "league" },
  { label: "Projected kicker ranks", x: "leaguePositionRank", y: "league" },
];

describe("chartWeeklyAxes", () => {
  it("uses Vegas teamTotal axes when every rank-eligible kicker has teamTotal", () => {
    expect(chartWeeklyAxes("K", [
      { position: "K", values: { league: 9.2, teamTotal: 24.5, leaguePositionRank: 3 } },
      { position: "K", values: { league: 8.1, teamTotal: 21.0, leaguePositionRank: 7 } },
    ])).toEqual(["teamTotal", "league"]);
  });

  it("falls back to projection-versus-rank when some eligible kickers lack teamTotal", () => {
    expect(chartWeeklyAxes("K", [
      { position: "K", values: { league: 9.2, teamTotal: 24.5, leaguePositionRank: 3 } },
      { position: "K", values: { league: 8.1, leaguePositionRank: 7 } },
    ])).toEqual(["leaguePositionRank", "league"]);
  });

  it("falls back to projection-versus-rank when no kicker has teamTotal", () => {
    expect(chartWeeklyAxes("K", [
      { position: "K", values: { league: 9.2, leaguePositionRank: 3 } },
      { position: "RB", values: { league: 18, teamTotal: 27 } },
    ])).toEqual(["leaguePositionRank", "league"]);
  });
});

describe("preferredWeeklyPreset", () => {
  it("auto-picks Vegas only for complete teamTotal coverage; ranks otherwise", () => {
    expect(preferredWeeklyPreset("K", kickerPresets, [
      { position: "K", values: { teamTotal: 22, league: 8, leaguePositionRank: 2 } },
    ])?.label).toBe("Vegas implied total");
    expect(preferredWeeklyPreset("K", kickerPresets, [
      { position: "K", values: { teamTotal: 22, league: 8, leaguePositionRank: 2 } },
      { position: "K", values: { league: 7, leaguePositionRank: 9 } },
    ])?.label).toBe("Projected kicker ranks");
    expect(kickerPresets.some((preset) => preset.x === "teamTotal")).toBe(true);
  });
});
