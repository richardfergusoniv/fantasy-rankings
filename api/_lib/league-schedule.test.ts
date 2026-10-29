import { describe, expect, it } from "vitest";
import { loadScheduleGames } from "./league-schedule.js";

describe("loadScheduleGames", () => {
  it("pairs rosters by matchup id and reports weeks that fail", async () => {
    const result = await loadScheduleGames("lg", [5, 6, 7], async (_id, week) => {
      if (week === 6) throw new Error("down");
      if (week === 7) return [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }, { roster_id: 3, matchup_id: null }, { roster_id: 4, matchup_id: 2 }];
      return [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }, { roster_id: 3, matchup_id: 2 }, { roster_id: 4, matchup_id: 2 }];
    });
    expect(result.missingWeeks).toEqual([6]);
    expect(result.games).toEqual([
      { week: 5, a: 1, b: 2 }, { week: 5, a: 3, b: 4 },
      { week: 7, a: 1, b: 2 },
    ]);
  });
});
