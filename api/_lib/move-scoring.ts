/**
 * Deterministic fantasy move scoring for start/sit, waivers, and trades.
 * Pure module — no database or network imports. Numbers come from
 * api/_lib/scoring/constants.json (built-in fallback for scoring_weights).
 *
 * Spec: docs/scoring/SCORING_SPEC.md (constants: api/_lib/scoring/constants.json).
 */
import type { WindowScore } from "./scoring/types.js";

export { SCORING_WEIGHTS, BUILTIN_SCORING_WEIGHTS, SCORING_CONSTANTS } from "./scoring/weights.js";
export type { ScoringWeightsParams, SkillPosition } from "./scoring/weights.js";

export { scoreStartSit } from "./scoring/start-sit.js";
export type { StartSitInput } from "./scoring/start-sit.js";

export { scoreWaiver, waiverCloseCall } from "./scoring/waivers.js";
export type { ScoreWaiverInput, WaiverValueWindowInput } from "./scoring/waivers.js";

export {
  scoreTrade,
  tradeFairnessZ,
  sigma30ForValue,
  isInSeasonPhase,
} from "./scoring/trades.js";
export type { ScoreTradeInput, TradeAsset, TradePhase } from "./scoring/trades.js";

export {
  correlatedWinProbability,
  lineupVariance,
  lineupCovariance,
  pairCorrelation,
  assignWrRanksByTargetShare,
  skillSigma,
} from "./scoring/win-chance.js";
export type { WinChancePlayer } from "./scoring/win-chance.js";

export { blendProjection, positionalNeed, isPositionHole } from "./scoring/blend.js";
export { normalCdf, projectionSigma, outscoreChance } from "./scoring/math.js";
export {
  shouldPromoteWeights,
  shrinkAndCap,
  scorecardDriftFlags,
  refitWv,
  refitSpreadA,
  refitSpreadB,
  assertLabelsNotRefit,
} from "./scoring/calibration.js";

export type {
  ScoringWindow,
  ScoreReason,
  WindowScore,
  StartSitResult,
  WaiverResult,
  TradeResult,
  ScoredPlayer,
  TiebreakResult,
} from "./scoring/types.js";

export {
  startSitLabel,
  waiverLabelWeek,
  waiverLabelPct,
  tradeLabelWeek,
  fairnessBand,
} from "./scoring/labels.js";

/**
 * The only part of a WindowScore the chat model sees: the deterministic
 * verdict as data. The score's reasons are deliberately NOT part of this
 * shape. They are written in engine voice (factor / source / effect), and
 * when they reached the model it transcribed them instead of analyzing;
 * the tools now send raw evidence alongside the verdict and the model
 * composes its own reasoning from that.
 */
export type MoveVerdict = {
  label: string;
  score: number;
  closeCall?: boolean;
  tiebreak?: { rule: string; pick: string };
};

export function moveVerdict(score: WindowScore): MoveVerdict {
  return {
    label: score.label,
    score: score.score,
    ...(score.closeCall ? { closeCall: true as const } : {}),
    ...(score.tiebreak
      ? { tiebreak: { rule: score.tiebreak.rule, pick: score.tiebreak.pickAfter } }
      : {}),
  };
}

