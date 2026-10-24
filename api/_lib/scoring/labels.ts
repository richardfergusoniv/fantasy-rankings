import { SCORING_CONSTANTS } from "./weights.js";

export type StartSitLabel = "Strong start" | "Start" | "Flex" | "Sit";
export type WaiverLabel = "Must add" | "Add" | "Watch" | "Pass";
export type TradeLabel = "Accept" | "Lean accept" | "Decline";
export type FairnessBand = "Fair" | "Uneven" | "Lopsided";

export function startSitLabel(winChance: number, unavailable: boolean): StartSitLabel {
  if (unavailable) return "Sit";
  if (winChance >= 70) return "Strong start";
  if (winChance >= 55) return "Start";
  if (winChance >= 45) return "Flex";
  return "Sit";
}

export function waiverLabelWeek(deltaPts: number): WaiverLabel {
  if (deltaPts >= 4) return "Must add";
  if (deltaPts >= 1.5) return "Add";
  if (deltaPts >= 0.5) return "Watch";
  return "Pass";
}

export function waiverLabelPct(gainPct: number): WaiverLabel {
  if (gainPct >= 5) return "Must add";
  if (gainPct >= 2) return "Add";
  if (gainPct >= 0.5) return "Watch";
  return "Pass";
}

export function tradeLabelWeek(deltaPts: number): TradeLabel {
  if (deltaPts >= 1) return "Accept";
  if (deltaPts >= 0) return "Lean accept";
  return "Decline";
}

export function fairnessBand(absZ: number): FairnessBand {
  if (absZ <= 1) return "Fair";
  if (absZ <= 2) return "Uneven";
  return "Lopsided";
}

export function tradeLabelSeasonLong(args: {
  gap: number;
  z: number;
  starterValueDelta: number;
  powerRankDelta: number;
  fillsHole: boolean;
}): TradeLabel {
  const starterNotLower = args.starterValueDelta >= 0;
  const powerNotWorse = args.powerRankDelta <= 0; // lower rank number is better; delta = after - before
  if (args.gap >= 0 && starterNotLower && powerNotWorse) return "Accept";
  if (args.z >= -1 && (args.starterValueDelta > 0 || args.fillsHole)) return "Lean accept";
  return "Decline";
}

export const CLOSE_CALL = {
  startSitFlexBand: SCORING_CONSTANTS.start_sit.close_call,
  waiverWeekPts: SCORING_CONSTANTS.waivers.close_call.week_pts,
  waiverPct: SCORING_CONSTANTS.waivers.close_call.pct,
  tradeAbsZ: SCORING_CONSTANTS.trades.close_call.abs_z_max,
  tradeWeekDelta: SCORING_CONSTANTS.trades.close_call.week_delta_within_pts,
} as const;
