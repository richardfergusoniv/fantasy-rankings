import { describe, expect, it } from "vitest";
import { positionsByNeed, startsForRoster } from "./trade-needs.js";

const team = (QB: number, RB: number, WR: number, TE: number) => ({ positionValues: { QB, RB, WR, TE } });

describe("positionsByNeed", () => {
  it("does not always put tight end first just because its totals are small", () => {
    const league = [team(100, 100, 100, 20), team(100, 100, 100, 20), team(100, 60, 100, 20)];
    // Me: TE at the league average, RB well below it.
    const me = team(100, 60, 100, 20);
    expect(positionsByNeed(me, league)[0]).toBe("RB");
  });

  it("still ranks tight end first when it really is the weakest", () => {
    const league = [team(100, 100, 100, 20), team(100, 100, 100, 20), team(100, 100, 100, 5)];
    expect(positionsByNeed(team(100, 100, 100, 5), league)[0]).toBe("TE");
  });
});

describe("startsForRoster", () => {
  const roster = [
    { playerId: "te1", position: "TE" },
    { playerId: "wr1", position: "WR" },
    { playerId: "wr2", position: "WR" },
    { playerId: "rb1", position: "RB" },
  ];
  const values = new Map([["te1", 6000], ["wr1", 7000], ["wr2", 2000], ["rb1", 5000], ["te2", 5000], ["te3", 1500], ["rb2", 100]]);

  it("rejects a tight end who would sit on the bench", () => {
    const starts = startsForRoster(roster, ["WR", "RB", "TE", "FLEX"], values);
    expect(starts({ playerId: "te3", position: "TE" })).toBe(false);
  });

  it("accepts a tight end who would start at FLEX behind a better tight end", () => {
    const starts = startsForRoster(roster, ["WR", "RB", "TE", "FLEX"], values);
    expect(starts({ playerId: "te2", position: "TE" })).toBe(true);
  });

  it("accepts any player for a slot the roster can't fill", () => {
    const starts = startsForRoster(roster, ["WR", "RB", "RB", "TE"], values);
    expect(starts({ playerId: "rb2", position: "RB" })).toBe(true);
  });
});
