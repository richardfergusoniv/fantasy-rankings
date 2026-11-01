/**
 * Projected standings for every remaining week. The current week scores the
 * lineup each team has set, the same total the Matchup view shows; later weeks
 * use each team's best lineup from its current roster with Sleeper's per-week
 * projections rescored in the league's rules. The higher projected score wins
 * the matchup in the projected table. Playoff odds come from the chat
 * assistant's seeded simulation around these same projections, and the
 * viewer's games carry both lineups slot by slot with a win chance from the
 * Matchup card's spread model.
 *
 * Sleeper's future-week projections already carry injury timelines and byes:
 * a player who is out or on bye in a week has no projection row for it, and
 * one expected back later is projected from that week on.
 */
import { z } from "zod";
import { badRequest, forbidden, internalError, json, unauthorized } from "./api-utils.js";
import { resolveSleeperUserId } from "./auth.js";
import { readUserDashboardCache } from "./dashboard-build.js";
import type { Dashboard } from "./dashboard-schemas.js";
import { scoreProjectedDefenseStats } from "./defense-scoring.js";
import { scoreSleeperPlayerProjection } from "./player-projection-merge.js";
import { isUnavailableStatus, liveForecastPoints, optimizeTradeRoster, sumLiveForecast, type LiveForecastPlayer, type OptimizablePlayer } from "./lineup-optimizer.js";
import { teamOutlook, winProbability, type TeamOutlook } from "./win-probability.js";
import { playoffOddsFromProjections } from "./projected-playoff-odds.js";
import { DEFAULT_LAST_REGULAR_WEEK, loadScheduleGames, type FetchWeek } from "./league-schedule.js";
import { fetchJson, SLEEPER_BASE } from "./sleeper.js";
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
  /** Share of simulated seasons (0–1) that end inside the playoff cut; null when no cut can be drawn. */
  playoffOdds: number | null;
};

/** One lineup slot; an unfilled slot keeps its place with a null player and 0 points. */
export type ProjectedLineupSlot = { slot: string; playerId: string | null; name: string | null; points: number };

/** One of the viewer's remaining games with both projected lineups, for the preview card. */
export type ProjectedGamePreview = {
  week: number;
  opponentRosterId: number;
  mine: ProjectedLineupSlot[];
  theirs: ProjectedLineupSlot[];
  myTotal: number;
  theirTotal: number;
  /** Chance (0–1) the viewer outscores the opponent, from the same spread model as the Matchup card. */
  winProbability: number | null;
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
  /** League also plays each team against the weekly median (included in the projected records). */
  medianMatchup: boolean;
  /** Weeks whose projections failed to load; each team's average of the loaded weeks stands in. */
  missingWeeks: number[];
  /** Oldest projection pull used, ISO time. */
  projectionsAsOf: string | null;
  teams: ProjectedStandingsTeam[];
  games: ProjectedGame[];
  /** The viewer's remaining games, lineup by lineup. Empty when the viewer's roster isn't in the league. */
  userGames: ProjectedGamePreview[];
};

type WeekLineup = { total: number; outlook: TeamOutlook | null; starters: ProjectedLineupSlot[] };

/**
 * Lay starters out in the league's slot order, one entry per slot, so two
 * lineups compare slot for slot. A slot nobody fills stays as an empty entry
 * instead of shifting every later slot; a starter whose slot isn't in the list
 * (shouldn't happen) is kept at the end rather than dropped.
 */
export function alignToSlots(slots: readonly string[], starters: readonly ProjectedLineupSlot[]): ProjectedLineupSlot[] {
  const remaining = [...starters];
  const aligned = slots.map((slot) => {
    const index = remaining.findIndex((starter) => starter.slot === slot);
    if (index < 0) return { slot, playerId: null, name: null, points: 0 };
    return remaining.splice(index, 1)[0]!;
  });
  return [...aligned, ...remaining];
}

