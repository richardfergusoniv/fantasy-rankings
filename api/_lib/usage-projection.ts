/**
 * The usage projection U of the start/sit blend (docs/scoring/SCORING_SPEC.md).
 *
 * U is built from ffopportunity expected points: each week's expected stat
 * components are scored under the league's own scoring settings with the same
 * scorer the projections pipeline uses, so half-PPR, point-per-first-down and
 * TE premium leagues get a U in their own points rather than a PPR conversion.
 * The season-to-date per-week rate and the last-3-games rate are averaged.
 * Snap and target share stay evidence, not score terms, per the spec.
 */
import { scoreProjectedPlayerStats } from "./fantasy-scoring.js";
import type { PlayerOpportunity } from "./player-insights.js";

export type UsageProjection = {
  /** League-scored usage projection for one game, in points. */
  usageProjection: number;
  /** Weeks of expected-points history behind the projection. */
  usageGames: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Usage projection for one player in one league, or null when the player has
 * no expected-points component history (K, DEF, and players the feed does not
 * cover). With fewer than 2 games the blend itself ignores U (w_v = 1); the
 * value is still returned so callers can record what was available.
 */
export function usageProjectionFor(
  opportunity: PlayerOpportunity | null | undefined,
  position: string,
  scoringSettings: Record<string, number> | undefined,
): UsageProjection | null {
  const componentWeeks = opportunity?.componentWeeks ?? [];
  if (componentWeeks.length === 0) return null;
  const weeklyPoints = componentWeeks.map((row) =>
    scoreProjectedPlayerStats(position, row.stats, scoringSettings),
  );
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const seasonRate = mean(weeklyPoints);
  const last3Rate = mean(weeklyPoints.slice(-3));
  return {
    usageProjection: round2((seasonRate + last3Rate) / 2),
    usageGames: componentWeeks.length,
  };
}

/**
 * Sleeper player id -> opportunity entry, bridged through the insights
 * snapshot's gsis map (the opportunity rows are keyed by gsis id).
 */
export function opportunityBySleeperId(
  opportunity: Record<string, PlayerOpportunity> | undefined,
  sleeperByGsis: Record<string, string> | undefined,
): Map<string, PlayerOpportunity> {
  const bySleeper = new Map<string, PlayerOpportunity>();
  if (!opportunity || !sleeperByGsis) return bySleeper;
  for (const [gsis, entry] of Object.entries(opportunity)) {
    const sleeperId = sleeperByGsis[gsis];
    if (sleeperId) bySleeper.set(sleeperId, entry);
  }
  return bySleeper;
}
