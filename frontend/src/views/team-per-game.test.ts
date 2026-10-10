import { describe, expect, it } from "vitest";
import { formatDecimal } from "../lib/format-number";
import { perGame, perGameRank } from "./team-per-game";

describe("perGame", () => {
  it("divides the season total by games played and keeps one decimal", () => {
    expect(perGame(121, 5)).toBe(24.2);
    expect(formatDecimal(perGame(121, 5) ?? 0, 1)).toBe("24.2");
    expect(perGame(1860, 5)).toBe(372);
  });

  it("returns null when games played is zero or the inputs are not finite", () => {
    expect(perGame(24, 0)).toBeNull();
    expect(perGame(24, -1)).toBeNull();
    expect(perGame(Number.NaN, 5)).toBeNull();
    expect(perGame(24, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("perGameRank", () => {
  const samples = [
    { total: 100, games: 4 },
    { total: 100, games: 5 },
    { total: 90, games: 5 },
    { total: 40, games: 0 },
  ];

  it("ranks the per-game rate, so equal season totals can separate", () => {
    expect(perGameRank(samples, 100, 4)).toBe(1);
    expect(perGameRank(samples, 100, 5)).toBe(2);
    expect(perGameRank(samples, 90, 5)).toBe(3);
  });

  it("leaves a team with no games played unranked and out of the comparison", () => {
    expect(perGameRank(samples, 40, 0)).toBeNull();
    expect(perGameRank([{ total: 40, games: 0 }, { total: 10, games: 2 }], 10, 2)).toBeNull();
  });

  it("treats fewer turnovers per game as the better rank", () => {
    const turnovers = [
      { total: 4, games: 4 },
      { total: 8, games: 2 },
      { total: 10, games: 5 },
    ];
    expect(perGameRank(turnovers, 4, 4, false)).toBe(1);
    expect(perGameRank(turnovers, 8, 2, false)).toBe(3);
    expect(perGameRank(turnovers, 10, 5, false)).toBe(2);
  });

  it("shares the best rank when the displayed rates tie", () => {
    const tied = [
      { total: 121, games: 5 },
      { total: 242, games: 10 },
      { total: 50, games: 5 },
    ];
    expect(perGameRank(tied, 121, 5)).toBe(1);
    expect(perGameRank(tied, 242, 10)).toBe(1);
  });
});
