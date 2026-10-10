import { describe, expect, it } from "vitest";
import { blendedContenderRanks, pickTierForRank, type PickStanding } from "./pick-tier.js";

function team(rosterId: number, wins: number, losses: number, valueRank: number, ties = 0): PickStanding {
  return { rosterId, wins, losses, ties, valueRank };
}

describe("blendedContenderRanks", () => {
  it("uses redraft roster value until someone has played", () => {
    const ranks = blendedContenderRanks([
      team(1, 0, 0, 2),
      team(2, 0, 0, 1),
    ]);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(1)).toBe(2);
  });

  it("ranks on the average of record rank and value rank", () => {
    const standings = [
      team(1, 5, 0, 6),
      team(2, 4, 1, 5),
      team(3, 3, 2, 1),
      team(4, 2, 3, 2),
      team(5, 1, 4, 3),
      team(6, 0, 5, 4),
    ];
    const ranks = blendedContenderRanks(standings);
    expect([...ranks.entries()].sort((left, right) => left[1] - right[1]).map(([rosterId]) => rosterId)).toEqual([3, 4, 1, 2, 5, 6]);
    expect(pickTierForRank(ranks.get(3), standings.length)).toBe("late");
    expect(pickTierForRank(ranks.get(1), standings.length)).toBe("mid");
    expect(pickTierForRank(ranks.get(6), standings.length)).toBe("early");
  });

  it("puts a team that has not played behind teams that have", () => {
    const ranks = blendedContenderRanks([
      team(1, 1, 0, 2),
      team(2, 0, 0, 1),
    ]);
    expect(ranks.get(1)).toBe(1);
    expect(ranks.get(2)).toBe(2);
  });
});
