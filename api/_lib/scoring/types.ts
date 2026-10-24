import type { SkillPosition } from "./weights.js";

export type ScoringWindow = "week" | "season_long" | "dynasty";

export type ScoreReason = {
  factor: string;
  source: string;
  effect: string;
};

export type TiebreakResult = {
  rule: string;
  pickBefore: string;
  pickAfter: string;
};

export type WindowScore = {
  score: number;
  label: string;
  metric: string;
  reasons: ScoreReason[];
  closeCall?: boolean;
  tiebreak?: TiebreakResult;
};

export type StartSitResult = {
  week: WindowScore;
};

export type WaiverResult = {
  week: WindowScore;
  seasonLong: WindowScore;
  dynasty?: WindowScore;
};

export type TradeResult = {
  week: WindowScore;
  seasonLong: WindowScore;
  dynasty?: WindowScore;
  fairness?: {
    z: number;
    band: "Fair" | "Uneven" | "Lopsided";
    gap: number;
    gapPct: number;
  };
};

export type ScoredPlayer = {
  playerId: string;
  name: string;
  position: string;
  team?: string | null;
  /** League-scored Vegas (or primary board) projection V. */
  vegasProjection?: number | null;
  /** League-scored usage projection U. */
  usageProjection?: number | null;
  /** Games of usage history available for the blend. */
  usageGames?: number;
  injuryStatus?: string | null;
  isBye?: boolean;
  gamePhase?: "pregame" | "live" | "final" | null;
  /** Vacated teammate target-share points (already in fantasy points units × 10 scale). */
  vacatedTargetSharePts?: number;
  vacatedCarriesPerGame?: number;
  /** Age / draft capital term inputs (RB Week N / Dynasty). */
  ageYears?: number | null;
  draftCapital?: number | null;
  /** FantasyCalc redraft value rank for no-Vegas fallback. */
  redraftValueRank?: number | null;
  /** Optional target share for WR1/WR2 ranking within a team. */
  targetShare?: number | null;
  projection?: number | null;
  actual?: number | null;
  lineupSlot?: string | null;
  isStarter?: boolean;
  gameTime?: string | null;
};

export type PositionNeedMap = Partial<Record<SkillPosition, number>>;
