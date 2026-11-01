import { describe, expect, it } from "vitest";
import { upcomingSchedule } from "./upcoming-schedule";

const games = [
  { week: 8, home: "DAL", away: "ARI" },
  { week: 9, home: "PHI", away: "DAL" },
  { week: 9, home: "ARI", away: "SEA" },
  { week: 11, home: "DAL", away: "LV" },
  { week: 7, home: "DAL", away: "WAS" },
];

describe("upcomingSchedule", () => {
  it("lists each team's next weeks with home and away, and a bye as no opponent", () => {
    const out = upcomingSchedule(games, 8, 4, (team) => team);
    expect(out.DAL).toEqual([
      { week: 8, opponent: "ARI", isAway: false },
      { week: 9, opponent: "PHI", isAway: true },
      { week: 10, opponent: null, isAway: false },
      { week: 11, opponent: "LV", isAway: false },
    ]);
    expect(out.ARI!.map((game) => game.opponent)).toEqual(["DAL", "SEA", null, null]);
  });

  it("stops at the last regular-season week", () => {
    expect(upcomingSchedule(games, 17, 4, (team) => team).DAL!.map((game) => game.week)).toEqual([17, 18]);
  });
});
