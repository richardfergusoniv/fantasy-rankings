import { CLOSE_CALL, fairnessBand, tradeLabelSeasonLong, tradeLabelWeek } from "./labels.js";
import { round2 } from "./math.js";
import type { ScoreReason, TradeResult, WindowScore } from "./types.js";
import {
  BUILTIN_SCORING_WEIGHTS,
  type ScoringWeightsParams,
} from "./weights.js";

export type TradeAsset = {
  playerId: string;
  name: string;
  position: string;
  value: number;
};

export type TradePhase = "in_season" | "offseason";

export function isInSeasonPhase(date: Date = new Date()): TradePhase {
  const month = date.getUTCMonth(); // 0–11
  // Dynasty offseason Jan–Jul; in-season from Aug 1.
  return month >= 7 ? "in_season" : "offseason";
}

export function sigma30ForValue(
  value: number,
  window: "season_long" | "dynasty",
  phase: TradePhase,
  weights: ScoringWeightsParams = BUILTIN_SCORING_WEIGHTS,
): number {
  const curve =
    window === "dynasty"
      ? phase === "in_season"
        ? weights.sigma30.dynastyInSeason
        : weights.sigma30.dynastyOffseason
      : phase === "in_season"
        ? weights.sigma30.redraftInSeason
        : weights.sigma30.redraftOffseason;
  return curve.a + curve.b * Math.max(0, value);
}

/**
 * z = (Get − Give) / √(Σ σ₃₀(vᵢ)²) over every player and pick on both sides.
 */
export function tradeFairnessZ(
  give: readonly TradeAsset[],
  get: readonly TradeAsset[],
  window: "season_long" | "dynasty",
  phase: TradePhase = isInSeasonPhase(),
  weights: ScoringWeightsParams = BUILTIN_SCORING_WEIGHTS,
): { gap: number; gapPct: number; z: number; band: "Fair" | "Uneven" | "Lopsided"; sigmaDenom: number } {
  const giveTotal = give.reduce((sum, row) => sum + row.value, 0);
  const getTotal = get.reduce((sum, row) => sum + row.value, 0);
  const gap = getTotal - giveTotal;
  const denomMax = Math.max(giveTotal, getTotal, 1);
  const gapPct = round2((gap / denomMax) * 100);
  let sumVar = 0;
  for (const asset of [...give, ...get]) {
    const s = sigma30ForValue(asset.value, window, phase, weights);
    sumVar += s * s;
  }
  const sigmaDenom = Math.sqrt(Math.max(0, sumVar));
  const z = sigmaDenom === 0 ? 0 : gap / sigmaDenom;
  return {
    gap,
    gapPct,
    z: round2(z),
    band: fairnessBand(Math.abs(z)),
    sigmaDenom: round2(sigmaDenom),
  };
}

export type ScoreTradeInput = {
  week: {
    yourLineupBefore: number;
    yourLineupAfter: number;
    partnerLineupBefore?: number;
    partnerLineupAfter?: number;
  };
  seasonLong: {
    give: TradeAsset[];
    get: TradeAsset[];
    yourStarterValueBefore: number;
    yourStarterValueAfter: number;
    yourPowerRankBefore: number;
    yourPowerRankAfter: number;
    fillsHole?: boolean;
  };
  dynasty?: {
    give: TradeAsset[];
    get: TradeAsset[];
    yourStarterValueBefore: number;
    yourStarterValueAfter: number;
    yourPowerRankBefore: number;
    yourPowerRankAfter: number;
    fillsHole?: boolean;
  };
  isDynasty?: boolean;
  phase?: TradePhase;
  weights?: ScoringWeightsParams;
  reasonExtras?: ScoreReason[];
};

