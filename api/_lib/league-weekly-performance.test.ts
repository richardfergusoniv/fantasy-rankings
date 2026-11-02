import { describe, expect, it, vi } from "vitest";
import type { WeekProjections } from "./sleeper-week-projections.js";
import type { Dashboard } from "./dashboard-schemas.js";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));
vi.mock("./dashboard-build.js", () => ({ readUserDashboardCache: vi.fn() }));
vi.mock("./auth.js", () => ({ resolveSleeperUserId: vi.fn() }));
vi.mock("./viewer-league-access.js", () => ({ viewerBelongsToLeague: vi.fn() }));

import { allPlayResults, handleLeagueWeeklyPerformance, loadLeagueWeeklyPerformance } from "./league-weekly-performance.js";
import { buildProjectedStandings } from "./projected-standings.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import { resolveSleeperUserId } from "./auth.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

type League = Dashboard["leagues"][number];
const player = (id: string, projection: number) => ({ playerId: id, position: "QB", lineupSlot: "QB", isStarter: true, projection, actual: null, gamePhase: "pregame", gameTime: null, isBye: false, injuryStatus: null });
const league = {
  id: "league", rankingField: "ppr", standings: [1, 2, 3].map((rosterId) => ({ rosterId, teamName: `Team ${rosterId}`, pointsFor: 100, wins: 1, losses: 0, ties: 0 })),
  playoffs: { weekStart: 4 }, tradeStarterSlots: ["QB"], starters: [],
  tradeTeams: [1, 2, 3].map((rosterId) => ({ rosterId, players: [player(String(rosterId), 10 + rosterId)] })),
} as unknown as League;
const options = {
  fetchLeague: async () => ({ settings: { league_average_match: 0 } }),
  fetchWeek: async () => [{ roster_id: 1, points: 100 }, { roster_id: 2, points: 120 }, { roster_id: 3, points: 100, matchup_id: null }],
  loadProjections: async (season: number, week: number) => ({ season, week, asOf: "2026-11-01T12:00:00Z", players: new Map([1, 2, 3].map((id) => [String(id), { opponent: "BUF", stats: { pts_ppr: 30 - id } }])) }),
};

