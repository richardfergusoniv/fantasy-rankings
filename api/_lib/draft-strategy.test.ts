import { describe, expect, it } from "vitest";
import { detectPlan, detectStrategy, lineupValue, simulateStrategy, strategyView } from "./draft-strategy.js";
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

describe("lineupValue with overlapping flex slots", () => {
  it("assigns players across REC_FLEX and WRRB_FLEX for the best total", () => {
    const players = [{ position: "WR", value: 10 }, { position: "TE", value: 9 }, { position: "RB", value: 1 }];
    expect(lineupValue(players, ["REC_FLEX", "WRRB_FLEX"])).toBe(19);
  });
});

describe("simulateStrategy feasibility", () => {
  it("has no replay for a plan that leaves a pick with only banned players", () => {
    const values = board([["rb1", 900], ["rb2", 800]]);
    const picks = [pick(1, 1, "rb1", "RB"), pick(2, 2, "rb2", "RB")];
    const args = { picks, rosterId: 1, values, teams: 2, slots: ["RB"] };
    expect(simulateStrategy({ ...args, plan: { rb: "zero-rb", qb: "late", te: "late" } })).toBeNull();
    expect(simulateStrategy({ ...args, plan: { rb: "balanced", qb: "late", te: "late" } })).not.toBeNull();
  });
});

describe("simulateStrategy lineup contribution", () => {
  it("does not trade away a needed starter for a marginally better bench player", () => {
    const values = board([["qb", 100], ["wrOpp", 110], ["wrMine", 200], ["wrOpp2", 201]]);
    const picks = [pick(41, 1, "qb", "QB"), pick(42, 2, "wrOpp", "WR"), pick(51, 1, "wrMine", "WR"), pick(52, 2, "wrOpp2", "WR")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR"] });
    expect(sim?.map((item) => item.chosen.playerId)).toEqual(["qb", "wrOpp2"]);
  });
});

describe("simulateStrategy plan requirements", () => {
  it("takes a quarterback in the early rounds when the plan requires one, even if another player is worth more", () => {
    const values = board([["wr", 100], ["qbOpp", 1], ["rb", 1000]]);
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qbOpp", "QB"), pick(51, 1, "rb", "RB")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "early", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR", "RB"] });
    expect(sim?.[0]?.chosen.playerId).toBe("qbOpp");
  });

  it("has no replay when no quarterback could be taken early", () => {
    const values = board([["wr", 100], ["wrOpp", 90]]);
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "wrOpp", "WR")];
    expect(simulateStrategy({ plan: { rb: "balanced", qb: "early", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR"] })).toBeNull();
  });
});

describe("simulateStrategy edge cases", () => {
  it("counts every TE-eligible flex slot in the tight-end cap", () => {
    const values = board([["te1", 100], ["te2", 90], ["wr", 1], ["teOpp", 80]]);
    const picks = [pick(1, 1, "te1", "TE"), pick(2, 1, "te2", "TE"), pick(41, 1, "wr", "WR"), pick(42, 2, "teOpp", "TE")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "early" }, picks, rosterId: 1, values, teams: 10, slots: ["TE", "FLEX", "FLEX"] });
    expect(sim?.[2]?.chosen.playerId).toBe("teOpp");
  });

  it("replaces a skill player who has fallen off today's board", () => {
    const values = board([["wrOpp", 100], ["floor", 1]]);
    const picks = [pick(41, 1, "gone", "WR"), pick(42, 2, "wrOpp", "WR")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["WR"] });
    expect(sim?.[0]?.chosen.playerId).toBe("wrOpp");
  });
});

