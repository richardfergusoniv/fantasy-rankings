import { describe, expect, it } from "vitest";
import { sortPropLines } from "./prop-line-order";

const lines = (...stats: string[]) => stats.map((stat) => ({ stat }));
const order = (result: Array<{ stat: string }>) => result.map((line) => line.stat);

describe("sortPropLines", () => {
  it("leads with the position's main stat", () => {
    expect(order(sortPropLines(lines("longest_reception", "receptions", "rec_yards"), "WR"))).toEqual(["rec_yards", "receptions", "longest_reception"]);
    expect(order(sortPropLines(lines("rec_yards", "rush_yards"), "RB"))).toEqual(["rush_yards", "rec_yards"]);
  });

  it("keeps unlisted stats after, in their incoming order", () => {
    expect(order(sortPropLines(lines("sacks", "pass_yards", "pass_tds", "rush_attempts"), "QB"))).toEqual(["pass_yards", "pass_tds", "sacks", "rush_attempts"]);
  });

  it("leaves an unknown position as it came", () => {
    expect(order(sortPropLines(lines("b", "a"), "XX"))).toEqual(["b", "a"]);
  });
});
