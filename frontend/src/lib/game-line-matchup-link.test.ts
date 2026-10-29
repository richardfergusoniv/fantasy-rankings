import { describe, expect, it } from "vitest";
import { formatImpliedTotal, matchupSelectionForGameLine } from "./game-line-matchup-link";

describe("matchupSelectionForGameLine", () => {
  it("defaults to the away team's perspective", () => {
    expect(matchupSelectionForGameLine({
      awayTeam: "BAL",
      homeTeam: "BUF",
      isFinal: false,
    })).toEqual({
      team: "BAL",
      opponent: "BUF",
      isAway: true,
      gamePhase: null,
    });
  });

  it("focuses the home team when asked", () => {
    expect(matchupSelectionForGameLine({
      awayTeam: "BAL",
      homeTeam: "BUF",
      isFinal: true,
      focusTeam: "BUF",
    })).toEqual({
      team: "BUF",
      opponent: "BAL",
      isAway: false,
      gamePhase: "final",
    });
  });
});

describe("formatImpliedTotal", () => {
  it("formats integers and tenths", () => {
    expect(formatImpliedTotal(28)).toBe("28");
    expect(formatImpliedTotal(25.5)).toBe("25.5");
    expect(formatImpliedTotal(null)).toBe("—");
  });
});
