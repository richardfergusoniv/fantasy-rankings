import { describe, expect, it } from "vitest";
import { pairBySlot } from "./next-game-card";

const slot = (s: string, id: string | null) => ({ slot: s, playerId: id, name: id, points: 1 });

describe("pairBySlot", () => {
  it("pairs the league's slots in order", () => {
    const pairs = pairBySlot([slot("QB", "a"), slot("WR", "b")], [slot("QB", "c"), slot("WR", "d")]);
    expect(pairs.map(([m, t]) => [m?.playerId, t?.playerId])).toEqual([["a", "c"], ["b", "d"]]);
  });

  it("keeps appended off-list slots from pairing with an unrelated slot", () => {
    const pairs = pairBySlot([slot("QB", "a"), slot("IDP", "x")], [slot("QB", "c"), slot("K", "y")]);
    expect(pairs.map(([m, t]) => [m?.slot ?? null, t?.slot ?? null])).toEqual([["QB", "QB"], ["IDP", null], [null, "K"]]);
  });
});
