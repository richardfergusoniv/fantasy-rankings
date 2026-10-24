/**
 * Pure weekly-refit guardrails. No DB imports — safe for unit tests.
 */

import { clamp } from "./math.js";
import { BUILTIN_SCORING_WEIGHTS, SCORING_CONSTANTS, type ScoringWeightsParams } from "./weights.js";

const CAL = SCORING_CONSTANTS.calibration;

export type HoldoutMetrics = {
  playerGames: number;
  rmse: number;
  brier: number;
};

export type RefitCandidate = {
  params: ScoringWeightsParams;
  holdout: HoldoutMetrics;
  fitWeeks: number[];
  holdoutWeeks: number[];
};

/**
 * Shrink toward historical prior, then cap the weekly step.
 * θ_new = (n · θ_2026 + k · θ_prior) / (n + k), then clamp vs current.
 */
export function shrinkAndCap(args: {
  observed: number;
  prior: number;
  current: number;
  n: number;
  k: number;
  maxStep: number;
}): number {
  const n = Math.max(0, args.n);
  const shrunk = (n * args.observed + args.k * args.prior) / (n + args.k);
  return clamp(shrunk, args.current - args.maxStep, args.current + args.maxStep);
}

export function shrinkAndCapFrac(args: {
  observed: number;
  prior: number;
  current: number;
  n: number;
  k: number;
  maxStepFrac: number;
}): number {
  const maxStep = Math.abs(args.current) * args.maxStepFrac;
  return shrinkAndCap({ ...args, maxStep: maxStep || args.maxStepFrac });
}

export type PromoteDecision = {
  promote: boolean;
  reason: string;
};

/**
 * Promote only if:
 * - at least `first_after_snapshot_weeks` snapshot weeks exist
 * - holdout has 300+ player-games
 * - candidate RMSE improves by ≥ 0.05 vs active
 * - Brier is not worse
 * Label thresholds are never refit (enforced by callers).
 */
export function shouldPromoteWeights(args: {
  snapshotWeekCount: number;
  activeHoldout: HoldoutMetrics;
  candidateHoldout: HoldoutMetrics;
}): PromoteDecision {
  const minWeeks = CAL.retune.first_after_snapshot_weeks;
  if (args.snapshotWeekCount < minWeeks) {
    return {
      promote: false,
      reason: `Need ${minWeeks} snapshot weeks before first retune (have ${args.snapshotWeekCount})`,
    };
  }
  const minGames = CAL.retune.holdout_min_player_games;
  if (args.candidateHoldout.playerGames < minGames) {
    return {
      promote: false,
      reason: `Holdout needs ${minGames}+ player-games (have ${args.candidateHoldout.playerGames})`,
    };
  }
  const rmseGain = args.activeHoldout.rmse - args.candidateHoldout.rmse;
  if (rmseGain < CAL.retune.min_rmse_improvement_pts) {
    return {
      promote: false,
      reason: `RMSE improvement ${rmseGain.toFixed(3)} < ${CAL.retune.min_rmse_improvement_pts}`,
    };
  }
  if (args.candidateHoldout.brier > args.activeHoldout.brier) {
    return {
      promote: false,
      reason: `Brier worsened (${args.candidateHoldout.brier.toFixed(4)} > ${args.activeHoldout.brier.toFixed(4)})`,
    };
  }
  return { promote: true, reason: "Holdout passed RMSE and Brier guardrails" };
}

export type ScorecardDrift = {
  measure: string;
  value: number;
  flagged: boolean;
  detail: string;
};

export function scorecardDriftFlags(args: {
  strongStartHitRate: number | null;
  strongStartPairs: number;
  startHitRate: number | null;
  startPairs: number;
  flexHitRate: number | null;
  flexPairs: number;
  tiebreakBeatRate: number | null;
  tiebreakCases: number;
}): ScorecardDrift[] {
  const flags: ScorecardDrift[] = [];
  const minPairs = CAL.scorecard.min_pairs;

  if (args.strongStartHitRate !== null && args.strongStartPairs >= minPairs) {
    const flagged = args.strongStartHitRate < CAL.scorecard.strong_start_flag_below;
    flags.push({
      measure: "strong_start",
      value: args.strongStartHitRate,
      flagged,
      detail: flagged
        ? `Strong start hit rate ${(args.strongStartHitRate * 100).toFixed(1)}% below ${CAL.scorecard.strong_start_flag_below * 100}%`
        : "ok",
    });
  }

  if (args.startHitRate !== null && args.startPairs >= minPairs) {
    const [lo, hi] = CAL.scorecard.start_flag_outside;
    const flagged = args.startHitRate < lo || args.startHitRate > hi;
    flags.push({
      measure: "start",
      value: args.startHitRate,
      flagged,
      detail: flagged
        ? `Start hit rate outside ${lo * 100}–${hi * 100}%`
        : "ok",
    });
  }

  if (args.flexHitRate !== null && args.flexPairs >= minPairs) {
    const [lo, hi] = CAL.scorecard.flex_flag_outside;
    const flagged = args.flexHitRate < lo || args.flexHitRate > hi;
    flags.push({
      measure: "flex",
      value: args.flexHitRate,
      flagged,
      detail: flagged
        ? `Flex hit rate outside ${lo * 100}–${hi * 100}%`
        : "ok",
    });
  }

  if (args.tiebreakBeatRate !== null && args.tiebreakCases >= CAL.scorecard.tiebreak_min_cases) {
    const flagged = args.tiebreakBeatRate <= CAL.scorecard.tiebreak_drop_below;
    flags.push({
      measure: "tiebreak",
      value: args.tiebreakBeatRate,
      flagged,
      detail: flagged
        ? `Tiebreaker beat rate ≤ ${CAL.scorecard.tiebreak_drop_below * 100}% — drop the rule`
        : "ok",
    });
  }

  return flags;
}

/** Refit one w_v from observed 2026 blend, shrunk to prior. */
export function refitWv(args: {
  observed: number;
  n: number;
  position: "QB" | "RB" | "WR" | "TE";
  current: ScoringWeightsParams;
}): number {
  const prior = BUILTIN_SCORING_WEIGHTS.vegasWeightWv[args.position];
  return shrinkAndCap({
    observed: args.observed,
    prior,
    current: args.current.vegasWeightWv[args.position],
    n: args.n,
    k: CAL.params.w_v.k,
    maxStep: CAL.params.w_v.max_step,
  });
}

export function refitSpreadA(args: {
  observed: number;
  n: number;
  position: "QB" | "RB" | "WR" | "TE";
  current: ScoringWeightsParams;
}): number {
  const prior = BUILTIN_SCORING_WEIGHTS.spreadA[args.position];
  return shrinkAndCap({
    observed: args.observed,
    prior,
    current: args.current.spreadA[args.position],
    n: args.n,
    k: CAL.params.spread_a.k,
    maxStep: CAL.params.spread_a.max_step,
  });
}

export function refitSpreadB(args: {
  observed: number;
  n: number;
  position: "QB" | "RB" | "WR" | "TE";
  current: ScoringWeightsParams;
}): number {
  const prior = BUILTIN_SCORING_WEIGHTS.spreadB[args.position];
  return shrinkAndCap({
    observed: args.observed,
    prior,
    current: args.current.spreadB[args.position],
    n: args.n,
    k: CAL.params.spread_b.k,
    maxStep: CAL.params.spread_b.max_step,
  });
}

/** Labels are never auto-refit — this is a hard no-op guard for callers. */
export function assertLabelsNotRefit(): void {
  if (CAL.labels_refit !== false) {
    throw new Error("Label thresholds must never be auto-refit");
  }
}
