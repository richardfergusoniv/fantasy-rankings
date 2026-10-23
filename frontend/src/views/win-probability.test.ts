import { describe, expect, it } from "vitest";
import { normalCdf, remainingShare, teamOutlook, winPercent, winProbability } from "./win-probability";

const base = {
  actual: null,
  gamePhase: "pregame" as const,
  gameTime: null,
  gamePeriod: null,
  gameClockSeconds: null,
  injuryStatus: null,
  isBye: false,
};

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413, 4);
    expect(normalCdf(-1.2816)).toBeCloseTo(0.1, 3);
  });
});

describe("remainingShare", () => {
  it("is full before kickoff, empty when final, and shrinks with the clock", () => {
    expect(remainingShare({ ...base, playerId: "1", position: "WR", projection: 10 })).toBe(1);
    expect(remainingShare({ ...base, playerId: "1", position: "WR", projection: 10, gamePhase: "final", actual: 12 })).toBe(0);
    expect(remainingShare({ ...base, playerId: "1", position: "WR", projection: 10, gamePhase: "live", actual: 4, gamePeriod: 3, gameClockSeconds: 900 })).toBeCloseTo(0.5);
    expect(remainingShare({ ...base, playerId: "0", position: "WR", projection: 10 })).toBe(0);
  });
});

describe("teamOutlook and winProbability", () => {
  const lineup = (projections: Array<[string, number]>) => projections.map(([position, projection], index) => ({ ...base, playerId: String(index + 1), position, projection }));

  it("sums projections and spreads by position", () => {
    const outlook = teamOutlook(lineup([["QB", 20], ["WR", 10]]));
    expect(outlook?.mean).toBe(30);
    // sqrt((0.4*20)^2 + (0.55*10)^2) = sqrt(64 + 30.25)
    expect(outlook?.sd).toBeCloseTo(Math.sqrt(94.25), 6);
    expect(outlook?.low).toBeCloseTo(30 - 1.2816 * Math.sqrt(94.25), 6);
  });

  it("favors the higher projection and is even for equal teams", () => {
    const mine = teamOutlook(lineup([["QB", 20], ["RB", 15], ["WR", 15]]))!;
    const theirs = teamOutlook(lineup([["QB", 18], ["RB", 12], ["WR", 12]]))!;
    expect(winProbability(mine, theirs)).toBeGreaterThan(0.6);
    expect(winProbability(mine, mine)).toBeCloseTo(0.5, 6);
  });

  it("keeps uncertainty for a live player with no projection", () => {
    const live = { ...base, playerId: "1", position: "WR", projection: null, gamePhase: "live" as const, actual: 6, gamePeriod: 2, gameClockSeconds: 450 };
    const final = { ...base, playerId: "2", position: "WR", projection: 10, gamePhase: "final" as const, actual: 10 };
    expect(teamOutlook([live])?.sd).toBeGreaterThan(0);
    expect(winProbability(teamOutlook([live])!, teamOutlook([final])!)).toBeLessThan(1);
  });

  it("is certain once every game is final", () => {
    const done = (actual: number) => ({ ...base, playerId: "1", position: "WR", projection: 10, gamePhase: "final" as const, actual });
    expect(winProbability(teamOutlook([done(20)])!, teamOutlook([done(10)])!)).toBe(1);
    expect(winPercent(1)).toBe(100);
    expect(winPercent(0.9999)).toBe(99.9);
    expect(winPercent(0.0001)).toBe(0.1);
    expect(winPercent(0.6234)).toBe(62.3);
  });
});
