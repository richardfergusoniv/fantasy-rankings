/**
 * Projected standings: each team's best lineup from its current roster for
 * every remaining week, using Sleeper's per-week projections rescored in the
 * league's rules. The higher projected score wins the matchup. No
 * simulation and no probabilities: third-party projections added up.
 *
 * Players currently out (Out/IR/suspended) are left out of every remaining
 * week, since no injury timeline exists. Players on bye have no projection.
 */
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import type { Dashboard } from "./dashboard-schemas.js";
import { scoreSleeperPlayerProjection } from "./player-projection-merge.js";
import { isUnavailableStatus, optimizeTradeRoster, type OptimizablePlayer } from "./lineup-optimizer.js";
import { DEFAULT_LAST_REGULAR_WEEK, loadScheduleGames } from "./outcomes-engine-pace.js";
import type { FetchWeek } from "./league-outcomes-contract.js";
import { loadWeekProjections, type WeekProjections } from "./sleeper-week-projections.js";
import { viewerBelongsToLeague } from "./viewer-league-access.js";

type League = Dashboard["leagues"][number];
type RosterPlayer = League["tradeTeams"][number]["players"][number];

export type ProjectedRecord = { wins: number; losses: number; ties: number };

export type ProjectedStandingsTeam = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
  /** 1-based place in the projected final table. */
  rank: number;
  /** Place in today's table. */
  currentRank: number;
  record: ProjectedRecord;
  projectedRecord: ProjectedRecord;
  pointsFor: number;
  projectedPointsFor: number;
  /** True when the team lands inside the playoff cut. */
  inPlayoffs: boolean;
};

export type ProjectedGame = {
  week: number;
  rosterIdA: number;
  rosterIdB: number;
  projectedA: number;
  projectedB: number;
};

