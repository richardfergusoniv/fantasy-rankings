import { describe, expect, it } from "vitest";
import { advantageRows, advantageScale, biggestGaps, formatGap, rankStartersBySlot, type StarterSlot } from "./matchup-advantage";

const side = (name: string, points: number | null) => ({ name, points });

describe("advantageRows", () => {
  it("subtracts theirs from yours per slot, to one decimal", () => {
    const rows = advantageRows([
      { slot: "QB", mine: side("Kyler Murray", 16.66), theirs: side("Joe Burrow", 21.54) },
      { slot: "WR", mine: side("CeeDee Lamb", 18.59), theirs: side("Omar Cooper Jr.", 8.36) },
    ]);
    expect(rows.map((row) => row.gap)).toEqual([-4.9, 10.2]);
  });

  it("treats an empty slot as zero but leaves a missing projection unknown", () => {
    const rows = advantageRows([
      { slot: "FLEX", mine: null, theirs: side("Blake Corum", 7.26) },
      { slot: "K", mine: side("Tyler Bass", null), theirs: side("Chase McLaughlin", 7.68) },
    ]);
    expect(rows.map((row) => row.gap)).toEqual([-7.3, null]);
  });
});

describe("advantageScale and biggestGaps", () => {
  const rows = advantageRows([
    { slot: "QB", mine: side("A", 16.66), theirs: side("B", 21.54) },
    { slot: "RB", mine: side("C", 9.09), theirs: side("D", 18.29) },
    { slot: "WR", mine: side("E", 18.59), theirs: side("F", 8.36) },
    { slot: "FLEX", mine: side("G", 7.3), theirs: side("H", 7.3) },
  ]);

  it("scales every bar to the widest gap", () => {
    expect(advantageScale(rows)).toBe(10.2);
    expect(advantageScale([])).toBe(1);
  });

  it("returns the widest gaps in either direction and skips ties", () => {
    expect(biggestGaps(rows, 2).map((row) => row.slot)).toEqual(["WR", "RB"]);
    expect(biggestGaps(rows, 9).map((row) => row.slot)).not.toContain("FLEX");
  });
});

describe("formatGap", () => {
  it("signs the number with a true minus", () => {
    expect(formatGap(5.3)).toBe("+5.3");
    expect(formatGap(-2.8)).toBe("−2.8");
    expect(formatGap(0)).toBe("0.0");
  });
});

type Guy = { name: string; points: number | null };
const guy = (name: string, points: number | null): Guy => ({ name, points });
const slot = (slotName: string, position: string | null, player: Guy | null): StarterSlot<Guy> => ({ slot: slotName, position, player });
const value = (player: Guy) => player.points;
const names = (rows: Array<{ slot: string; player: Guy | null }>) => rows.map((row) => `${row.slot}:${row.player?.name ?? "-"}`);

describe("rankStartersBySlot", () => {
  it("puts the best player at each position first and the worst last", () => {
    // Slots hold them in the wrong order on purpose.
    const ranked = rankStartersBySlot([
      slot("RB", "RB", guy("rb-low", 8)),
      slot("RB", "RB", guy("rb-high", 19)),
      slot("WR", "WR", guy("wr-high", 17)),
      slot("WR", "WR", guy("wr-low", 6)),
    ], value);
    expect(names(ranked)).toEqual(["RB:rb-high", "RB:rb-low", "WR:wr-high", "WR:wr-low"]);
  });

  it("lines two teams up best against best and worst against worst", () => {
    const mine = rankStartersBySlot([
      slot("RB", "RB", guy("my-rb2", 7)), slot("RB", "RB", guy("my-rb1", 21)),
      slot("WR", "WR", guy("my-wr1", 15)), slot("WR", "WR", guy("my-wr2", 4)),
    ], value);
    const theirs = rankStartersBySlot([
      slot("RB", "RB", guy("their-rb1", 18)), slot("RB", "RB", guy("their-rb2", 11)),
      slot("WR", "WR", guy("their-wr2", 9)), slot("WR", "WR", guy("their-wr1", 14)),
    ], value);
    expect(mine.map((row, index) => `${row.player?.name} v ${theirs[index]?.player?.name}`)).toEqual([
      "my-rb1 v their-rb1", "my-rb2 v their-rb2", "my-wr1 v their-wr1", "my-wr2 v their-wr2",
    ]);
  });

  it("gives FLEX the weakest of the players left over at its position", () => {
    // Three WRs: the FLEX holder (11) is better than the WR2 (6), so they swap.
    const ranked = rankStartersBySlot([
      slot("WR", "WR", guy("wr-a", 18)), slot("WR", "WR", guy("wr-b", 6)),
      slot("TE", "TE", guy("te", 3)), slot("FLEX", "WR", guy("wr-c", 11)),
    ], value);
    expect(names(ranked)).toEqual(["WR:wr-a", "WR:wr-c", "TE:te", "FLEX:wr-b"]);
  });

  it("keeps FLEX at its own position's leftover when another position is weaker", () => {
    // The TE (3) is the lowest score, but TE needs a TE, so FLEX stays the RB leftover.
    const ranked = rankStartersBySlot([
      slot("RB", "RB", guy("rb-a", 14)), slot("TE", "TE", guy("te", 3)), slot("FLEX", "RB", guy("rb-b", 9)),
    ], value);
    expect(names(ranked)).toEqual(["RB:rb-a", "TE:te", "FLEX:rb-b"]);
  });

  it("moves a player who has finished by what he scored", () => {
    // Projected 20, scored 4: he now sorts below the 12-point projection.
    const ranked = rankStartersBySlot([
      slot("RB", "RB", guy("finished-bust", 4)), slot("RB", "RB", guy("still-playing", 12)),
    ], value);
    expect(names(ranked)).toEqual(["RB:still-playing", "RB:finished-bust"]);
  });

  it("sorts a player with no value last and keeps ties in slot order", () => {
    const ranked = rankStartersBySlot([
      slot("WR", "WR", guy("no-line", null)), slot("WR", "WR", guy("first", 9)), slot("WR", "WR", guy("second", 9)),
    ], value);
    expect(names(ranked)).toEqual(["WR:first", "WR:second", "WR:no-line"]);
  });

  it("leaves an empty slot empty and handles K, DEF and a second flex", () => {
    const ranked = rankStartersBySlot([
      slot("QB", "QB", guy("qb", 20)),
      slot("RB", "RB", null),
      slot("FLEX", "WR", guy("flex-1", 10)), slot("FLEX", "WR", guy("flex-2", 12)),
      slot("K", "K", guy("kicker", 7)), slot("DEF", "DEF", guy("defense", 9)),
    ], value);
    expect(names(ranked)).toEqual(["QB:qb", "RB:-", "FLEX:flex-2", "FLEX:flex-1", "K:kicker", "DEF:defense"]);
  });

  it("does not mutate its input", () => {
    const input = [slot("RB", "RB", guy("low", 1)), slot("RB", "RB", guy("high", 9))];
    rankStartersBySlot(input, value);
    expect(input.map((row) => row.player?.name)).toEqual(["low", "high"]);
  });
});
