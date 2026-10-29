/**
 * `pace-v1`: each team scores at its points-per-game so far (blended toward
 * the league average early), and games are decided by the gap. The previous
 * week is rebuilt by undoing the last finished week's results. Needs nothing
 * stored. See playoff-odds.ts for the simulation.
 */
import type { Dashboard } from "./dashboard-schemas.js";
import {
  type FetchWeek,
  type LeagueOutcomes,
  type OutcomesEngine,
  type SleeperMatchupRow,
} from "./league-outcomes-contract.js";
import { simulatePlayoffOdds, type OddsGame, type OddsTeam, type PlayoffOdds } from "./playoff-odds.js";
import { fetchJson, SLEEPER_BASE } from "./sleeper.js";

type League = Dashboard["leagues"][number];
type Standing = League["standings"][number];

export const OUTCOME_TRIALS = 20_000;
export const DEFAULT_LAST_REGULAR_WEEK = 14;

export const defaultFetchWeek: FetchWeek = (leagueId, week) =>
  fetchJson<SleeperMatchupRow[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`);

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

export function toOddsTeam(row: Standing): OddsTeam {
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

export const recordText = (team: Pick<OddsTeam, "wins" | "losses" | "ties">) =>
  `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`;

const round1 = (value: number) => Math.round(value * 10) / 10;

export const paceEngine: OutcomesEngine = {
  id: "pace-v1",
  async run({ league, fetchWeek = defaultFetchWeek }): Promise<LeagueOutcomes | { error: string }> {
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
    const standingById = new Map(standings.map((row) => [row.rosterId, row]));
    const ppg = (rosterId: number) => {
      const row = standingById.get(rosterId);
      const played = row ? row.wins + row.losses + row.ties : 0;
      return row && played > 0 ? round1(row.pointsFor / played) : null;
    };

    const me = standings.find((row) => row.isUser) ?? null;
    const probByGame = new Map(now.games.map((game) => [`${game.week}:${game.a}:${game.b}`, game.pA]));
    const userSchedule = me
      ? remainingGames
        .filter((game) => game.a === me.rosterId || game.b === me.rosterId)
        .sort((a, b) => a.week - b.week)
        .map((game) => {
          const opponentId = game.a === me.rosterId ? game.b : game.a;
          const opponent = standingById.get(opponentId);
          const pA = probByGame.get(`${game.week}:${game.a}:${game.b}`) ?? 0.5;
          return {
            week: game.week,
            opponentRosterId: opponentId,
            opponentName: opponent?.teamName ?? "Unknown",
            opponentRecord: opponent ? recordText(opponent) : null,
            winProbability: round1((game.a === me.rosterId ? pA : 1 - pA) * 100),
            projectedFor: ppg(me.rosterId),
            projectedAgainst: ppg(opponentId),
          };
        })
      : [];

    const notes = [
      "Each team is assumed to keep scoring at its points-per-game pace so far; current rosters and injuries are not considered.",
      "Seeding is wins, then points for. Assumes every team plays each remaining week.",
      ...(league.playoffs.positionKnown === false ? ["League has divisions; division winners are not modeled."] : []),
      ...(missingWeeks.length > 0 ? [`Schedule unavailable for week(s) ${missingWeeks.join(", ")}; those games are left out.`] : []),
    ];

    return {
      leagueId: league.id,
      throughWeek,
      previousWeek: before ? throughWeek - 1 : null,
      previousSource: before ? "rewound" : null,
      previousAsOf: null,
      playoffTeams,
      regularSeasonEndsWeek: lastRegularWeek,
      trials: OUTCOME_TRIALS,
      divisionsIgnored: league.playoffs.positionKnown === false,
      missingWeeks,
      method: { engine: "pace-v1", label: "Scoring pace to date", inputsAsOf: null, notes },
      teams: now.teams.map((team) => ({
        rosterId: team.rosterId,
        teamName: team.teamName,
        isUser: team.isUser,
        record: standingById.has(team.rosterId) ? recordText(standingById.get(team.rosterId)!) : team.record,
        projectedWins: team.projectedWins,
        playoffPct: team.playoffPct,
        topSeedPct: team.topSeedPct,
        lastPct: team.lastPct,
        previousPlayoffPct: prior.get(team.rosterId)?.playoffPct ?? null,
        previousLastPct: prior.get(team.rosterId)?.lastPct ?? null,
        weeklyStrength: ppg(team.rosterId),
      })),
      userScenarios: now.userScenarios,
      userSchedule,
    };
  },
};