describe("simulateStrategy same-position upgrades", () => {
  it("lets a starting QB be upgraded even when a backup was drafted later", () => {
    const values = board([["qb1", 100], ["qbOpp", 200], ["qb2", 1]]);
    const picks = [pick(41, 1, "qb1", "QB"), pick(42, 2, "qbOpp", "QB"), pick(61, 1, "qb2", "QB")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB"] });
    expect(sim?.[0]?.chosen.playerId).toBe("qbOpp");
  });
});

describe("simulateStrategy Hero RB", () => {
  it("favors its first early running back unless a player at another position is clearly better", () => {
    const values = board([["rb", 99], ["wrOpp", 100], ["wr", 50]]);
    const picks = [pick(1, 1, "rb", "RB"), pick(2, 2, "wrOpp", "WR"), pick(11, 1, "wr", "WR")];
    const sim = simulateStrategy({ plan: { rb: "hero-rb", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["RB", "WR", "FLEX"] });
    expect(sim?.[0]?.chosen.playerId).toBe("rb");
  });
});

describe("simulateStrategy backtracking", () => {
  it("backs up an earlier choice when it would leave a later pick with nobody the plan allows", () => {
    const values = board([["wr", 10], ["rb", 1], ["wrOpp", 20]]);
    const picks = [pick(10, 1, "wr", "WR"), pick(11, 2, "x", "WR"), pick(12, 1, "rb", "RB"), pick(13, 2, "wrOpp", "WR")];
    const sim = simulateStrategy({ plan: { rb: "zero-rb", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["RB", "WR", "FLEX"] });
    expect(sim?.map((item) => item.chosen.playerId)).toEqual(["wr", "wrOpp"]);
  });
});

describe("simulateStrategy back-to-back picks", () => {
  it("reaches the best total with the fewest changed picks when picks share a candidate", () => {
    const values = board([["wr19", 19], ["wr1", 1], ["wrOpp", 20]]);
    const picks = [pick(10, 1, "wr19", "WR"), pick(11, 1, "wr1", "WR"), pick(12, 2, "wrOpp", "WR")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["WR", "WR"] });
    // Either order totals 39; keeping the pick-10 player and changing only pick 11 is one change, not two.
    expect(sim?.map((item) => item.chosen.playerId)).toEqual(["wr19", "wrOpp"]);
  });

  it("does not offer a player drafted earlier once another team has picked since", () => {
    const values = board([["wr19", 19], ["wr1", 1]]);
    const picks = [pick(1, 1, "wr19", "WR"), pick(2, 2, "other", "WR"), pick(3, 1, "wr1", "WR")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["WR", "WR"] });
    expect(sim?.[1]?.chosen.playerId).toBe("wr1");
  });
});

describe("simulateStrategy full search", () => {
  it("finds the best total when two picks compete for a player and nobody can be shuffled back", () => {
    const values = board([["wrA", 19], ["wrB", 1], ["wrC", 20]]);
    const picks = [pick(10, 1, "wrA", "WR"), pick(11, 2, "x", "WR"), pick(12, 1, "wrB", "WR"), pick(13, 2, "wrC", "WR")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["WR", "WR"] });
    expect(sim?.map((item) => item.chosen.playerId)).toEqual(["wrA", "wrC"]);
  });
});

describe("simulateStrategy position caps", () => {
  it("lets a plan replace a late quarterback with another position when it takes one early", () => {
    const values = board([["wr", 100], ["qb", 1], ["qbOpp", 200], ["wrOpp", 100]]);
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qbOpp", "QB"), pick(51, 1, "qb", "QB"), pick(52, 2, "wrOpp", "WR")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "early", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR"] });
    expect(sim?.map((item) => item.chosen.playerId)).toEqual(["qbOpp", "wrOpp"]);
  });

  it("has no replay when the only way to take a quarterback early would leave two the lineup cannot use", () => {
    const values = board([["wr", 100], ["qbOpp", 200], ["qb", 150]]);
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qbOpp", "QB"), pick(51, 1, "qb", "QB")];
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "early", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR"] });
    expect(sim).toBeNull();
  });
});

