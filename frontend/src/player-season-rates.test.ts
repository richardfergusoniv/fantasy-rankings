import { describe, expect, it } from "vitest";
import type { AnalyticsEntity } from "./dashboard-types";
import { peerSeasonRates, seasonRateRank, seasonRateRows } from "./player-season-rates";

function entity(name: string, position: AnalyticsEntity["position"], season: Record<string, number>): AnalyticsEntity {
  return {
    id: name,
    name,
    team: "KC",
    position,
    seasonGames: 5,
    rollingGames: 5,
    season,
    rolling17: {},
  };
}

describe("seasonRateRows", () => {
  const peers = [
    entity("Other Back", "RB", { carries: 18.04, rushing_yards: 80.2, rushing_tds: 0.8 }),
    entity("Third Back", "RB", { carries: 8.0, rushing_yards: 30.0, rushing_tds: 0.2 }),
  ];

  it("shows per-game rates and ranks the displayed tenth against same-position peers", () => {
    const rows = seasonRateRows(
      ["fantasyPoints", "rushAtt", "rushYds", "rushTd"],
      { fantasyPoints: 80, rushAtt: 90, rushYds: 400, rushTd: 5 },
      5,
      (analyticsKey) => peerSeasonRates(peers, "RB", analyticsKey, () => false),
    );
    expect(rows).toEqual([
      { key: "fantasyPoints", label: "FPTS/G", rate: 16, rank: null },
      { key: "rushAtt", label: "CAR/G", rate: 18, rank: 1 },
      { key: "rushYds", label: "RUSH YDS/G", rate: 80, rank: 2 },
      { key: "rushTd", label: "RUSH TD/G", rate: 1, rank: 1 },
    ]);
  });

  it("treats interceptions as lower-is-better and leaves a lone peer unranked", () => {
    expect(seasonRateRank([1.24, 0.4], 0.8, false)).toBe(2);
    expect(seasonRateRank([1.2], 0.8, false)).toBe(1);
    expect(seasonRateRank([], 0.8, false)).toBeNull();
  });

  it("excludes the displayed player so their nflverse rate is not counted twice", () => {
    const self = entity("Shown Back", "RB", { rushing_yards: 10 });
    const rates = peerSeasonRates([self, ...peers], "RB", "rushing_yards", (candidate) => candidate.name === "Shown Back");
    expect(rates).toEqual([80.2, 30]);
    expect(seasonRateRank(rates, 80)).toBe(2);
  });
});
