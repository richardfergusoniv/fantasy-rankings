import { describe, expect, it } from "vitest";
import { playoffsCaption, playoffStatusLabel, pointsLine } from "./standings";

const row = { rank: 7, wins: 3, losses: 4, ties: 0, pointsFor: 801.234, pointsAgainst: 760, playoffSeed: null, gamesOutOfPlayoffs: 1.5 };

describe("standings labels", () => {
  it("shows the seed in position and games back out of it", () => {
    expect(playoffStatusLabel({ ...row, playoffSeed: 3, gamesOutOfPlayoffs: null })).toBe("Seed 3");
    expect(playoffStatusLabel(row)).toBe("1.5 GB");
    expect(playoffStatusLabel({ ...row, gamesOutOfPlayoffs: 0 })).toBe("Tiebreak");
    expect(playoffStatusLabel({ ...row, gamesOutOfPlayoffs: null })).toBe("—");
  });

  it("formats points and the playoff caption", () => {
    expect(pointsLine(row)).toBe("PF 801.2 · PA 760.0");
    expect(playoffsCaption({ teams: 6, weekStart: 15 })).toBe("Top 6 make the playoffs · starts Week 15");
    expect(playoffsCaption({ teams: 6, weekStart: null })).toBe("Top 6 make the playoffs");
    expect(playoffsCaption({ teams: null, weekStart: 15 })).toBeNull();
  });
});
