import { applyInjuryToProjection, isUnavailableForScoring } from "./injury.js";
import { round2 } from "./math.js";
import type { ScoredPlayer } from "./types.js";
import {
  BUILTIN_SCORING_WEIGHTS,
  isSkillPosition,
  type ScoringWeightsParams,
  type SkillPosition,
} from "./weights.js";
import { SCORING_CONSTANTS } from "./weights.js";

const MIN_USAGE_GAMES = SCORING_CONSTANTS.start_sit.no_history_rule.min_usage_games;

export type BlendResult = {
  pStar: number;
  v: number | null;
  u: number | null;
  wV: number;
  moments: { mean: number; variance: number; sigma: number };
  reasons: Array<{ factor: string; source: string; effect: string }>;
};

/**
 * P* = w_v · V + (1 − w_v) · U, with no-history and no-Vegas fallbacks,
 * then injury / vacated-usage / candidate ridge terms (weight 0 until refit).
 */
export function blendProjection(
  player: ScoredPlayer,
  opts: {
    weights?: ScoringWeightsParams;
    /** Position-median Week N projection for same FantasyCalc redraft value rank. */
    fallbackMedian?: number | null;
    activeAtKickoff?: boolean;
  } = {},
): BlendResult {
  const weights = opts.weights ?? BUILTIN_SCORING_WEIGHTS;
  const reasons: BlendResult["reasons"] = [];
  const pos: SkillPosition = isSkillPosition(player.position) ? player.position : "WR";

  let v = typeof player.vegasProjection === "number" ? player.vegasProjection : null;
  let u = typeof player.usageProjection === "number" ? player.usageProjection : null;
  const usageGames = player.usageGames ?? (u === null ? 0 : MIN_USAGE_GAMES);

  let wV = weights.vegasWeightWv[pos];
  if (usageGames < MIN_USAGE_GAMES) {
    wV = SCORING_CONSTANTS.start_sit.no_history_rule.w_v_if_fewer;
    reasons.push({
      factor: "no_usage_history",
      source: "usage",
      effect: `Fewer than ${MIN_USAGE_GAMES} usage games; using Vegas only`,
    });
  }

  if (v === null && u === null) {
    const fallback = opts.fallbackMedian ?? player.projection ?? 0;
    v = fallback;
    u = fallback;
    wV = 1;
    reasons.push({
      factor: "no_vegas_fallback",
      source: "redraft_rank_median",
      effect: "No Vegas or usage; using position-median Week N projection",
    });
  } else if (v === null && u !== null) {
    v = u;
    wV = 0;
  } else if (u === null && v !== null) {
    u = v;
    wV = 1;
  }

  let pStar = wV * (v as number) + (1 - wV) * (u as number);

  // Vacated teammate usage (verified weight).
  const vacatedShare = player.vacatedTargetSharePts ?? 0;
  if (vacatedShare > 0) {
    const add = (vacatedShare / 10) * weights.vacatedTargetSharePer10[pos];
    pStar += add;
    reasons.push({
      factor: "vacated_usage",
      source: "teammate_injury",
      effect: `+${round2(add)} from vacated target share`,
    });
  }
  if (pos === "RB" && (player.vacatedCarriesPerGame ?? 0) > 0) {
    const add = (player.vacatedCarriesPerGame ?? 0) * weights.vacatedCarryPerGameRb;
    pStar += add;
    reasons.push({
      factor: "vacated_carries",
      source: "teammate_injury",
      effect: `+${round2(add)} from vacated carries`,
    });
  }

  // Candidate ridge terms — weight 0 until weekly refit promotes them.
  if (pos === "QB" && weights.qbPaceProe !== 0) {
    pStar += weights.qbPaceProe;
  }
  if (pos === "TE" && weights.teRoleTrend !== 0) {
    pStar += weights.teRoleTrend;
  }
  if (pos === "RB" && weights.rbAgeWeekly !== 0) {
    pStar += weights.rbAgeWeekly;
  }

  const moments = applyInjuryToProjection(pStar, player.position, {
    injuryStatus: player.injuryStatus,
    isBye: player.isBye,
    gamePhase: player.gamePhase,
    actual: player.actual,
    weights,
    activeAtKickoff: opts.activeAtKickoff,
  });

  if (isUnavailableForScoring(player.injuryStatus) || player.isBye) {
    reasons.push({
      factor: "unavailable",
      source: "injury",
      effect: player.isBye ? "Bye week" : `${player.injuryStatus ?? "Unavailable"} → Sit`,
    });
  }

  return {
    pStar: round2(pStar),
    v,
    u,
    wV,
    moments: {
      mean: round2(moments.mean),
      variance: moments.variance,
      sigma: round2(moments.sigma),
    },
    reasons,
  };
}

/** Positional need: max(0, (leagueMedian − yours) / leagueMedian). */
export function positionalNeed(yours: number, leagueMedian: number): number {
  if (!(leagueMedian > 0)) return 0;
  return Math.max(0, (leagueMedian - yours) / leagueMedian);
}

/** True when your position rank is in the bottom third of the league. */
export function isPositionHole(rank: number, teamCount: number): boolean {
  if (teamCount <= 0) return false;
  return rank > Math.ceil((teamCount * 2) / 3);
}
