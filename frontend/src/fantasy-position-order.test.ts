import { describe, expect, it } from "vitest";
import {
  compareByFantasyPosition,
  fantasyPositionSortIndex,
  sortPlayersByFantasyPosition,
} from "./fantasy-position-order";

describe("fantasy position order", () => {
  it("orders QB, RB, WR, TE, K, DEF like starters", () => {
    expect(["DEF", "WR", "QB", "K", "TE", "RB"].sort(compareByFantasyPosition)).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "K",
      "DEF",
    ]);
    expect(fantasyPositionSortIndex("QB")).toBeLessThan(fantasyPositionSortIndex("RB"));
    expect(fantasyPositionSortIndex("PICK")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("keeps a secondary sort within the same position", () => {
    const sorted = sortPlayersByFantasyPosition(
      [
        { position: "WR", name: "B" },
        { position: "QB", name: "Z" },
        { position: "WR", name: "A" },
        { position: "RB", name: "C" },
      ],
      (left, right) => left.name.localeCompare(right.name),
    );
    expect(sorted.map((player) => `${player.position}:${player.name}`)).toEqual([
      "QB:Z",
      "RB:C",
      "WR:A",
      "WR:B",
    ]);
  });
});
