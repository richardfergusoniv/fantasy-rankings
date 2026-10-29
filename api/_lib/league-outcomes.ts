/**
 * League Outcomes: each team's chance to make the playoffs and to finish
 * last, now and as of the previous week. The previous week is rebuilt by
 * undoing the last completed week's results, so nothing needs storing.
 */
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import type { Dashboard } from "./dashboard-schemas.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import { simulatePlayoffOdds, type OddsGame, type OddsTeam, type PlayoffOdds } from "./playoff-odds.js";
import { fetchJson, SLEEPER_BASE } from "./sleeper.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

type League = Dashboard["leagues"][number];
export type SleeperMatchupRow = { roster_id: number; matchup_id?: number | null; points?: number };
export type FetchWeek = (leagueId: string, week: number) => Promise<SleeperMatchupRow[]>;

const defaultFetchWeek: FetchWeek = (leagueId, week) =>
  fetchJson<SleeperMatchupRow[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`);

export const OUTCOME_TRIALS = 20_000;
const DEFAULT_LAST_REGULAR_WEEK = 14;

/** Head-to-head pairs for each week; weeks that fail to load are reported, not guessed. */
export async function loadScheduleGames(
  leagueId: string,
  weeks: readonly number[],
  fetchWeek: FetchWeek = defaultFetchWeek,
): Promise<{ games: OddsGame[]; pointsByWeek: Map<number, Map<number, number>>; missingWeeks: number[] }> {
  const results = await Promise.allSettled(weeks.map((week) => fetchWeek(leagueId, week)));
  const games: OddsGame[] = [];
  const pointsByWeek = new Map<number, Map<number, number>>();
  const missingWeeks: number[] = [];
  results.forEach((result, i) => {
    const week = weeks[i]!;
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
      missingWeeks.push(week);
      return;
    }
    const byMatchup = new Map<number, number[]>();
    const points = new Map<number, number>();
    for (const row of result.value) {
      points.set(row.roster_id, row.points ?? 0);
      if (row.matchup_id == null) continue;
      byMatchup.set(row.matchup_id, [...(byMatchup.get(row.matchup_id) ?? []), row.roster_id]);
    }
    pointsByWeek.set(week, points);
    for (const pair of byMatchup.values()) {
      if (pair.length === 2) games.push({ week, a: pair[0]!, b: pair[1]! });
    }
  });
  return { games, pointsByWeek, missingWeeks };
}

type Standing = League["standings"][number];

function toOddsTeam(row: Standing): OddsTeam {
  return {
    rosterId: row.rosterId,
    teamName: row.teamName,
    isUser: row.isUser,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pointsFor: row.pointsFor,
  };
}

/** Undo one finished week: take back each team's result and points. */
export function rewindWeek(
  teams: readonly OddsTeam[],
  games: readonly OddsGame[],
  points: ReadonlyMap<number, number>,
): OddsTeam[] | null {
  if (games.length === 0 || [...points.values()].every((value) => value === 0)) return null;
  const next = new Map(teams.map((team) => [team.rosterId, { ...team }]));
  for (const game of games) {
    const a = next.get(game.a);
    const b = next.get(game.b);
    if (!a || !b) continue;
    const pa = points.get(game.a) ?? 0;
    const pb = points.get(game.b) ?? 0;
    a.pointsFor = Math.max(0, a.pointsFor - pa);
    b.pointsFor = Math.max(0, b.pointsFor - pb);
    if (pa === pb) {
      a.ties = Math.max(0, a.ties - 1);
      b.ties = Math.max(0, b.ties - 1);
    } else {
      const [winner, loser] = pa > pb ? [a, b] : [b, a];
      winner.wins = Math.max(0, winner.wins - 1);
      loser.losses = Math.max(0, loser.losses - 1);
    }
  }
  return [...next.values()];
}

const record = (team: Pick<OddsTeam, "wins" | "losses" | "ties">) =>
  `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`;

export type OutcomeTeam = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
  record: string;
  playoffPct: number;
  lastPct: number;
  previousPlayoffPct: number | null;
  previousLastPct: number | null;
};

export type LeagueOutcomes = {
  leagueId: string;
  /** Completed regular-season weeks counted in the standings. */
  throughWeek: number;
  /** Week the comparison column is "after"; null when there is no earlier week. */
  previousWeek: number | null;
  playoffTeams: number;
  regularSeasonEndsWeek: number;
  trials: number;
  divisionsIgnored: boolean;
  missingWeeks: number[];
  teams: OutcomeTeam[];
};

export async function buildLeagueOutcomes(
  league: League,
  fetchWeek: FetchWeek = defaultFetchWeek,
): Promise<LeagueOutcomes | { error: string }> {
  const standings = league.standings ?? [];
  const playoffTeams = league.playoffs?.teams ?? null;
  if (standings.length < 2 || !playoffTeams) {
    return { error: "Standings or playoff settings are not available for this league." };
  }
  const lastRegularWeek = league.playoffs.weekStart ? league.playoffs.weekStart - 1 : DEFAULT_LAST_REGULAR_WEEK;
  const throughWeek = Math.max(...standings.map((row) => row.wins + row.losses + row.ties));
  const remainingWeeks = Array.from(
    { length: Math.max(0, lastRegularWeek - throughWeek) },
    (_, i) => throughWeek + 1 + i,
  );
  const weeks = throughWeek > 0 ? [throughWeek, ...remainingWeeks] : remainingWeeks;
  const { games, pointsByWeek, missingWeeks } = await loadScheduleGames(league.id, weeks, fetchWeek);
  const remainingGames = games.filter((game) => game.week > throughWeek);
  if (remainingWeeks.length > 0 && remainingGames.length === 0) {
    return { error: "The remaining schedule could not be loaded from Sleeper." };
  }

  const teams = standings.map(toOddsTeam);
  const now = simulatePlayoffOdds({ teams, games: remainingGames, playoffTeams, trials: OUTCOME_TRIALS });
  const lastWeekGames = games.filter((game) => game.week === throughWeek);
  const earlier = rewindWeek(teams, lastWeekGames, pointsByWeek.get(throughWeek) ?? new Map());
  const before: PlayoffOdds | null = earlier
    ? simulatePlayoffOdds({ teams: earlier, games: [...lastWeekGames, ...remainingGames], playoffTeams, trials: OUTCOME_TRIALS })
    : null;
  const prior = new Map(before?.teams.map((team) => [team.rosterId, team]));
  const recordById = new Map(teams.map((team) => [team.rosterId, record(team)]));

  return {
    leagueId: league.id,
    throughWeek,
    previousWeek: before ? throughWeek - 1 : null,
    playoffTeams,
    regularSeasonEndsWeek: lastRegularWeek,
    trials: OUTCOME_TRIALS,
    divisionsIgnored: league.playoffs.positionKnown === false,
    missingWeeks,
    teams: now.teams.map((team) => ({
      rosterId: team.rosterId,
      teamName: team.teamName,
      isUser: team.isUser,
      record: recordById.get(team.rosterId) ?? team.record,
      playoffPct: team.playoffPct,
      lastPct: team.lastPct,
      previousPlayoffPct: prior.get(team.rosterId)?.playoffPct ?? null,
      previousLastPct: prior.get(team.rosterId)?.lastPct ?? null,
    })),
  };
}

const querySchema = z.object({ leagueId: z.string().min(1) });

/** GET /api/data/league-outcomes?leagueId= */
export async function handleLeagueOutcomes(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({ leagueId: url.searchParams.get("leagueId") ?? "" });
    if (!parsed.success) return badRequest("Invalid query params.", parsed.error.issues);

    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");
    if (!(await viewerBelongsToLeague(sleeperUserId, parsed.data.leagueId))) {
      return forbidden("League is not in your Sleeper account.");
    }
    const cached = await readUserDashboardCache(sleeperUserId);
    const league = cached?.dashboard.leagues.find((item) => item.id === parsed.data.leagueId);
    if (!league) return json({ ok: false, error: "League data is still loading. Try again shortly." }, 409);

    const result = await buildLeagueOutcomes(league);
    if ("error" in result) return json({ ok: false, error: result.error }, 422);
    return json(result);
  } catch (err) {
    return internalError(err);
  }
}
