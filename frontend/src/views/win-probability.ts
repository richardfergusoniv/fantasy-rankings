import {
  gameElapsedFraction,
  isUnavailableStatus,
  isVacantLineupSlot,
  liveForecastPoints,
  type LiveForecastPlayer,
} from "../../../api/_lib/lineup-optimizer";

/**
 * Spread of one player's weekly score as a share of his projection.
 * Calibrated against 2026 expected-vs-actual points (ffopportunity), where the
 * residual alone runs 0.31 (QB) to 0.41 (WR); rounded up because a pregame
 * projection also misses on usage, which that residual already knows.
 */
export const SCORE_SPREAD_BY_POSITION: Record<string, number> = {
  QB: 0.4,
  RB: 0.5,
  WR: 0.55,
  TE: 0.6,
  K: 0.5,
  DEF: 0.75,
  DST: 0.75,
};
const DEFAULT_SCORE_SPREAD = 0.55;
/** Score range shown to the user: the middle 80% of outcomes. */
const RANGE_Z = 1.2816;

/** Share of a player's game still to play: 1 before kickoff, 0 once final or out. */
export function remainingShare(player: LiveForecastPlayer): number {
  if (isVacantLineupSlot(player) || player.isBye || player.gamePhase === "final") return 0;
  if (player.gamePhase !== "live") return 1;
  if (isUnavailableStatus(player.injuryStatus)) return 0;
  const elapsed = gameElapsedFraction(player.gamePeriod, player.gameClockSeconds);
  return elapsed === null ? 0.5 : Math.max(0, 1 - elapsed);
}

export type TeamOutlook = { mean: number; sd: number; low: number; high: number };

/** Projected final total and its spread for a lineup (players treated as independent). */
export function teamOutlook(players: readonly LiveForecastPlayer[], now = Date.now()): TeamOutlook | null {
  let mean = 0;
  let variance = 0;
  let counted = 0;
  for (const player of players) {
    const forecast = liveForecastPoints(player, now);
    if (forecast === null) continue;
    counted += 1;
    mean += forecast;
    const spread = SCORE_SPREAD_BY_POSITION[player.position] ?? DEFAULT_SCORE_SPREAD;
    // A player with no projection (unranked in Experts mode) but a live game still
    // carries uncertainty; spread off the live forecast instead of zero.
    const sd = spread * Math.max(0, player.projection ?? forecast) * remainingShare(player);
    variance += sd * sd;
  }
  if (counted === 0) return null;
  const sd = Math.sqrt(variance);
  return {
    mean,
    sd,
    low: Math.max(0, mean - RANGE_Z * sd),
    high: mean + RANGE_Z * sd,
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Chance the first team outscores the second, from 0 to 1. */
export function winProbability(mine: TeamOutlook, theirs: TeamOutlook): number {
  const spread = Math.sqrt(mine.sd * mine.sd + theirs.sd * theirs.sd);
  const margin = mine.mean - theirs.mean;
  if (spread === 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return normalCdf(margin / spread);
}

/** Percent to the nearest tenth for display, kept off 0 and 100 until the result is certain. */
export function winPercent(probability: number): number {
  if (probability <= 0) return 0;
  if (probability >= 1) return 100;
  return Math.min(99.9, Math.max(0.1, Math.round(probability * 1000) / 10));
}