export type ProjectedStandings = {
  leagueId: string;
  throughWeek: number;
  regularSeasonEndsWeek: number;
  playoffTeams: number;
  divisionsIgnored: boolean;
  /** Weeks whose projections failed to load; each team's average of the loaded weeks stands in. */
  missingWeeks: number[];
  /** Oldest projection pull used, ISO time. */
  projectionsAsOf: string | null;
  teams: ProjectedStandingsTeam[];
  games: ProjectedGame[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A player's projected points in this league's scoring; 0 on bye (no row) or when currently out. */
export function projectedPlayerPoints(
  player: Pick<RosterPlayer, "position" | "injuryStatus">,
  entry: { stats: Record<string, number> } | undefined,
  league: Pick<League, "scoringSettings" | "rankingField">,
): number {
  if (!entry || isUnavailableStatus(player.injuryStatus)) return 0;
  const fallback = league.rankingField === "halfPpr" ? entry.stats.pts_half_ppr : entry.stats.pts_ppr;
  if (player.position === "DEF") return fallback ?? 0;
  const scored = league.scoringSettings
    ? scoreSleeperPlayerProjection(player.position as "QB", entry.stats, league.scoringSettings)
    : null;
  return scored ?? fallback ?? 0;
}

/** Best projected lineup total for one roster in one week. */
export function bestLineupTotal(
  players: readonly RosterPlayer[],
  slots: readonly string[],
  week: WeekProjections,
  league: Pick<League, "scoringSettings" | "rankingField">,
): number {
  const optimizable: OptimizablePlayer[] = players
    .filter((player) => player.playerId !== "0")
    .map((player) => ({
      playerId: player.playerId,
      position: player.position,
      lineupSlot: null,
      isStarter: false,
      projection: projectedPlayerPoints(player, week.players.get(player.playerId), league),
      actual: null,
    }));
  return optimizeTradeRoster(optimizable, [...slots]).score;
}

export function buildProjectedStandings(args: {
  league: League;
  weeks: ReadonlyMap<number, WeekProjections>;
  games: ReadonlyArray<{ week: number; a: number; b: number }>;
  throughWeek: number;
  regularSeasonEndsWeek: number;
  missingWeeks: number[];
}): ProjectedStandings {
  const { league, weeks, games } = args;
  const slots = league.tradeStarterSlots.length > 0
    ? league.tradeStarterSlots
    : league.starters.map((player) => player.lineupSlot ?? player.position);
  const rosters = new Map(league.tradeTeams.map((team) => [team.rosterId, team.players]));

  const weekTotals = new Map<string, number>();
  for (const [week, projections] of weeks) {
    for (const [rosterId, players] of rosters) {
      weekTotals.set(`${week}:${rosterId}`, bestLineupTotal(players, slots, projections, league));
    }
  }
  const teamAverage = (rosterId: number) => {
    const totals = [...weeks.keys()].map((week) => weekTotals.get(`${week}:${rosterId}`) ?? 0);
    return totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0;
  };
  const projectedFor = (week: number, rosterId: number) => weekTotals.get(`${week}:${rosterId}`) ?? teamAverage(rosterId);

  const table = new Map(league.standings.map((row) => [row.rosterId, {
    row,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pf: row.pointsFor,
  }]));
  const projectedGames: ProjectedGame[] = [];
  for (const game of [...games].sort((x, y) => x.week - y.week)) {
    const a = table.get(game.a);
    const b = table.get(game.b);
    if (!a || !b) continue;
    const pa = projectedFor(game.week, game.a);
    const pb = projectedFor(game.week, game.b);
    a.pf += pa;
    b.pf += pb;
    if (round2(pa) === round2(pb)) {
      a.ties += 1;
      b.ties += 1;
    } else if (pa > pb) {
      a.wins += 1;
      b.losses += 1;
    } else {
      b.wins += 1;
      a.losses += 1;
    }
    projectedGames.push({ week: game.week, rosterIdA: game.a, rosterIdB: game.b, projectedA: round2(pa), projectedB: round2(pb) });
  }

  const winPct = (t: { wins: number; losses: number; ties: number }) => {
    const played = t.wins + t.losses + t.ties;
    return played === 0 ? 0 : (t.wins + t.ties / 2) / played;
  };
  const playoffTeams = league.playoffs?.teams ?? 0;
  const ordered = [...table.values()].sort((x, y) => winPct(y) - winPct(x) || y.pf - x.pf || x.row.teamName.localeCompare(y.row.teamName));
  const asOfs = [...weeks.values()].map((week) => week.asOf).sort();

  return {
    leagueId: league.id,
    throughWeek: args.throughWeek,
    regularSeasonEndsWeek: args.regularSeasonEndsWeek,
    playoffTeams,
    divisionsIgnored: league.playoffs?.positionKnown === false,
    missingWeeks: args.missingWeeks,
    projectionsAsOf: asOfs[0] ?? null,
    teams: ordered.map((t, index) => ({
      rosterId: t.row.rosterId,
      teamName: t.row.teamName,
      isUser: t.row.isUser,
      rank: index + 1,
      currentRank: t.row.rank,
      record: { wins: t.row.wins, losses: t.row.losses, ties: t.row.ties },
      projectedRecord: { wins: t.wins, losses: t.losses, ties: t.ties },
      pointsFor: round2(t.row.pointsFor),
      projectedPointsFor: round2(t.pf),
      inPlayoffs: playoffTeams > 0 && index < playoffTeams,
    })),
    games: projectedGames,
  };
}

export type LoadProjectedStandingsOptions = {
  fetchWeek?: FetchWeek;
  loadProjections?: (season: number, week: number) => Promise<WeekProjections>;
};

export async function loadProjectedStandings(
  league: League,
  season: number,
  options: LoadProjectedStandingsOptions = {},
): Promise<ProjectedStandings | { error: string }> {
  const standings = league.standings ?? [];
  if (standings.length < 2) return { error: "Standings are not available for this league." };
  const regularSeasonEndsWeek = league.playoffs?.weekStart ? league.playoffs.weekStart - 1 : DEFAULT_LAST_REGULAR_WEEK;
  const throughWeek = Math.max(...standings.map((row) => row.wins + row.losses + row.ties));
  const remaining = Array.from({ length: Math.max(0, regularSeasonEndsWeek - throughWeek) }, (_, i) => throughWeek + 1 + i);

  const loadProjections = options.loadProjections ?? loadWeekProjections;
  const [schedule, projections] = await Promise.all([
    loadScheduleGames(league.id, remaining, options.fetchWeek),
    Promise.allSettled(remaining.map((week) => loadProjections(season, week))),
  ]);
  const weeks = new Map<number, WeekProjections>();
  const missingWeeks = new Set(schedule.missingWeeks);
  projections.forEach((result, i) => {
    if (result.status === "fulfilled") weeks.set(remaining[i]!, result.value);
    else missingWeeks.add(remaining[i]!);
  });
  if (remaining.length > 0 && weeks.size === 0) return { error: "Sleeper projections could not be loaded." };
  if (remaining.length > 0 && schedule.games.length === 0) return { error: "The remaining schedule could not be loaded from Sleeper." };

  return buildProjectedStandings({
    league,
    weeks,
    games: schedule.games,
    throughWeek,
    regularSeasonEndsWeek,
    missingWeeks: [...missingWeeks].sort((a, b) => a - b),
  });
}

const querySchema = z.object({ leagueId: z.string().min(1) });

/** GET /api/data/projected-standings?leagueId= */
export async function handleProjectedStandings(req: Request): Promise<Response> {
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
    if (!cached || !league) return json({ ok: false, error: "League data is still loading. Try again shortly." }, 409);

    const result = await loadProjectedStandings(league, cached.dashboard.season);
    if ("error" in result) return json({ ok: false, error: result.error }, 422);
    return json(result);
  } catch (err) {
    return internalError(err);
  }
}
