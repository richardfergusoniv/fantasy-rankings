/**
 * Built-in scoring weights from scoring-constants.json (2018–25 priors).
 * Active `scoring_weights` rows override these at runtime when loaded.
 */

import constants from "./constants.json" with { type: "json" };

export type SkillPosition = "QB" | "RB" | "WR" | "TE";

export type ScoringWeightsParams = {
  version: string;
  vegasWeightWv: Record<SkillPosition, number>;
  spreadA: Record<SkillPosition, number>;
  spreadB: Record<SkillPosition, number>;
  questionablePPlay: Record<SkillPosition | "ALL", number>;
  questionableM: Record<SkillPosition | "ALL", number>;
  vacatedTargetSharePer10: Record<SkillPosition, number>;
  vacatedCarryPerGameRb: number;
  /** Candidate ridge terms — ship at 0 until weekly refit promotes them. */
  qbPaceProe: number;
  teRoleTrend: number;
  rbAgeWeekly: number;
  waiverBenchWeight: { seasonLong: number; dynasty: number };
  sigma30: {
    dynastyInSeason: { a: number; b: number };
    dynastyOffseason: { a: number; b: number };
    redraftInSeason: { a: number; b: number };
    redraftOffseason: { a: number; b: number };
  };
};

const c = constants;

export const BUILTIN_SCORING_WEIGHTS: ScoringWeightsParams = {
  version: c.version,
  vegasWeightWv: {
    QB: c.start_sit.vegas_weight_w_v.QB,
    RB: c.start_sit.vegas_weight_w_v.RB,
    WR: c.start_sit.vegas_weight_w_v.WR,
    TE: c.start_sit.vegas_weight_w_v.TE,
  },
  spreadA: {
    QB: c.start_sit.spread_sd.a.QB,
    RB: c.start_sit.spread_sd.a.RB,
    WR: c.start_sit.spread_sd.a.WR,
    TE: c.start_sit.spread_sd.a.TE,
  },
  spreadB: {
    QB: c.start_sit.spread_sd.b.QB,
    RB: c.start_sit.spread_sd.b.RB,
    WR: c.start_sit.spread_sd.b.WR,
    TE: c.start_sit.spread_sd.b.TE,
  },
  questionablePPlay: {
    QB: c.injury.questionable.p_play.QB,
    RB: c.injury.questionable.p_play.RB,
    WR: c.injury.questionable.p_play.WR,
    TE: c.injury.questionable.p_play.TE,
    ALL: c.injury.questionable.p_play.ALL,
  },
  questionableM: {
    QB: c.injury.questionable.m.QB,
    RB: c.injury.questionable.m.RB,
    WR: c.injury.questionable.m.WR,
    TE: c.injury.questionable.m.TE,
    ALL: c.injury.questionable.m.ALL,
  },
  vacatedTargetSharePer10: {
    QB: c.teammate_injury_vacated_usage.per_10pts_vacated_target_share.QB,
    RB: c.teammate_injury_vacated_usage.per_10pts_vacated_target_share.RB,
    WR: c.teammate_injury_vacated_usage.per_10pts_vacated_target_share.WR,
    TE: c.teammate_injury_vacated_usage.per_10pts_vacated_target_share.TE,
  },
  vacatedCarryPerGameRb: c.teammate_injury_vacated_usage.RB_per_vacated_carry_per_game,
  qbPaceProe: 0,
  teRoleTrend: 0,
  rbAgeWeekly: 0,
  waiverBenchWeight: {
    seasonLong: c.waivers.bench_weight_b.season_long,
    dynasty: c.waivers.bench_weight_b.dynasty,
  },
  sigma30: {
    dynastyInSeason: {
      a: c.trades.sigma30_curves.dynasty_in_season.a,
      b: c.trades.sigma30_curves.dynasty_in_season.b,
    },
    dynastyOffseason: {
      a: c.trades.sigma30_curves.dynasty_offseason.a,
      b: c.trades.sigma30_curves.dynasty_offseason.b,
    },
    redraftInSeason: {
      a: c.trades.sigma30_curves.redraft_in_season.a,
      b: c.trades.sigma30_curves.redraft_in_season.b,
    },
    redraftOffseason: {
      a: c.trades.sigma30_curves.redraft_offseason.a,
      b: c.trades.sigma30_curves.redraft_offseason.b,
    },
  },
};

/** Alias used by move-scoring and chat tools. */
export const SCORING_WEIGHTS = BUILTIN_SCORING_WEIGHTS;

export const SCORING_CONSTANTS = c;

export function isSkillPosition(position: string): position is SkillPosition {
  return position === "QB" || position === "RB" || position === "WR" || position === "TE";
}

export function skillOrAll(
  map: Record<SkillPosition | "ALL", number>,
  position: string,
): number {
  if (isSkillPosition(position)) return map[position];
  return map.ALL;
}
