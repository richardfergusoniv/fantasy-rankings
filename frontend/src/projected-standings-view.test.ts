import { describe, expect, it } from "vitest";
import { nextGamesForTeam, ordinal, placesMoved, recordLabel } from "./projected-standings-view";

describe("recordLabel", () => {
  it("shows ties only when there are some", () => {
    expect(recordLabel({ wins: 9, losses: 5, ties: 0 })).toBe("9-5");
    expect(recordLabel({ wins: 8, losses: 5, ties: 1 })).toBe("8-5-1");
  });
});

describe("projected standings helpers", () => {
  it("writes ordinals, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  it("counts places gained from today's table", () => {
    expect(placesMoved(5, 3)).toBe(2);
    expect(placesMoved(2, 4)).toBe(-2);
    expect(placesMoved(6, 6)).toBe(0);
  });

  it("lists a team's next games in week order from either side of the pairing", () => {
    const games = [
      { week: 10, rosterIdA: 3, rosterIdB: 1, projectedA: 90, projectedB: 110 },
      { week: 9, rosterIdA: 1, rosterIdB: 2, projectedA: 120, projectedB: 100 },
      { week: 9, rosterIdA: 4, rosterIdB: 5, projectedA: 100, projectedB: 100 },
    ];
    const next = nextGamesForTeam(games, 1, 3);
    expect(next.map((game) => [game.week, game.opponentRosterId, game.mine, game.theirs])).toEqual([[9, 2, 120, 100], [10, 3, 110, 90]]);
    expect(next[0]).toMatchObject({ result: "W", margin: 20 });
    expect(nextGamesForTeam(games, 2)[0]).toMatchObject({ result: "L", margin: -20 });
    expect(nextGamesForTeam(games, 4)[0]).toMatchObject({ result: "T", margin: 0 });
    expect(nextGamesForTeam(games, 1, 1)).toHaveLength(1);
  });
});
