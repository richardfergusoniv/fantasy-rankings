import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

// chat-tools must load first: chat-tools and chat-tools-extended import each other.
import "./chat-tools.js";
import { loadUpcomingOutlook } from "./chat-tools-extended.js";
import type { WeekProjections } from "./sleeper-week-projections.js";

const league = {
  scoringSettings: { rec: 1, rec_yd: 0.1 },
  rankingField: "ppr",
  playoffs: { teams: 6, weekStart: 12, positionKnown: true },
} as unknown as Dashboard["leagues"][number];

const week = (w: number, entries: Record<string, Record<string, number>>): WeekProjections => ({
  season: 2026, week: w, asOf: "2026-10-29T00:00:00.000Z",
  players: new Map(Object.entries(entries).map(([id, stats]) => [id, { opponent: "LV", stats }])),
});

describe("loadUpcomingOutlook", () => {
  const players = [
    { playerId: "p1", position: "WR", thisWeek: 12.34 },
    { playerId: "p2", position: "RB", thisWeek: null },
  ];

  it("uses the app projection this week and Sleeper's later weeks in league scoring", async () => {
    const loader = vi.fn(async (_s: number, w: number) => week(w, w === 10 ? {} : { p1: { rec: 5, rec_yd: 60 } }));
    const outlook = await loadUpcomingOutlook(2026, 8, league, players, loader);
    expect(loader.mock.calls.map((c) => c[1])).toEqual([9, 10, 11]);
    expect(outlook.lastWeek).toBe(11);
    const p1 = outlook.byPlayer.get("p1")!;
    expect(p1.weeks.map((r) => r.week)).toEqual([8, 9, 10, 11]);
    expect(p1.weeks[0]).toMatchObject({ projected: 12.3, source: "app" });
    expect(p1.weeks[1]).toMatchObject({ projected: 11, source: "sleeper", opponent: "LV" });
    // No Sleeper row in week 10 means bye or out: zero.
    expect(p1.weeks[2]!.projected).toBe(0);
    expect(p1.total).toBe(12.3 + 11 + 0 + 11);
    expect(outlook.byPlayer.get("p2")!.weeks[0]!.projected).toBeNull();
  });

  it("lists weeks Sleeper could not supply and omits them from the totals", async () => {
    const outlook = await loadUpcomingOutlook(2026, 8, league, players, async (_s, w) => {
      if (w === 10) throw new Error("down");
      return week(w, { p1: { rec: 5, rec_yd: 60 } });
    });
    expect(outlook.missingWeeks).toEqual([10]);
    expect(outlook.byPlayer.get("p1")!.weeks.map((r) => r.week)).toEqual([8, 9, 11]);
  });

  it("returns nothing once the regular season is over", async () => {
    const loader = vi.fn();
    const outlook = await loadUpcomingOutlook(2026, 14, league, players, loader);
    expect(loader).not.toHaveBeenCalled();
    expect(outlook.firstWeek).toBeNull();
    expect(outlook.byPlayer.get("p1")!.weeks).toEqual([]);
  });
});
