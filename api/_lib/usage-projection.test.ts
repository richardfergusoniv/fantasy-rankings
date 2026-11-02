import { describe, expect, it } from "vitest";
import type { PlayerOpportunity } from "./player-insights.js";
import { opportunityBySleeperId, usageProjectionFor } from "./usage-projection.js";

function opportunity(componentWeeks: PlayerOpportunity["componentWeeks"]): PlayerOpportunity {
  return {
    games: componentWeeks.length,
    expected: 0,
    actual: 0,
    weeks: componentWeeks.map((row) => [row.week, 0, 0] as [number, number, number]),
    componentWeeks,
  };
}

const weeksOf = (stats: Record<string, number>, count: number) =>
  Array.from({ length: count }, (_, index) => ({ week: index + 1, stats }));

describe("usageProjectionFor", () => {
  it("scores the components under the league's own settings", () => {
    const opp = opportunity(weeksOf({ rec: 6, rec_yd: 80, rec_td: 0.5 }, 4));
    // PPR: 6 + 8 + 3 = 17 per week.
    expect(usageProjectionFor(opp, "WR", { rec: 1, rec_yd: 0.1, rec_td: 6 }))
      .toEqual({ usageProjection: 17, usageGames: 4 });
    // Half PPR: 3 + 8 + 3 = 14.
    expect(usageProjectionFor(opp, "WR", { rec: 0.5, rec_yd: 0.1, rec_td: 6 }))
      .toEqual({ usageProjection: 14, usageGames: 4 });
  });

  it("counts first downs and TE premium from the components", () => {
    const opp = opportunity(weeksOf({ rec: 6, rec_yd: 60, rec_fd: 4 }, 3));
    const settings = { rec: 1, rec_yd: 0.1, rec_fd: 1, bonus_rec_te: 0.5 };
    // WR: 6 + 6 + 4 = 16. TE adds 6 x 0.5 premium = 19.
    expect(usageProjectionFor(opp, "WR", settings)?.usageProjection).toBe(16);
    expect(usageProjectionFor(opp, "TE", settings)?.usageProjection).toBe(19);
  });

  it("averages the season rate with the last-3 rate", () => {
    const opp = opportunity([
      { week: 1, stats: { rush_yd: 100 } },
      { week: 2, stats: { rush_yd: 100 } },
      { week: 3, stats: { rush_yd: 100 } },
      { week: 4, stats: { rush_yd: 200 } },
      { week: 5, stats: { rush_yd: 200 } },
    ]);
    // Season rate 14, last-3 rate 16.67, blend 15.33.
    expect(usageProjectionFor(opp, "RB", { rush_yd: 0.1 }))
      .toEqual({ usageProjection: 15.33, usageGames: 5 });
  });

  it("returns null without component history, and still reports a single game", () => {
    expect(usageProjectionFor(null, "WR", { rec: 1 })).toBeNull();
    expect(usageProjectionFor(opportunity([]), "WR", { rec: 1 })).toBeNull();
    expect(usageProjectionFor(opportunity(weeksOf({ rec: 5 }, 1)), "WR", { rec: 1 }))
      .toEqual({ usageProjection: 5, usageGames: 1 });
  });
});

describe("opportunityBySleeperId", () => {
  it("bridges gsis-keyed opportunity rows to Sleeper ids", () => {
    const opp = opportunity(weeksOf({ rec: 5 }, 2));
    const byId = opportunityBySleeperId({ "00-1": opp }, { "00-1": "sleeper-1", "00-2": "sleeper-2" });
    expect(byId.get("sleeper-1")).toBe(opp);
    expect(byId.has("sleeper-2")).toBe(false);
    expect(opportunityBySleeperId(undefined, undefined).size).toBe(0);
  });
});