/** A future-week starter as a pregame forecast player, so the matchup spread model applies. */
function pregamePlayer(playerId: string, position: string, points: number): LiveForecastPlayer {
  return { playerId, position, projection: points, actual: null, gamePhase: "pregame", gameTime: null, gamePeriod: null, gameClockSeconds: null, injuryStatus: null, isBye: false } as LiveForecastPlayer;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A player's Sleeper-projected points for a week in this league's scoring.
 * No row means bye, out, or no projection: 0.
 */
export function projectedPlayerPoints(
  player: Pick<RosterPlayer, "position">,
  entry: { stats: Record<string, number> } | undefined,
  league: Pick<League, "scoringSettings" | "rankingField">,
): number {
  if (!entry) return 0;
  const fallback = league.rankingField === "halfPpr" ? entry.stats.pts_half_ppr : entry.stats.pts_ppr;
  if (player.position === "DEF") {
    const scoredDefense = league.scoringSettings ? scoreProjectedDefenseStats(entry.stats, league.scoringSettings) : null;
    return scoredDefense ?? fallback ?? 0;
  }
  const scored = league.scoringSettings
    ? scoreSleeperPlayerProjection(player.position as "QB", entry.stats, league.scoringSettings)
    : null;
  return scored ?? fallback ?? 0;
}

/**
 * Current-week total for one roster: the lineup the team has set, forecast the
 * same way as the Matchup view (actual points once final, live pace while
 * playing, the app's projection before kickoff; bye counts zero). A roster with
 * no starters set falls back to its best lineup.
 */
export function currentWeekLineupTotal(players: readonly RosterPlayer[], slots: readonly string[], now = Date.now()): number {
  const starters = players.filter((player) => player.isStarter);
  if (starters.length > 0) return sumLiveForecast(starters, now) ?? 0;
  return bestCurrentWeekLineupTotal(players, slots);
}

/**
 * Best lineup total for the current week from the app's own numbers: the app's
 * blended pregame projection for players who have not played, and actual points
 * for players whose games have started (locked starters stay in their slots).
 * Bye and unavailable players count as zero until their game locks.
 */
function bestCurrentWeekLineupTotal(players: readonly RosterPlayer[], slots: readonly string[]): number {
  const optimizable: OptimizablePlayer[] = players
    .filter((player) => player.playerId !== "0")
    .map((player) => ({
      playerId: player.playerId,
      position: player.position,
      lineupSlot: player.lineupSlot,
      isStarter: player.isStarter,
      projection: player.isBye || isUnavailableStatus(player.injuryStatus) ? 0 : player.projection ?? 0,
      actual: player.actual,
      gamePhase: player.gamePhase,
      gameTime: player.gameTime,
      gamePeriod: player.gamePeriod,
      gameClockSeconds: player.gameClockSeconds,
      injuryStatus: player.injuryStatus,
      isBye: player.isBye,
    }));
  return optimizeTradeRoster(optimizable, [...slots]).score;
}

export type PointsOf = (player: RosterPlayer) => number;

export function sleeperWeekPoints(
  week: WeekProjections,
  league: Pick<League, "scoringSettings" | "rankingField">,
): PointsOf {
  return (player) => projectedPlayerPoints(player, week.players.get(player.playerId), league);
}

/** Best projected lineup total for one roster in one future week. */
export function bestLineupTotal(
  players: readonly RosterPlayer[],
  slots: readonly string[],
  pointsOf: PointsOf,
): number {
  const optimizable: OptimizablePlayer[] = players
    .filter((player) => player.playerId !== "0")
    .map((player) => ({
      playerId: player.playerId,
      position: player.position,
      lineupSlot: null,
      isStarter: false,
      projection: pointsOf(player),
      actual: null,
    }));
  return optimizeTradeRoster(optimizable, [...slots]).score;
}

type LeagueSettingsResponse = { settings?: { league_average_match?: number } };

/**
 * True when the league also scores each team against the weekly median, which
 * adds a second result per team per week. Throws if Sleeper cannot say.
 */
export async function loadLeagueAverageMatch(
  leagueId: string,
  fetchLeague: (leagueId: string) => Promise<LeagueSettingsResponse> = (id) =>
    fetchJson<LeagueSettingsResponse>(`${SLEEPER_BASE}/league/${id}`),
): Promise<boolean> {
  const response = await fetchLeague(leagueId);
  return response?.settings?.league_average_match === 1;
}

/** Best lineup for one roster in one future week, with each starter and the team's spread. */
export function bestLineup(players: readonly RosterPlayer[], slots: readonly string[], pointsOf: PointsOf): WeekLineup {
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const optimizable: OptimizablePlayer[] = players
    .filter((player) => player.playerId !== "0")
    .map((player) => ({
      playerId: player.playerId,
      position: player.position,
      lineupSlot: null,
      isStarter: false,
      projection: pointsOf(player),
      actual: null,
    }));
  const result = optimizeTradeRoster(optimizable, [...slots]);
  const starters = result.starters.map((player) => ({
    slot: player.lineupSlot ?? player.position,
    playerId: player.playerId,
    name: byId.get(player.playerId)?.name ?? player.playerId,
    points: round2(player.projection ?? 0),
  }));
  const outlook = teamOutlook(result.starters.map((player) => pregamePlayer(player.playerId, player.position, player.projection ?? 0)));
  return { total: result.score, outlook, starters: alignToSlots(slots, starters) };
}

/** The lineup a team has set this week, forecast like the Matchup view, in slot order. */
function currentWeekLineup(players: readonly RosterPlayer[], slots: readonly string[], now = Date.now()): WeekLineup {
  const set = players.filter((player) => player.isStarter);
  const total = currentWeekLineupTotal(players, slots, now);
  if (set.length === 0) return { total, outlook: null, starters: [] };
  const order = (slot: string | null) => {
    const index = slot ? slots.indexOf(slot) : -1;
    return index < 0 ? slots.length : index;
  };
  const starters = alignToSlots(slots, [...set]
    .sort((a, b) => order(a.lineupSlot) - order(b.lineupSlot))
    .map((player) => ({
      slot: player.lineupSlot ?? player.position,
      playerId: player.playerId,
      name: player.name,
      points: round2(liveForecastPoints(player, now) ?? 0),
    })));
  return { total, outlook: teamOutlook(set, now), starters };
}

/** Median of the teams' totals; with an even count, the mean of the middle two. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function buildProjectedStandings(args: {
  league: League;
  /** League also plays each team against the weekly median (an extra win or loss per week). */
  medianMatchup?: boolean;
  weeks: ReadonlyMap<number, WeekProjections>;
  /** Week scored from the app's own projections instead of Sleeper's. */
  appWeek?: number | null;
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
  const weekLineups = new Map<string, WeekLineup>();
  const scoredWeeks = new Set<number>(weeks.keys());
  if (args.appWeek != null) scoredWeeks.add(args.appWeek);
  for (const week of scoredWeeks) {
    const projections = weeks.get(week);
    for (const [rosterId, players] of rosters) {
      const lineup = week === args.appWeek
        ? currentWeekLineup(players, slots)
        : projections ? bestLineup(players, slots, sleeperWeekPoints(projections, league)) : null;
      if (lineup) {
        weekTotals.set(`${week}:${rosterId}`, lineup.total);
        weekLineups.set(`${week}:${rosterId}`, lineup);
      }
    }
  }
  const teamAverage = (rosterId: number) => {
    const totals = [...scoredWeeks].map((week) => weekTotals.get(`${week}:${rosterId}`) ?? 0);
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

  if (args.medianMatchup) {
    for (const week of [...new Set(games.map((game) => game.week))]) {
      const totals = [...table.keys()].map((rosterId) => projectedFor(week, rosterId));
      const mid = median(totals);
      for (const rosterId of table.keys()) {
        const entry = table.get(rosterId)!;
        const total = projectedFor(week, rosterId);
        if (round2(total) === round2(mid)) entry.ties += 1;
        else if (total > mid) entry.wins += 1;
        else entry.losses += 1;
      }
    }
  }

  const winPct = (t: { wins: number; losses: number; ties: number }) => {
    const played = t.wins + t.losses + t.ties;
    return played === 0 ? 0 : (t.wins + t.ties / 2) / played;
  };
  const playoffTeams = league.playoffs?.teams ?? 0;
  const userRosterId = league.standings.find((row) => row.isUser)?.rosterId ?? null;
  const userGames: ProjectedGamePreview[] = userRosterId === null ? [] : projectedGames
    .filter((game) => game.rosterIdA === userRosterId || game.rosterIdB === userRosterId)
    .map((game) => {
      const opponentRosterId = game.rosterIdA === userRosterId ? game.rosterIdB : game.rosterIdA;
      const mine = weekLineups.get(`${game.week}:${userRosterId}`);
      const theirs = weekLineups.get(`${game.week}:${opponentRosterId}`);
      return {
        week: game.week,
        opponentRosterId,
        mine: mine?.starters ?? [],
        theirs: theirs?.starters ?? [],
        myTotal: round2(game.rosterIdA === userRosterId ? game.projectedA : game.projectedB),
        theirTotal: round2(game.rosterIdA === userRosterId ? game.projectedB : game.projectedA),
        winProbability: mine?.outlook && theirs?.outlook ? winProbability(mine.outlook, theirs.outlook) : null,
      };
    });

  const ordered = [...table.values()].sort((x, y) => winPct(y) - winPct(x) || y.pf - x.pf || x.row.teamName.localeCompare(y.row.teamName));
  const asOfs = [...weeks.values()].map((week) => week.asOf).sort();

  const result: ProjectedStandings = {
    leagueId: league.id,
    throughWeek: args.throughWeek,
    regularSeasonEndsWeek: args.regularSeasonEndsWeek,
    playoffTeams,
    divisionsIgnored: league.playoffs?.positionKnown === false,
    medianMatchup: args.medianMatchup === true,
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
      // With divisions a division winner can qualify below the overall cut, so draw no cut at all.
      inPlayoffs: playoffTeams > 0 && league.playoffs?.positionKnown !== false && index < playoffTeams,
      playoffOdds: null,
    })),
    games: projectedGames,
    userGames,
  };
  // Playoff odds reuse the chat assistant's simulator so both show the same numbers.
  // No odds when no single cut can be drawn (divisions) or the league has no playoff spots.
  if (playoffTeams > 0 && !result.divisionsIgnored) {
    const odds = new Map(playoffOddsFromProjections(result).teams.map((team) => [team.rosterId, team.playoffPct / 100]));
    result.teams = result.teams.map((team) => ({ ...team, playoffOdds: odds.get(team.rosterId) ?? 0 }));
  }
  return result;
}

