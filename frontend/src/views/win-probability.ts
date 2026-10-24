import {
  gameElapsedFraction,
  isUnavailableStatus,
  isVacantLineupSlot,
  liveForecastPoints,
  type LiveForecastPlayer,
} from "../../../api/_lib/lineup-optimizer";
import {
  correlatedWinProbability,
  normalCdf,
  projectionSigma,
  SCORING_WEIGHTS,
  type WinChancePlayer,
} from "../../../api/_lib/move-scoring";

/**
 * @deprecated Prefer projectionSigma(a + b·P*) from move-scoring.
 * Kept as a fraction-of-projection fallback for K/DEF and unranked players.
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
/** Spread basis for a live player with no projection: roughly a fringe starter's week. */
const UNPROJECTED_SPREAD_BASIS = 5;
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

function playerSigma(player: LiveForecastPlayer, forecast: number): number {
  const pos = player.position;
  const basis = player.projection ?? Math.max(forecast, UNPROJECTED_SPREAD_BASIS);
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE") {
    return projectionSigma(basis, SCORING_WEIGHTS.spreadA[pos], SCORING_WEIGHTS.spreadB[pos])
      * remainingShare(player);
  }
  const spread = SCORE_SPREAD_BY_POSITION[pos] ?? DEFAULT_SCORE_SPREAD;
  return spread * Math.max(0, basis) * remainingShare(player);
}

export type TeamOutlook = { mean: number; sd: number; low: number; high: number };

/** Projected final total and its spread for a lineup (independent approx for the outlook card). */
export function teamOutlook(players: readonly LiveForecastPlayer[], now = Date.now()): TeamOutlook | null {
  let mean = 0;
  let variance = 0;
  let counted = 0;
  for (const player of players) {
    const forecast = liveForecastPoints(player, now);
    if (forecast === null) continue;
    counted += 1;
    mean += forecast;
    const sd = playerSigma(player, forecast);
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

export { normalCdf };

/** Chance the first team outscores the second, from 0 to 1 (independent fallback). */
export function winProbability(mine: TeamOutlook, theirs: TeamOutlook): number {
  const spread = Math.sqrt(mine.sd * mine.sd + theirs.sd * theirs.sd);
  const margin = mine.mean - theirs.mean;
  if (spread === 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, normalCdf(margin / spread)));
}

/**
 * Correlated lineup win chance from move-scoring pair correlations.
 * Prefer this over independent winProbability when full player context is available.
 */
export function correlatedTeamWinProbability(
  yours: readonly WinChancePlayer[],
  opponent: readonly WinChancePlayer[],
): number {
  return correlatedWinProbability(yours, opponent);
}

/** Percent to the nearest tenth for display, kept off 0 and 100 until the result is certain. */
export function winPercent(probability: number): number {
  if (probability <= 0) return 0;
  if (probability >= 1) return 100;
  return Math.min(99.9, Math.max(0.1, Math.round(probability * 1000) / 10));
}
