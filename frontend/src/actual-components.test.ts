import { describe, expect, it } from "vitest";
import { actualComponentsForGame } from "./actual-components";

describe("actualComponentsForGame", () => {
  it("orders a QB box-score line with zero fill for unrecorded stats", () => {
    const components = actualComponentsForGame("QB", { passCmp: 24, passAtt: 35, passYds: 301, passTd: 3, interceptions: 1, rushYds: 18 });
    expect(components.map((c) => c.key)).toEqual([
      "passCmp", "passAtt", "passYds", "passTd", "interceptions", "rushAtt", "rushYds", "rushTd",
    ]);
    expect(components.find((c) => c.key === "passYds")).toMatchObject({ value: 301, isYards: true });
    expect(components.find((c) => c.key === "rushAtt")).toMatchObject({ value: 0 });
  });

  it("orders a WR line receiving-first", () => {
    const components = actualComponentsForGame("WR", { targets: 9, receptions: 7, recYds: 112, recTd: 1 });
    expect(components.map((c) => c.key)).toEqual([
      "targets", "receptions", "recYds", "recTd", "rushAtt", "rushYds", "rushTd",
    ]);
    expect(components[2]).toMatchObject({ key: "recYds", value: 112, isYards: true });
  });

  it("returns no components for positions without a game-log field set", () => {
    expect(actualComponentsForGame("K", { xpm: 2 })).toEqual([]);
    expect(actualComponentsForGame("DEF", {})).toEqual([]);
  });
});
