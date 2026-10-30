/** Display helpers for the Projected standings table. */
export function recordLabel(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}

/** "3rd of 12": the ordinal for a 1-based place. */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

/** Places gained (positive) or lost (negative) from today's table to the projected one. */
export function placesMoved(currentRank: number, projectedRank: number): number {
  return currentRank - projectedRank;
}

/** Spread of one team's weekly total, in points, for turning two projections into a win chance. */
export const PROJECTED_TEAM_SD = 20;

/** Chance the first score beats the second, in percent to the nearest whole number, from two projected totals. */
export function projectedWinPercent(mine: number, theirs: number): number {
  const spread = Math.sqrt(2) * PROJECTED_TEAM_SD;
  const z = (mine - theirs) / spread;
  // Abramowitz and Stegun 7.1.26 for the normal CDF.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
  const erf = 1 - poly * t * Math.exp(-(z * z) / 2);
  const cdf = 0.5 * (1 + (z < 0 ? -erf : erf));
  return Math.min(99, Math.max(1, Math.round(cdf * 100)));
}

/** Plain words for a win chance. */
export function winChanceLabel(percent: number): string {
  if (percent >= 75) return "Likely win";
  if (percent >= 55) return "Lean win";
  if (percent > 45) return "Toss-up";
  if (percent > 25) return "Lean loss";
  return "Likely loss";
}

export type NextGame = { week: number; opponentRosterId: number; mine: number; theirs: number; winPercent: number };

/** The team's next games in week order, each with both projected totals and the team's win chance. */
export function nextGamesForTeam(
  games: ReadonlyArray<{ week: number; rosterIdA: number; rosterIdB: number; projectedA: number; projectedB: number }>,
  rosterId: number,
  limit = 3,
): NextGame[] {
  return games
    .filter((game) => game.rosterIdA === rosterId || game.rosterIdB === rosterId)
    .sort((a, b) => a.week - b.week)
    .slice(0, limit)
    .map((game) => {
      const isA = game.rosterIdA === rosterId;
      const mine = isA ? game.projectedA : game.projectedB;
      const theirs = isA ? game.projectedB : game.projectedA;
      return { week: game.week, opponentRosterId: isA ? game.rosterIdB : game.rosterIdA, mine, theirs, winPercent: projectedWinPercent(mine, theirs) };
    });
}