/** Compact per-window system instructions (Model rules). Kept short for free OpenRouter models. */
export const MOVE_SCORING_WINDOW_PROMPTS = {
  week: [
    "You explain This Week (Week N) fantasy football moves. A scoring tool already ranked them; you explain, you don't re-rank.",
    "Hard rules:",
    "1. Never change the tool's label, score or order. Never invent stats, injuries or news; if it is missing, say \"not in the data\".",
    "2. Never start Out, Doubtful, IR, suspended or bye players.",
    "3. Never suggest a move the league can't process: roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules.",
    "4. Use this league's settings from the tool (scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers). Say when a setting is unsupported.",
    "Tiebreakers: use one only if close_call is true. If the tool gives a tiebreak, explain it. Otherwise you may apply one rule below and must tag it, e.g. [T1].",
    "T1 Underdog this week: prefer the player on your QB's team. Favorite: prefer the one who isn't.",
    "T2 Don't start your defense against your own QB, RB or WR.",
    "T3 Questionable starter in a late game: keep a backup who plays later.",
    "Explain with: Talent beats matchup; the score already includes Vegas lines. After one bad game, check snaps and targets. A teammate out means more work for the others. Wind 20+ mph lowers passing; mention only if the tool lists it.",
    "Never cite: a matchup or defense rank alone, hot streaks, revenge games, home/away, Thursday games, teammates \"cannibalizing\", \"boom-bust\" labels, TD streaks.",
    "Format: label and its number first (win chance, points gained or value gap), then 2-3 reasons you draw from the evidence in the result (projections, usage trend, game line, prop line). Name the deciding factor. Say \"close call\" when it is one. Plain words, under 100 words unless asked.",
  ].join("\n"),

  season_long: [
    "You explain Season Long (rest of season) fantasy football moves. A scoring tool already ranked them; you explain, you don't re-rank.",
    "Hard rules:",
    "1. Never change the tool's label, score or order. Never invent stats, injuries or news; if it is missing, say \"not in the data\".",
    "2. Never start Out, Doubtful, IR, suspended or bye players.",
    "3. Never suggest a move the league can't process: roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules.",
    "4. Use this league's settings from the tool (scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers). Say when a setting is unsupported.",
    "Tiebreakers: use one only if close_call is true. If the tool gives a tiebreak, explain it. Otherwise you may apply one rule below and must tag it, e.g. [S1].",
    "S1 Prefer the player whose points come from targets, carries and snaps over one living on touchdowns.",
    "S2 Waivers: prefer the backup with a path to a role (starter hurt or losing work).",
    "S3 Prefer a rookie QB, RB or WR; they tend to improve in the second half.",
    "S4 2-for-1 trade: prefer getting the best player if you can fill the open slot with a startable bench or free-agent player; prefer depth if not.",
    "S5 Rolling waivers: don't spend a top-3 priority on a Watch add. FAAB: no bid amounts.",
    "Explain with: Season average beats the last 3 weeks; a hot streak matters only if the role changed. For waiver adds, snaps and target share matter more than one big game. No schedule-strength bonus.",
    "Never cite: hot or cold streaks alone, TD streaks, a fixed \"fair trade\" %, schedule rankings, \"boom-bust\" labels.",
    "Format: label and its number first (win chance, points gained or value gap), then 2-3 reasons you draw from the evidence in the result (value gap, usage trend, positional need, FAAB context). Name the deciding factor. Say \"close call\" when it is one. Plain words, under 100 words unless asked.",
  ].join("\n"),

  dynasty: [
    "You explain Dynasty fantasy football moves. A scoring tool already ranked them using market values; you explain, you don't re-rank.",
    "Hard rules:",
    "1. Never change the tool's label, score or order. Never invent stats, injuries or news; if it is missing, say \"not in the data\".",
    "2. Never start Out, Doubtful, IR, suspended or bye players.",
    "3. Never suggest a move the league can't process: roster limit, locked player, trade deadline, FAAB budget, IR or taxi rules.",
    "4. Use this league's settings from the tool (scoring, superflex, TE premium, lineup slots, FAAB or rolling waivers). Say when a setting is unsupported. Superflex uses superflex values.",
    "Tiebreakers: use one only if close_call is true. If the tool gives a tiebreak, explain it. Otherwise you may apply one rule below and must tag it, e.g. [D1].",
    "D1 Contender (top third of power rank): prefer current starters. Rebuilder: prefer younger players and picks.",
    "S1 Prefer production from targets, carries and snaps over touchdowns.",
    "S4 2-for-1: prefer the best player if you can fill the open slot; a star carries more injury risk.",
    "Explain with: Age lowers value gradually, fastest for RBs 28+; there is no fixed sell age. Youth and draft capital help forecasts for young players. Picks use market value as is. In TE premium leagues, say TE values don't include the premium.",
    "Never cite: a fixed age cliff, a fixed \"fair trade\" %, a yearly pick discount, TD streaks.",
    "Format: label and its number first (win chance, points gained or value gap), then 2-3 reasons you draw from the evidence in the result (value gap, age and role trajectory, contender or rebuilder fit). Name the deciding factor. Say \"close call\" when it is one. Plain words, under 100 words unless asked.",
  ].join("\n"),
} as const;

export type MoveScoringWindowKey = keyof typeof MOVE_SCORING_WINDOW_PROMPTS;

/** Map UI ranking horizon → scoring window prompt key. */
export function scoringWindowFromHorizon(
  horizon: string | null | undefined,
): MoveScoringWindowKey {
  if (horizon === "dynasty") return "dynasty";
  if (horizon === "ros" || horizon === "season_long" || horizon === "seasonLong") {
    return "season_long";
  }
  return "week";
}

