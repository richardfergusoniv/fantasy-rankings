/**
 * Playoff and last-place odds built on the Projected standings: each remaining
 * game is decided by the two teams' projected lineup scores for that week, with
 * a typical week-to-week spread. An AI-side calculator, not shown in the app,
 * so its numbers agree with the Projected table.
 */
import { simulatePlayoffOdds, winProbability, WEEKLY_SCORE_SD, type PlayoffOdds, type WinScenario } from "./playoff-odds.js";
import type { ProjectedStandings } from "./projected-standings.js";

export const PROJECTED_ODDS_TRIALS = 20_000;

export type ProjectedUserGame = {
  week: number;
  opponent: string;
  opponentRecord: string;
  projectedFor: number;
  projectedAgainst: number;
  /** Chance the user wins, 0-100 (0.1 precision). */
  winChance: number;
};

export type ProjectedPlayoffOdds = {
  trials: number;
  playoffTeams: number;
  divisionsIgnored: boolean;
  teams: PlayoffOdds["teams"];
  userGames: ProjectedUserGame[];
  userScenarios: WinScenario[];
};

const recordText = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;

export function playoffOddsFromProjections(projected: ProjectedStandings, trials = PROJECTED_ODDS_TRIALS): ProjectedPlayoffOdds {
  const games = projected.games.map((game) => ({ week: game.week, a: game.rosterIdA, b: game.rosterIdB }));
  const probabilities = projected.games.map((game) => winProbability(game.projectedA, game.projectedB, WEEKLY_SCORE_SD));
  const remainingPoints = new Map<number, number>();
  for (const game of projected.games) {
    remainingPoints.set(game.rosterIdA, (remainingPoints.get(game.rosterIdA) ?? 0) + game.projectedA);
    remainingPoints.set(game.rosterIdB, (remainingPoints.get(game.rosterIdB) ?? 0) + game.projectedB);
  }
  const odds = simulatePlayoffOdds({
    teams: projected.teams.map((team) => ({
      rosterId: team.rosterId,
      teamName: team.teamName,
      isUser: team.isUser,
      wins: team.record.wins,
      losses: team.record.losses,
      ties: team.record.ties,
      pointsFor: team.pointsFor,
    })),
    games,
    playoffTeams: projected.playoffTeams,
    gameWinProbabilities: probabilities,
    remainingPoints,
    trials,
  });

  const me = projected.teams.find((team) => team.isUser) ?? null;
  const byId = new Map(projected.teams.map((team) => [team.rosterId, team]));
  const userGames: ProjectedUserGame[] = me
    ? projected.games
      .map((game, g) => ({ game, pA: odds.games[g]?.pA ?? probabilities[g]! }))
      .filter(({ game }) => game.rosterIdA === me.rosterId || game.rosterIdB === me.rosterId)
      .sort((x, y) => x.game.week - y.game.week)
      .map(({ game, pA }) => {
        const mine = game.rosterIdA === me.rosterId;
        const opponent = byId.get(mine ? game.rosterIdB : game.rosterIdA);
        return {
          week: game.week,
          opponent: opponent?.teamName ?? "Unknown",
          opponentRecord: opponent ? recordText(opponent.record) : "",
          projectedFor: mine ? game.projectedA : game.projectedB,
          projectedAgainst: mine ? game.projectedB : game.projectedA,
          winChance: Math.round((mine ? pA : 1 - pA) * 1000) / 10,
        };
      })
    : [];

  return {
    trials: odds.trials,
    playoffTeams: projected.playoffTeams,
    divisionsIgnored: projected.divisionsIgnored,
    teams: odds.teams,
    userGames,
    userScenarios: odds.userScenarios,
  };
}