describe("weekly all-play", () => {
  it("counts every opponent, treats hundredth-point ties equally, and uses competition ranks", () => {
    expect(allPlayResults([{ rosterId: 1, points: 0.1 + 0.2 }, { rosterId: 2, points: .3 }, { rosterId: 3, points: -2 }])).toEqual([
      { rosterId: 1, points: .3, rank: 1, wins: 1, losses: 0, ties: 1 },
      { rosterId: 2, points: .3, rank: 1, wins: 1, losses: 0, ties: 1 },
      { rosterId: 3, points: -2, rank: 3, wins: 0, losses: 2, ties: 0 },
    ]);
  });
  it("separates actuals, current lineups, and future provider projections, including a matchup bye", async () => {
    const result = await loadLeagueWeeklyPerformance(league, 2026, 2, "snapshot", options);
    expect(result.weeks.map((w) => [w.kind, w.source])).toEqual([["actual", "Sleeper scores"], ["projected", "Current lineup"], ["projected", "Sleeper projections"]]);
    expect(result.weeks[0]!.teams![0]).toMatchObject({ rank: 2, wins: 0, losses: 1, ties: 1 });
    expect(result.weeks[1]!.teams![0]).toMatchObject({ points: 11, rank: 3 });
    expect(result.weeks[2]!.teams![0]).toMatchObject({ points: 29, rank: 1, wins: 2 });
  });
  it("returns unavailable weeks within the source deadline instead of exceeding the function budget", async () => {
    vi.useFakeTimers();
    try {
      const fetchWeek = vi.fn(() => new Promise<never>(() => {}));
      const loadProjections = vi.fn(() => new Promise<never>(() => {}));
      const pending = loadLeagueWeeklyPerformance({ ...league, playoffs: { weekStart: 15, teams: 6 } }, 2026, 2, null, { ...options, fetchWeek, loadProjections });
      await vi.advanceTimersByTimeAsync(35_001);
      const result = await pending;
      expect(result.weeks).toHaveLength(14);
      expect(result.weeks[0]!.teams).toBeNull();
      expect(result.weeks[13]!.teams).toBeNull();
      expect(fetchWeek).toHaveBeenCalledTimes(1);
      expect(loadProjections).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("matches Projected standings for the same future Sleeper week and league scoring", async () => {
    const projections: WeekProjections = await options.loadProjections(2026, 3);
    const scoredLeague = { ...league, scoringSettings: { pass_yd: 0.04, pass_td: 6 } };
    projections.players.set("1", { opponent: "BUF", stats: { pass_yd: 299.3, pass_td: 2.3, pts_ppr: 99 } });
    const result = await loadLeagueWeeklyPerformance(scoredLeague, 2026, 2, null, { ...options, loadProjections: async () => projections });
    const standings = buildProjectedStandings({
      league: scoredLeague, weeks: new Map([[3, projections]]), games: [{ week: 3, a: 1, b: 2 }],
      throughWeek: 2, regularSeasonEndsWeek: 3, missingWeeks: [],
    });
    const game = standings.games[0]!;
    expect(game.projectedA).toBe(25.77);
    expect(result.weeks[2]!.teams!.find((team) => team.rosterId === 1)!.points).toBe(game.projectedA);
    expect(result.weeks[2]!.teams!.find((team) => team.rosterId === 2)!.points).toBe(game.projectedB);
  });
  it("honors commissioner score overrides and valid zero scores", async () => {
    const result = await loadLeagueWeeklyPerformance(league, 2026, 2, null, { ...options, fetchWeek: async () => [{ roster_id: 1, points: 100, custom_points: 0 }, { roster_id: 2, points: -1 }, { roster_id: 3, points: 50 }] });
    expect(result.weeks[0]!.teams![0]).toMatchObject({ points: 0, rank: 2, wins: 1, losses: 1 });
  });
  it.each([
    [{ roster_id: 1, points: 100 }, { roster_id: 2, points: 120 }],
    [{ roster_id: 1, points: 100 }, { roster_id: 2, points: 120 }, { roster_id: 3 }],
    [{ roster_id: 1, points: 100 }, { roster_id: 1, points: 100 }, { roster_id: 2, points: 120 }, { roster_id: 3, points: 0 }],
  ])("withholds an incomplete historical week without breaking upcoming weeks", async (...rows) => {
    const result = await loadLeagueWeeklyPerformance(league, 2026, 2, null, { ...options, fetchWeek: async () => rows });
    expect(result.weeks[0]!.teams).toBeNull();
    expect(result.weeks[2]!.teams).toHaveLength(3);
  });
  it("does not turn unavailable future projections into zero or average scores", async () => {
    const result = await loadLeagueWeeklyPerformance(league, 2026, 2, null, { ...options, loadProjections: async () => { throw new Error("offline"); } });
    expect(result.weeks[2]!.teams).toBeNull();
    expect(result.weeks[0]!.teams).toHaveLength(3);
  });
  it("does not score an unknown current starter as zero", async () => {
    const missing = structuredClone(league);
    missing.tradeTeams[0]!.players[0]!.projection = null;
    const result = await loadLeagueWeeklyPerformance(missing, 2026, 2, null, options);
    expect(result.weeks[1]!.teams).toBeNull();
    expect(result.weeks[2]!.teams).toHaveLength(3);
  });
  it("does not count median games as additional completed weeks", async () => {
    const medianLeague = { ...league, standings: league.standings.map((s) => ({ ...s, wins: 2 })) };
    const result = await loadLeagueWeeklyPerformance(medianLeague, 2026, 2, null, { ...options, fetchLeague: async () => ({ settings: { league_average_match: 1 } }) });
    expect(result.weeks.map((w) => w.kind)).toEqual(["actual", "projected", "projected"]);
  });
  it("starts late-starting leagues at their first scored week and stops before playoffs", async () => {
    const result = await loadLeagueWeeklyPerformance(league, 2026, 3, null, { ...options, fetchLeague: async () => ({ settings: { start_week: 2 } }) });
    expect(result.weeks.map((w) => [w.week, w.kind])).toEqual([[2, "actual"], [3, "projected"]]);
  });
  it("withholds projected comparison when an entire roster is missing", async () => {
    const result = await loadLeagueWeeklyPerformance({ ...league, tradeTeams: league.tradeTeams.slice(1) }, 2026, 2, null, options);
    expect(result.weeks[1]!.teams).toBeNull();
    expect(result.weeks[2]!.teams).toBeNull();
  });
});

describe("weekly performance authorization", () => {
  it("rejects anonymous requests before reading the dashboard", async () => {
    vi.mocked(resolveSleeperUserId).mockResolvedValue(null);
    vi.mocked(readUserDashboardCache).mockClear();
    const response = await handleLeagueWeeklyPerformance(new Request("https://example.test/api/data/league-weekly-performance?leagueId=league"));
    expect(response.status).toBe(401);
    expect(readUserDashboardCache).not.toHaveBeenCalled();
  });
  it("rejects a league outside the viewer's account", async () => {
    vi.mocked(resolveSleeperUserId).mockResolvedValue("viewer");
    vi.mocked(viewerBelongsToLeague).mockResolvedValue(false);
    vi.mocked(readUserDashboardCache).mockClear();
    const response = await handleLeagueWeeklyPerformance(new Request("https://example.test/api/data/league-weekly-performance?leagueId=other"));
    expect(response.status).toBe(403);
    expect(readUserDashboardCache).not.toHaveBeenCalled();
  });
});
