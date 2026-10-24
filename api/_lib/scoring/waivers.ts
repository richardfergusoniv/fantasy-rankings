import { isPositionHole } from "./blend.js";
import { CLOSE_CALL, waiverLabelPct, waiverLabelWeek } from "./labels.js";
import { round2 } from "./math.js";
import type { ScoreReason, WaiverResult, WindowScore } from "./types.js";
import { BUILTIN_SCORING_WEIGHTS, type ScoringWeightsParams } from "./weights.js";

export type WaiverValueWindowInput = {
  starterValueBefore: number;
  starterValueAfter: number;
  benchValueBefore: number;
  benchValueAfter: number;
};

export type ScoreWaiverInput = {
  addName: string;
  dropName: string | null;
  addPosition: string;
  week: {
    lineupBefore: number;
    lineupAfter: number;
  };
  seasonLong: WaiverValueWindowInput;
  dynasty?: WaiverValueWindowInput;
  needPos?: number;
  positionRank?: number;
  teamCount?: number;
  weights?: ScoringWeightsParams;
  isDynasty?: boolean;
  reasonExtras?: ScoreReason[];
};

function pctWindow(args: {
  before: WaiverValueWindowInput;
  benchWeight: number;
  needPos: number;
  reasons: ScoreReason[];
  factor: string;
}): WindowScore {
  const dStarter = args.before.starterValueAfter - args.before.starterValueBefore;
  const dBench = args.before.benchValueAfter - args.before.benchValueBefore;
  const gain = dStarter + args.benchWeight * (1 + args.needPos) * dBench;
  const pct = round2((gain / Math.max(1, args.before.starterValueBefore)) * 100);
  return {
    score: pct,
    label: waiverLabelPct(pct),
    metric: "gain_pct_of_starters",
    reasons: [
      ...args.reasons,
      {
        factor: args.factor,
        source: "fantasycalc",
        effect: `Gain ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% of starter value`,
      },
    ],
  };
}

/**
 * Waiver scores for Week N / Season Long / Dynasty.
 * Drop candidate is chosen by the caller (lowest-value bench outside best lineup).
 */
export function scoreWaiver(input: ScoreWaiverInput): WaiverResult {
  const weights = input.weights ?? BUILTIN_SCORING_WEIGHTS;
  const need = input.needPos ?? 0;
  const hole =
    typeof input.positionRank === "number" && typeof input.teamCount === "number"
      ? isPositionHole(input.positionRank, input.teamCount)
      : false;

  const baseReasons: ScoreReason[] = [...(input.reasonExtras ?? [])];
  if (need > 0 || hole) {
    baseReasons.push({
      factor: "positional_need",
      source: "power_rankings",
      effect: hole
        ? `Fills your weakest position (${input.addPosition})`
        : `Positional need ${input.addPosition} ${(need * 100).toFixed(0)}%`,
    });
  }

  const weekDelta = round2(input.week.lineupAfter - input.week.lineupBefore);
  const week: WindowScore = {
    score: weekDelta,
    label: waiverLabelWeek(weekDelta),
    metric: "lineup_points_gained",
    reasons: [
      ...baseReasons,
      {
        factor: "week_delta",
        source: "optimizeTradeRoster",
        effect: input.dropName
          ? `Add ${input.addName}, drop ${input.dropName}: ${weekDelta >= 0 ? "+" : ""}${weekDelta.toFixed(1)} pts`
          : `Add ${input.addName}: ${weekDelta >= 0 ? "+" : ""}${weekDelta.toFixed(1)} pts`,
      },
    ],
  };

  const seasonLong = pctWindow({
    before: input.seasonLong,
    benchWeight: weights.waiverBenchWeight.seasonLong,
    needPos: need,
    reasons: baseReasons,
    factor: "season_long_gain",
  });

  const result: WaiverResult = { week, seasonLong };

  if (input.isDynasty && input.dynasty) {
    result.dynasty = pctWindow({
      before: input.dynasty,
      benchWeight: weights.waiverBenchWeight.dynasty,
      needPos: need,
      reasons: baseReasons,
      factor: "dynasty_gain",
    });
  }

  return result;
}

/** True when two waiver adds are within the close-call band. */
export function waiverCloseCall(
  a: WindowScore,
  b: WindowScore,
  kind: "week" | "pct",
): boolean {
  const threshold = kind === "week" ? CLOSE_CALL.waiverWeekPts : CLOSE_CALL.waiverPct;
  return Math.abs(a.score - b.score) <= threshold;
}
