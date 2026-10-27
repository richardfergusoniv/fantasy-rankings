import { describe, expect, it } from "vitest";
import {
  buildImpliedTotalMaps,
  defenseImpliedTotalValues,
  skillImpliedTotalValues,
} from "./weekly-implied-totals";

describe("weekly implied totals", () => {
  const gameLines = [
    { team: "BAL", opponent: "CIN", total: 47.5, impliedPoints: 25.5 },
    { team: "CIN", opponent: "BAL", total: 47.5, impliedPoints: 22 },
  ];

  it("prefers gameLines for kicker team and game totals", () => {
    const { teamTotals, gameTotals } = buildImpliedTotalMaps(gameLines, []);
    expect(skillImpliedTotalValues("BAL", teamTotals, gameTotals)).toEqual({
      teamTotal: 25.5,
      gameTotal: 47.5,
    });
  });

  it("fills DST opponentTotal from gameLines when defense cache is null", () => {
    const { teamTotals, gameTotals } = buildImpliedTotalMaps(gameLines, [
      { team: "BAL", opponent: "CIN", opponentProjectedPoints: null },
    ]);
    expect(defenseImpliedTotalValues("BAL", "CIN", null, teamTotals, gameTotals)).toEqual({
      opponentTotal: 22,
      teamTotal: 25.5,
      gameTotal: 47.5,
    });
  });

  it("keeps defense cache totals when gameLines are missing", () => {
    const { teamTotals, gameTotals } = buildImpliedTotalMaps([], [
      { team: "SEA", opponent: "ARI", opponentProjectedPoints: 17.5 },
    ]);
    expect(defenseImpliedTotalValues("SEA", "ARI", 17.5, teamTotals, gameTotals)).toEqual({
      opponentTotal: 17.5,
    });
    expect(teamTotals.get("ARI")).toBe(17.5);
  });
});