function seasonWindow(
  args: ScoreTradeInput["seasonLong"],
  window: "season_long" | "dynasty",
  phase: TradePhase,
  weights: ScoringWeightsParams,
  extras: ScoreReason[],
): { score: WindowScore; fairness: NonNullable<TradeResult["fairness"]> } {
  const fair = tradeFairnessZ(args.give, args.get, window, phase, weights);
  const starterDelta = args.yourStarterValueAfter - args.yourStarterValueBefore;
  const powerDelta = args.yourPowerRankAfter - args.yourPowerRankBefore;
  const label = tradeLabelSeasonLong({
    gap: fair.gap,
    z: fair.z,
    starterValueDelta: starterDelta,
    powerRankDelta: powerDelta,
    fillsHole: Boolean(args.fillsHole),
  });
  const closeCall =
    Math.abs(fair.z) <= CLOSE_CALL.tradeAbsZ;

  return {
    fairness: {
      z: fair.z,
      band: fair.band,
      gap: fair.gap,
      gapPct: fair.gapPct,
    },
    score: {
      score: fair.gapPct,
      label,
      metric: "value_gap_pct",
      closeCall: closeCall || undefined,
      reasons: [
        ...extras,
        {
          factor: "value_gap",
          source: "fantasycalc",
          effect: `Gap ${fair.gapPct >= 0 ? "+" : ""}${fair.gapPct.toFixed(1)}% (${fair.band}, z=${fair.z.toFixed(2)})`,
        },
        {
          factor: "starter_value",
          source: "optimizeTradeRoster",
          effect: `Starter value ${starterDelta >= 0 ? "+" : ""}${Math.round(starterDelta)}`,
        },
        {
          factor: "power_rank",
          source: "power_rankings",
          effect: `Power rank ${args.yourPowerRankBefore} → ${args.yourPowerRankAfter}`,
        },
      ],
    },
  };
}

/**
 * Trade scores for Week N / Season Long / Dynasty with fair-trade z bands.
 */
export function scoreTrade(input: ScoreTradeInput): TradeResult {
  const weights = input.weights ?? BUILTIN_SCORING_WEIGHTS;
  const phase = input.phase ?? isInSeasonPhase();
  const extras = input.reasonExtras ?? [];

  const weekDelta = round2(input.week.yourLineupAfter - input.week.yourLineupBefore);
  const week: WindowScore = {
    score: weekDelta,
    label: tradeLabelWeek(weekDelta),
    metric: "lineup_points_delta",
    closeCall:
      Math.abs(weekDelta) <= CLOSE_CALL.tradeWeekDelta ? true : undefined,
    reasons: [
      ...extras,
      {
        factor: "week_delta",
        source: "optimizeTradeRoster",
        effect: `Your lineup ${weekDelta >= 0 ? "+" : ""}${weekDelta.toFixed(1)} pts`,
      },
      ...(typeof input.week.partnerLineupBefore === "number"
        && typeof input.week.partnerLineupAfter === "number"
        ? [{
          factor: "partner_week_delta",
          source: "optimizeTradeRoster",
          effect: `Partner lineup ${round2(input.week.partnerLineupAfter - input.week.partnerLineupBefore) >= 0 ? "+" : ""}${round2(input.week.partnerLineupAfter - input.week.partnerLineupBefore).toFixed(1)} pts`,
        } satisfies ScoreReason]
        : []),
    ],
  };

  const season = seasonWindow(input.seasonLong, "season_long", phase, weights, extras);
  // Season Long / Dynasty close call requires Fair band AND Week N Δ within ±1.
  season.score.closeCall = week.closeCall && season.score.closeCall ? true : undefined;

  const result: TradeResult = {
    week,
    seasonLong: season.score,
    fairness: season.fairness,
  };

  if (input.isDynasty && input.dynasty) {
    const dynasty = seasonWindow(input.dynasty, "dynasty", phase, weights, extras);
    dynasty.score.closeCall = week.closeCall && dynasty.score.closeCall ? true : undefined;
    result.dynasty = dynasty.score;
  }

  return result;
}
