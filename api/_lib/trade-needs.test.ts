import { describe, expect, it } from "vitest";
import { positionsByNeed, starterFloors, upgradesStarter } from "./trade-needs.js";

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

describe("upgradesStarter", () => {
  const floors = starterFloors([
    { position: "TE", isStarter: true, value: 4000 },
    { position: "WR", isStarter: true, value: 3000 },
    { position: "WR", isStarter: true, value: 6000 },
    { position: "TE", isStarter: false, value: 900 },
  ]);

  it("rejects a tight end who would sit behind the current starter", () => {
    expect(upgradesStarter({ position: "TE", value: 3500 }, floors)).toBe(false);
  });

  it("accepts a player worth more than the weakest starter at his position", () => {
    expect(upgradesStarter({ position: "WR", value: 3500 }, floors)).toBe(true);
    expect(upgradesStarter({ position: "TE", value: 5000 }, floors)).toBe(true);
  });

  it("accepts a position with no starter to compare against", () => {
    expect(upgradesStarter({ position: "RB", value: 100 }, floors)).toBe(true);
  });
});
