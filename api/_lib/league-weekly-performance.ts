import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import type { Dashboard } from "./dashboard-schemas.js";
import { isUnavailableStatus, liveForecastPoints } from "./lineup-optimizer.js";
import { DEFAULT_LAST_REGULAR_WEEK, defaultFetchWeek, type SleeperMatchupRow } from "./league-schedule.js";
import { bestLineup, currentWeekLineupTotal, sleeperWeekPoints } from "./projected-standings.js";
import { fetchJson, SLEEPER_BASE, withDeadline } from "./sleeper.js";
import { loadWeekProjections, type WeekProjections } from "./sleeper-week-projections.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

type League = Dashboard["leagues"][number];
export type WeeklyTeamResult = { rosterId: number; points: number; rank: number; wins: number; losses: number; ties: number };
export type LeaguePerformanceWeek = {
  week: number;
  kind: "actual" | "projected";
  source: "Sleeper scores" | "Current lineup" | "Sleeper projections";
  asOf: string | null;
  teams: WeeklyTeamResult[] | null;
};
export type LeagueWeeklyPerformance = { leagueId: string; season: number; teamCount: number; weeks: LeaguePerformanceWeek[] };

/** Compare rounded fantasy scores with every other roster, including teams on a matchup bye. */
export function allPlayResults(scores: readonly { rosterId: number; points: number }[]): WeeklyTeamResult[] {
  const rounded = scores.map((row) => ({ ...row, cents: Math.round(row.points * 100) }));
  return rounded.map((row) => {
    const others = rounded.filter((other) => other.rosterId !== row.rosterId);
    const wins = others.filter((other) => row.cents > other.cents).length;
    const losses = others.filter((other) => row.cents < other.cents).length;
    return { rosterId: row.rosterId, points: row.cents / 100, rank: losses + 1, wins, losses, ties: others.length - wins - losses };
  });
}

type Settings = { settings?: { league_average_match?: number; start_week?: number } };
type MatchupRow = SleeperMatchupRow;
type Options = {
  fetchLeague?: (leagueId: string) => Promise<Settings>;
  fetchWeek?: (leagueId: string, week: number) => Promise<MatchupRow[]>;
  loadProjections?: (season: number, week: number) => Promise<WeekProjections>;
};

export async function loadLeagueWeeklyPerformance(
  league: League, season: number, currentWeek: number, snapshotAsOf: string | null, options: Options = {},
): Promise<LeagueWeeklyPerformance> {
  // Leave room for auth/dashboard reads within the existing 60-second function budget.
  const deadlineAt = Date.now() + 35_000;
  const remainingMs = () => Math.max(1, deadlineAt - Date.now());
  const settings = await withDeadline((options.fetchLeague ?? ((id) => fetchJson<Settings>(`${SLEEPER_BASE}/league/${id}`)))(league.id), Math.min(10_000, remainingMs()));
  if (!settings?.settings) throw new Error("League settings are not available.");
  const start = Math.max(1, settings.settings.start_week ?? 1);
  const end = Math.min(18, league.playoffs?.weekStart ? league.playoffs.weekStart - 1 : DEFAULT_LAST_REGULAR_WEEK);
  const rosterIds = [...new Set((league.standings ?? []).map((team) => team.rosterId))];
  if (rosterIds.length < 2) throw new Error("League standings are not available.");
  // Median leagues record two results each week; a late-starting league's first result belongs to start_week.
  const resultsPerWeek = settings.settings.league_average_match === 1 ? 2 : 1;
  const completed = Math.floor(Math.max(...league.standings.map((row) => row.wins + row.losses + row.ties)) / resultsPerWeek);
  const throughWeek = Math.min(currentWeek, start - 1 + completed);
  const slots = league.tradeStarterSlots.length ? league.tradeStarterSlots : league.starters.map((p) => p.lineupSlot ?? p.position);
  const weeks: LeaguePerformanceWeek[] = [];
  const load = async (week: number): Promise<LeaguePerformanceWeek> => {
    const actual = week <= throughWeek;
    const row: LeaguePerformanceWeek = { week, kind: actual ? "actual" : "projected", source: actual ? "Sleeper scores" : week === currentWeek ? "Current lineup" : "Sleeper projections", asOf: null, teams: null };
    if (Date.now() >= deadlineAt) return row;
    try {
      let scores: { rosterId: number; points: number }[];
      if (actual) {
        const matchups = await withDeadline((options.fetchWeek ?? defaultFetchWeek)(league.id, week), remainingMs());
        scores = rosterIds.map((rosterId) => {
          const entries = matchups.filter((entry) => entry.roster_id === rosterId);
          if (entries.length !== 1) throw new Error("Incomplete week.");
          const points = entries[0]!.custom_points ?? entries[0]!.points;
          if (typeof points !== "number" || !Number.isFinite(points)) throw new Error("Missing score.");
          return { rosterId, points };
        });
        row.asOf = new Date().toISOString();
      } else {
        const projections = week === currentWeek ? null : await withDeadline((options.loadProjections ?? loadWeekProjections)(season, week), remainingMs());
        if (projections && projections.players.size === 0) throw new Error("Missing projections.");
        scores = rosterIds.map((rosterId) => {
          const roster = league.tradeTeams.find((team) => team.rosterId === rosterId);
          if (!roster || slots.length === 0) throw new Error("Missing roster.");
          if (!projections && roster.players.some((player) => player.isStarter && player.playerId !== "0"
            && !isUnavailableStatus(player.injuryStatus) && liveForecastPoints(player) === null)) {
            throw new Error("Missing current lineup points.");
          }
          const points = projections
            ? bestLineup(roster.players, slots, sleeperWeekPoints(projections, league)).total
            : currentWeekLineupTotal(roster.players, slots);
          if (!Number.isFinite(points)) throw new Error("Invalid projection.");
          return { rosterId, points };
        });
        row.asOf = projections?.asOf ?? snapshotAsOf;
      }
      row.teams = allPlayResults(scores);
    } catch {
      // A partial league changes both the record and rank. Withhold this week rather than count missing teams as zero.
    }
    return row;
  };
  // Keep source requests bounded. A single response serves every team card in this league.
  for (let week = start; week <= end; week += 4) {
    const batch = Array.from({ length: Math.min(4, end - week + 1) }, (_, i) => week + i);
    weeks.push(...await Promise.all(batch.map(load)));
  }
  return { leagueId: league.id, season, teamCount: rosterIds.length, weeks };
}

/** GET /api/data/league-weekly-performance?leagueId= */
export async function handleLeagueWeeklyPerformance(req: Request): Promise<Response> {
  try {
    const parsed = z.string().min(1).safeParse(new URL(req.url).searchParams.get("leagueId"));
    if (!parsed.success) return badRequest("Invalid league ID.");
    const viewer = await resolveSleeperUserId(req);
    if (!viewer) return unauthorized("Sign in required.");
    if (!(await viewerBelongsToLeague(viewer, parsed.data))) return forbidden("League is not in your Sleeper account.");
    const cached = await readUserDashboardCache(viewer);
    const league = cached?.dashboard.leagues.find((item) => item.id === parsed.data);
    if (!cached || !league) return json({ error: "League data is still loading." }, 409);
    return json(await loadLeagueWeeklyPerformance(league, cached.dashboard.season, cached.dashboard.week, cached.dashboard.asOf));
  } catch (error) {
    return internalError(error);
  }
}
