/**
 * Monte Carlo playoff odds from the current standings and the remaining
 * schedule. A heuristic, not an app score: each team's scoring level is its
 * points-per-game so far (shrunk toward the league average early in the
 * season), and a game is a coin flip weighted by the gap in those levels.
 * Seeding uses wins, then points for. Divisions are not modeled.
 */

export type OddsTeam = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

export type OddsGame = { week: number; a: number; b: number };

export type TeamOdds = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
  record: string;
  projectedWins: number;
  playoffPct: number;
  topSeedPct: number;
  /** Chance of finishing last in the regular season. */
  lastPct: number;
};

export type WinScenario = { finalWins: number; probability: number; playoffPct: number };

export type PlayoffOdds = {
  trials: number;
  gamesRemaining: number;
  /** Each simulated game with the chance that team `a` wins it (0-1). */
  games: Array<{ week: number; a: number; b: number; pA: number }>;
  teams: TeamOdds[];
  userScenarios: WinScenario[];
};

/** Typical week-to-week standard deviation of a fantasy team's score. */
export const WEEKLY_SCORE_SD = 22;
/** Games of league-average scoring blended into each team's points-per-game. */
const SHRINK_GAMES = 3;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

export function winProbability(muA: number, muB: number, sd = WEEKLY_SCORE_SD): number {
  const z = (muA - muB) / (sd * Math.SQRT2);
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulatePlayoffOdds(args: {
  teams: readonly OddsTeam[];
  games: readonly OddsGame[];
  playoffTeams: number;
  trials?: number;
  seed?: number;
}): PlayoffOdds {
  const trials = args.trials ?? 4000;
  const rand = mulberry32(args.seed ?? 20260);
  const teams = args.teams;
  const index = new Map(teams.map((team, i) => [team.rosterId, i]));
  const games = args.games
    .map((game) => ({ a: index.get(game.a), b: index.get(game.b) }))
    .filter((game): game is { a: number; b: number } => game.a !== undefined && game.b !== undefined && game.a !== game.b);

  const played = teams.map((team) => team.wins + team.losses + team.ties);
  const withGames = teams.filter((_, i) => played[i]! > 0);
  const leagueAvg = withGames.length > 0
    ? withGames.reduce((sum, team) => sum + team.pointsFor, 0)
      / played.reduce((sum, count) => sum + count, 0)
    : 0;
  const mu = teams.map((team, i) =>
    (team.pointsFor + leagueAvg * SHRINK_GAMES) / (played[i]! + SHRINK_GAMES));

  const remaining = teams.map(() => 0);
  for (const game of games) {
    remaining[game.a] = remaining[game.a]! + 1;
    remaining[game.b] = remaining[game.b]! + 1;
  }
  const pCache = games.map((game) => winProbability(mu[game.a]!, mu[game.b]!));

  const made = teams.map(() => 0);
  const top = teams.map(() => 0);
  const last = teams.map(() => 0);
  const winsSum = teams.map(() => 0);
  const userIndex = teams.findIndex((team) => team.isUser);
  const scenarioCount = new Map<number, { n: number; made: number }>();
  const playoffTeams = Math.min(Math.max(1, args.playoffTeams), teams.length);

  for (let t = 0; t < trials; t += 1) {
    const wins = teams.map((team) => team.wins + team.ties / 2);
    for (let g = 0; g < games.length; g += 1) {
      const game = games[g]!;
      if (rand() < pCache[g]!) wins[game.a] = wins[game.a]! + 1;
      else wins[game.b] = wins[game.b]! + 1;
    }
    // Points-for tiebreak: points so far plus expected points still to come.
    const order = teams
      .map((team, i) => ({ i, wins: wins[i]!, pf: team.pointsFor + remaining[i]! * mu[i]! + rand() * 0.01 }))
      .sort((x, y) => y.wins - x.wins || y.pf - x.pf);
    order.forEach((row, rank) => {
      winsSum[row.i] = winsSum[row.i]! + row.wins;
      if (rank < playoffTeams) made[row.i] = made[row.i]! + 1;
      if (rank === 0) top[row.i] = top[row.i]! + 1;
      if (rank === teams.length - 1) last[row.i] = last[row.i]! + 1;
    });
    if (userIndex >= 0) {
      const key = wins[userIndex]!;
      const entry = scenarioCount.get(key) ?? { n: 0, made: 0 };
      entry.n += 1;
      if (order.findIndex((row) => row.i === userIndex) < playoffTeams) entry.made += 1;
      scenarioCount.set(key, entry);
    }
  }

  const pct = (count: number) => Math.round((count / trials) * 1000) / 10;
  return {
    trials,
    gamesRemaining: games.length,
    games: args.games
      .filter((game) => index.has(game.a) && index.has(game.b) && game.a !== game.b)
      .map((game, g) => ({ ...game, pA: Math.round(pCache[g]! * 1000) / 1000 })),
    teams: teams
      .map((team, i) => ({
        rosterId: team.rosterId,
        teamName: team.teamName,
        isUser: team.isUser,
        record: `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`,
        projectedWins: Math.round((winsSum[i]! / trials) * 10) / 10,
        playoffPct: pct(made[i]!),
        topSeedPct: pct(top[i]!),
        // Two decimals: last-place odds for the strongest teams are tiny but not zero.
        lastPct: Math.round((last[i]! / trials) * 10000) / 100,
      }))
      .sort((x, y) => y.playoffPct - x.playoffPct || y.projectedWins - x.projectedWins),
    userScenarios: [...scenarioCount.entries()]
      .sort(([x], [y]) => x - y)
      .map(([finalWins, entry]) => ({
        finalWins,
        probability: pct(entry.n),
        playoffPct: Math.round((entry.made / entry.n) * 1000) / 10,
      }))
      .filter((row) => row.probability >= 0.5),
  };
}