describe("simulateStrategy search limits", () => {
  it("still finds a legal replay when the best-looking branch can never be completed", () => {
    // A late-drafted QB the user must keep, an early opposing QB that would leave two, and many pointless
    // combinations of bench picks in between.
    const values = new Map<string, number>([["w0", 100], ["q", 200], ["w1", 101], ["myQb", 1]]);
    const picks: GradedPick[] = [pick(41, 1, "w0", "WR"), pick(42, 2, "q", "QB"), pick(43, 2, "w1", "WR")];
    for (let i = 0; i < 5; i += 1) {
      const own = 50 + i * 10;
      picks.push(pick(own, 1, `mine${i}`, "WR"));
      values.set(`mine${i}`, 5);
      for (let k = 1; k <= 9; k += 1) { picks.push(pick(own + k, 2, `opp${i}-${k}`, "WR")); values.set(`opp${i}-${k}`, 5 + k); }
    }
    picks.push(pick(161, 1, "myQb", "QB"));
    const sim = simulateStrategy({ plan: { rb: "balanced", qb: "late", te: "late" }, picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR"] });
    expect(sim).not.toBeNull();
    expect(sim?.[0]?.chosen.playerId).toBe("w1");
    expect(sim?.[sim.length - 1]?.chosen.playerId).toBe("myQb");
  });
});

describe("detectPlan", () => {
  it("reads QB and TE as early when taken in the first four rounds, otherwise late", () => {
    const picks = [pick(5, 1, "q", "QB"), pick(55, 1, "t", "TE")];
    expect(detectPlan(picks, 10)).toMatchObject({ qb: "early", te: "late" });
    expect(detectPlan([], 10)).toMatchObject({ qb: "late", te: "late" });
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
    const sim = simulateStrategy({ ...base, plan: { rb: "zero-rb", qb: "late", te: "late" }, picks });
    expect(sim?.[0]?.chosen.playerId).toBe("wr");
    const rbFirst = [pick(1, 1, "rb2", "RB"), pick(2, 2, "wr", "WR"), pick(3, 2, "rb", "RB")];
    expect(simulateStrategy({ ...base, plan: { rb: "zero-rb", qb: "late", te: "late" }, picks: rbFirst })?.[0]?.chosen.playerId).toBe("wr");
  });

  it("does not suggest another quarterback when the team got one later", () => {
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qb", "QB"), pick(3, 1, "qbLater", "QB"), pick(4, 2, "rb2", "RB")];
    const sim = simulateStrategy({ ...base, plan: { rb: "balanced", qb: "late", te: "late" }, picks });
    expect(sim?.[0]?.chosen.playerId).toBe("wr");
  });
});

describe("simulateStrategy timing", () => {
  const slots = ["QB", "RB", "WR", "TE", "FLEX"];
  const values = board([["wr", 800], ["qb", 700], ["rb", 500]]);
  const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qb", "QB")];
  const sim = (qb: "early" | "late") => simulateStrategy({ plan: { rb: "balanced", qb, te: "late" }, picks, rosterId: 1, values, teams: 2, slots })?.[0]?.chosen.playerId;

  it("keeps a quarterback out of the early rounds when late, and favors one when early", () => {
    expect(sim("late")).toBe("wr");
    expect(sim("early")).toBe("qb");
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
    expect(view?.yours.rb).toBe("robust-rb");
    expect(view?.bestPicks.get("bust")?.playerId).toBe("wr1");
  });

  it("scores a replay worse than the actual roster as the actual roster, so it cannot crown another plan", () => {
    const values = board([["wr", 100], ["qbOpp", 90], ["qb", 99], ["wrOpp", 95]]);
    const picks = [pick(1, 1, "wr", "WR"), pick(2, 2, "qbOpp", "QB"), pick(11, 1, "qb", "QB"), pick(12, 2, "wrOpp", "WR")];
    const view = strategyView({ picks, rosterId: 1, values, teams: 10, slots: ["QB", "WR", "SUPER_FLEX"] });
    expect(view?.best).toEqual(view?.yours);
  });

  it("is null without picks or values", () => {
    expect(strategyView({ picks: [], rosterId: 1, values: board([["a", 1]]), teams: 2 })).toBeNull();
  });
});