export type LoadProjectedStandingsOptions = {
  fetchWeek?: FetchWeek;
  fetchLeague?: (leagueId: string) => Promise<LeagueSettingsResponse>;
  loadProjections?: (season: number, week: number) => Promise<WeekProjections>;
};

export async function loadProjectedStandings(
  league: League,
  season: number,
  currentWeek: number,
  options: LoadProjectedStandingsOptions = {},
): Promise<ProjectedStandings | { error: string }> {
  const standings = league.standings ?? [];
  if (standings.length < 2) return { error: "Standings are not available for this league." };
  const regularSeasonEndsWeek = league.playoffs?.weekStart ? league.playoffs.weekStart - 1 : DEFAULT_LAST_REGULAR_WEEK;
  let medianMatchup: boolean;
  try {
    medianMatchup = await loadLeagueAverageMatch(league.id, options.fetchLeague);
  } catch {
    // Without knowing, completed weeks (and the extra median results) cannot be counted correctly.
    return { error: "League settings could not be loaded from Sleeper." };
  }
  // A median league records two results per completed week.
  const throughWeek = Math.floor(Math.max(...standings.map((row) => row.wins + row.losses + row.ties)) / (medianMatchup ? 2 : 1));
  const remaining = Array.from({ length: Math.max(0, regularSeasonEndsWeek - throughWeek) }, (_, i) => throughWeek + 1 + i);

  const loadProjections = options.loadProjections ?? loadWeekProjections;
  // The current week comes from the app's own projections, so only later weeks need Sleeper.
  const appWeek = remaining.includes(currentWeek) ? currentWeek : null;
  const sleeperWeeks = remaining.filter((week) => week !== appWeek);
  const [schedule, projections] = await Promise.all([
    loadScheduleGames(league.id, remaining, options.fetchWeek),
    Promise.allSettled(sleeperWeeks.map((week) => loadProjections(season, week))),
  ]);
  const weeks = new Map<number, WeekProjections>();
  const missingWeeks = new Set(schedule.missingWeeks);
  projections.forEach((result, i) => {
    if (result.status === "fulfilled") weeks.set(sleeperWeeks[i]!, result.value);
  });
  // One retry for weeks that failed (each success is cached, so a retry also warms the next request).
  const retry = sleeperWeeks.filter((week) => !weeks.has(week));
  const retried = await Promise.allSettled(retry.map((week) => loadProjections(season, week)));
  retried.forEach((result, i) => {
    if (result.status === "fulfilled") weeks.set(retry[i]!, result.value);
  });
  for (const week of sleeperWeeks) if (!weeks.has(week)) missingWeeks.add(week);
  // A missing week would silently change every team's result (a short schedule, or a stand-in score
  // that ignores byes and injuries), so withhold the table rather than show it.
  if (schedule.missingWeeks.length > 0) return { error: "The remaining schedule could not be fully loaded from Sleeper." };
  if (missingWeeks.size > 0) return { error: "Sleeper projections could not be fully loaded." };
  if (remaining.length > 0 && schedule.games.length === 0) return { error: "The remaining schedule could not be loaded from Sleeper." };

  return buildProjectedStandings({
    league,
    medianMatchup,
    weeks,
    appWeek,
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

    const result = await loadProjectedStandings(league, cached.dashboard.season, cached.dashboard.week);
    if ("error" in result) return json({ ok: false, error: result.error }, 422);
    return json(result);
  } catch (err) {
    return internalError(err);
  }
}
