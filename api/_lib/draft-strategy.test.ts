import { describe, expect, it } from "vitest";
import { detectStrategy, lineupValue, simulateStrategy, strategyView } from "./draft-strategy.js";
import type { GradedPick, ValueBoard } from "./draft-grade.js";

const pick = (pickNo: number, rosterId: number, playerId: string, position: string): GradedPick => ({ pickNo, rosterId, playerId, position, name: `Name ${playerId}`, team: "TM" });
const board = (entries: Array<[string, number]>): ValueBoard => new Map(entries);

describe("detectStrategy", () => {
  // 10 teams: pick 1-10 is round 1, 11-20 round 2, and so on.
  it("calls a draft with no running back in the first four rounds Zero RB", () => {
    expect(detectStrategy([pick(5, 1, "a", "WR"), pick(25, 1, "b", "WR"), pick(45, 1, "c", "RB")], 10)).toBe("zero-rb");
  });
  it("calls one early running back and none through round four Hero RB", () => {
    expect(detectStrategy([pick(5, 1, "a", "RB"), pick(25, 1, "b", "WR"), pick(55, 1, "c", "RB")], 10)).toBe("hero-rb");
  });
  it("calls two running backs in the first three rounds Robust RB", () => {
    expect(detectStrategy([pick(5, 1, "a", "RB"), pick(15, 1, "b", "RB"), pick(25, 1, "c", "WR")], 10)).toBe("robust-rb");
  });
  it("falls back to Balanced for anything else", () => {
    expect(detectStrategy([pick(35, 1, "a", "RB"), pick(45, 1, "b", "RB")], 10)).toBe("balanced");
  });
});

describe("lineupValue", () => {
  it("fills dedicated slots, then flex slots with the best of what is left", () => {
    const players = [
      { position: "QB", value: 10 }, { position: "RB", value: 8 }, { position: "RB", value: 7 },
      { position: "WR", value: 9 }, { position: "TE", value: 3 },
    ];
    expect(lineupValue(players, ["QB", "RB", "WR", "FLEX"])).toBe(10 + 8 + 9 + 7);
    expect(lineupValue(players, ["QB", "SUPER_FLEX"])).toBe(10 + 9);
  });
});

describe("simulateStrategy", () => {
  const slots = ["QB", "RB", "WR", "TE", "FLEX"];
  const values = board([["rb", 900], ["wr", 800], ["qb", 700], ["qbLater", 650], ["rb2", 500]]);
  const base = { rosterId: 1, values, teams: 2, slots };

  it("never takes a running back in the first rounds under Zero RB", () => {
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "rb", "RB")];
    const sim = simulateStrategy({ ...base, strategy: "zero-rb", picks });
    expect(sim[0]?.chosen.playerId).toBe("wr");
    const rbFirst = [pick(1, 1, "rb2", "RB"), pick(2, 2, "wr", "WR"), pick(3, 2, "rb", "RB")];
    expect(simulateStrategy({ ...base, strategy: "zero-rb", picks: rbFirst })[0]?.chosen.playerId).toBe("wr");
  });

  it("does not suggest another quarterback when the team got one later", () => {
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qb", "QB"), pick(3, 1, "qbLater", "QB"), pick(4, 2, "rb2", "RB")];
    const sim = simulateStrategy({ ...base, strategy: "balanced", picks });
    expect(sim[0]?.chosen.playerId).toBe("wr");
  });
});

describe("strategyView", () => {
  const slots = ["QB", "RB", "WR", "TE", "FLEX"];

  it("leaves every pick alone when nothing would have beaten the roster", () => {
    const values = board([["a", 900], ["b", 800], ["c", 700]]);
    const picks = [pick(1, 1, "a", "WR"), pick(2, 2, "b", "WR"), pick(3, 1, "c", "WR")];
    const view = strategyView({ picks, rosterId: 1, values, teams: 2, slots });
    expect([...view!.yoursPicks.values(), ...view!.bestPicks.values()].every((entry) => entry === null)).toBe(true);
  });

  it("names the better strategy and the players it would have taken", () => {
    // Team 1 took a bust RB first; the WR next door became far more valuable.
    const values = board([["bust", 100], ["wr1", 900], ["rb2", 300], ["wr2", 600]]);
    const picks = [pick(1, 1, "bust", "RB"), pick(2, 2, "wr1", "WR"), pick(3, 1, "rb2", "RB"), pick(4, 2, "wr2", "WR")];
    const view = strategyView({ picks, rosterId: 1, values, teams: 2, slots });
    expect(view?.yours).toBe("robust-rb");
    expect(view?.bestPicks.get("bust")?.playerId).toBe("wr1");
  });

  it("is null without picks or values", () => {
    expect(strategyView({ picks: [], rosterId: 1, values: board([["a", 1]]), teams: 2 })).toBeNull();
  });
});
