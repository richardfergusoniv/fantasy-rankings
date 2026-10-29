import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "./dashboard-schemas.js";

vi.mock("./dashboard-build.js", () => ({ readUserDashboardCache: vi.fn() }));
vi.mock("./auth.js", () => ({ resolveSleeperUserId: vi.fn() }));
vi.mock("./viewer-league-access.js", () => ({ viewerBelongsToLeague: vi.fn() }));

import { buildLeagueOutcomes, rewindWeek, type FetchWeek } from "./league-outcomes.js";

const row = (rosterId: number, teamName: string, wins: number, losses: number, pointsFor: number, isUser = false) => ({
  rosterId, teamName, isUser, rank: rosterId, wins, losses, ties: 0, pointsFor, pointsAgainst: 0, playoffSeed: null, gamesOutOfPlayoffs: null,
});

const league = {
  id: "lg",
  standings: [row(1, "A", 4, 1, 600, true), row(2, "B", 3, 2, 560), row(3, "C", 2, 3, 520), row(4, "D", 1, 4, 480)],
  playoffs: { teams: 2, weekStart: 8, positionKnown: true },
} as unknown as Dashboard["leagues"][number];

// Week 5 (just played): A beat D 120-90, B beat C 100-95. Weeks 6-7: A-B, C-D.
const fetchWeek: FetchWeek = async (_id, week) =>
  week === 5
    ? [{ roster_id: 1, matchup_id: 1, points: 120 }, { roster_id: 4, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 2, points: 100 }, { roster_id: 3, matchup_id: 2, points: 95 }]
    : [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }, { roster_id: 3, matchup_id: 2 }, { roster_id: 4, matchup_id: 2 }];

describe("rewindWeek", () => {
  it("takes back the last week's results and points", () => {
    const teams = league.standings.map((r) => ({ rosterId: r.rosterId, teamName: r.teamName, isUser: r.isUser, wins: r.wins, losses: r.losses, ties: 0, pointsFor: r.pointsFor }));
    const earlier = rewindWeek(teams, [{ week: 5, a: 1, b: 4 }], new Map([[1, 120], [4, 90]]))!;
    expect(earlier.find((t) => t.rosterId === 1)).toMatchObject({ wins: 3, pointsFor: 480 });
    expect(earlier.find((t) => t.rosterId === 4)).toMatchObject({ losses: 3, pointsFor: 390 });
  });

  it("returns null when there is nothing to undo", () => {
    expect(rewindWeek([], [], new Map())).toBeNull();
    expect(rewindWeek([], [{ week: 5, a: 1, b: 2 }], new Map([[1, 0], [2, 0]]))).toBeNull();
  });
});

describe("buildLeagueOutcomes", () => {
  it("reports current and previous-week odds for playoffs and last place", async () => {
    const result = await buildLeagueOutcomes(league, fetchWeek);
    if ("error" in result) throw new Error(result.error);
    expect(result.throughWeek).toBe(5);
    expect(result.previousWeek).toBe(4);
    expect(result.regularSeasonEndsWeek).toBe(7);
    expect(result.teams).toHaveLength(4);
    const sum = (key: "playoffPct" | "lastPct") => result.teams.reduce((acc, t) => acc + t[key], 0);
    expect(Math.round(sum("playoffPct"))).toBe(200);
    expect(Math.round(sum("lastPct"))).toBe(100);
    const a = result.teams.find((t) => t.teamName === "A")!;
    const d = result.teams.find((t) => t.teamName === "D")!;
    expect(a.previousPlayoffPct).not.toBeNull();
    expect(a.playoffPct).toBeGreaterThan(d.playoffPct);
    expect(d.lastPct).toBeGreaterThan(a.lastPct);
  });

  it("errors without playoff settings", async () => {
    const bare = { ...league, playoffs: { teams: null, weekStart: null } } as unknown as Dashboard["leagues"][number];
    expect(await buildLeagueOutcomes(bare, fetchWeek)).toHaveProperty("error");
  });
});
