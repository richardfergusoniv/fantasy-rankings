/**
 * Correlated lineup win chance from the pair-correlation table.
 * Pure module — importable from api/_lib and the browser.
 */

import { lineupWinChance, projectionSigma } from "./math.js";
import { applyInjuryToProjection } from "./injury.js";
import {
  BUILTIN_SCORING_WEIGHTS,
  SCORING_CONSTANTS,
  type ScoringWeightsParams,
  type SkillPosition,
} from "./weights.js";

export type WinChancePlayer = {
  playerId: string;
  name?: string;
  position: string;
  team?: string | null;
  /** Blended or league projection used as P*. */
  pStar: number;
  opponentTeam?: string | null;
  injuryStatus?: string | null;
  isBye?: boolean;
  gamePhase?: "pregame" | "live" | "final" | null;
  actual?: number | null;
  /** Team target-share rank among WRs (1 = WR1). */
  wrRankOnTeam?: 1 | 2 | null;
  /** Team RB rank by carries / opportunity (1 = RB1). */
  rbRankOnTeam?: 1 | 2 | null;
  /** True when this is the team's TE1. */
  isTe1?: boolean;
  activeAtKickoff?: boolean;
};

type Role = "QB" | "WR1" | "WR2" | "TE1" | "RB1" | "RB2" | "DST" | "OTHER";

function roleOf(player: WinChancePlayer): Role {
  const pos = player.position.toUpperCase();
  if (pos === "QB") return "QB";
  if (pos === "DST" || pos === "DEF") return "DST";
  if (pos === "TE") return player.isTe1 === false ? "OTHER" : "TE1";
  if (pos === "WR") {
    if (player.wrRankOnTeam === 2) return "WR2";
    return "WR1";
  }
  if (pos === "RB") {
    if (player.rbRankOnTeam === 2) return "RB2";
    return "RB1";
  }
  return "OTHER";
}

const SAME_TEAM = SCORING_CONSTANTS.win_chance.pair_correlations.same_team as Record<string, number>;
const OPPOSING = SCORING_CONSTANTS.win_chance.pair_correlations.opposing_in_same_game as Record<string, number>;
const DST_VS = SCORING_CONSTANTS.win_chance.pair_correlations.dst_vs_offense_it_faces as Record<string, number>;
const DEFAULT_RHO = SCORING_CONSTANTS.win_chance.pair_correlations.default;

function pairKey(a: Role, b: Role): string {
  return `${a}-${b}`;
}

/**
 * ρ for a player pair. Same-team and opposing-game pairs from constants;
 * everything else is 0.
 */
export function pairCorrelation(
  a: WinChancePlayer,
  b: WinChancePlayer,
): number {
  if (a.playerId === b.playerId) return 1;
  const roleA = roleOf(a);
  const roleB = roleOf(b);
  const teamA = (a.team ?? "").toUpperCase();
  const teamB = (b.team ?? "").toUpperCase();
  const oppA = (a.opponentTeam ?? "").toUpperCase();
  const oppB = (b.opponentTeam ?? "").toUpperCase();

  const sameTeam = Boolean(teamA && teamB && teamA === teamB);
  const opposingGame =
    Boolean(teamA && teamB && teamA !== teamB)
    && ((oppA && oppA === teamB) || (oppB && oppB === teamA) || (oppA && oppA === oppB));

  if (sameTeam) {
    const direct = SAME_TEAM[pairKey(roleA, roleB)] ?? SAME_TEAM[pairKey(roleB, roleA)];
    if (typeof direct === "number") return direct;
    return DEFAULT_RHO;
  }

  if (opposingGame) {
    if (roleA === "DST" && (roleB === "QB" || roleB === "RB1" || roleB === "RB2" || roleB === "WR1" || roleB === "WR2")) {
      const key = roleB === "QB" ? "QB" : roleB.startsWith("RB") ? "RB" : "WR";
      return DST_VS[key] ?? DEFAULT_RHO;
    }
    if (roleB === "DST" && (roleA === "QB" || roleA === "RB1" || roleA === "RB2" || roleA === "WR1" || roleA === "WR2")) {
      const key = roleA === "QB" ? "QB" : roleA.startsWith("RB") ? "RB" : "WR";
      return DST_VS[key] ?? DEFAULT_RHO;
    }
    const direct = OPPOSING[pairKey(roleA, roleB)] ?? OPPOSING[pairKey(roleB, roleA)];
    if (typeof direct === "number") return direct;
    return DEFAULT_RHO;
  }

  return DEFAULT_RHO;
}

function momentsFor(
  player: WinChancePlayer,
  weights: ScoringWeightsParams,
): { mean: number; sigma: number } {
  const pos = player.position.toUpperCase();
  if (pos === "K" || pos === "DST" || pos === "DEF") {
    const a = 4;
    const b = 0.4;
    const sigma = projectionSigma(player.pStar, a, b);
    return { mean: player.pStar, sigma };
  }
  const applied = applyInjuryToProjection(player.pStar, player.position, {
    injuryStatus: player.injuryStatus,
    isBye: player.isBye,
    gamePhase: player.gamePhase,
    actual: player.actual,
    weights,
    activeAtKickoff: player.activeAtKickoff,
  });
  return { mean: applied.mean, sigma: applied.sigma };
}

export type LineupVarianceResult = {
  mean: number;
  variance: number;
  players: Array<{ playerId: string; mean: number; sigma: number }>;
};

export function lineupVariance(
  players: readonly WinChancePlayer[],
  weights: ScoringWeightsParams = BUILTIN_SCORING_WEIGHTS,
): LineupVarianceResult {
  const moments = players.map((player) => {
    const m = momentsFor(player, weights);
    return { player, ...m };
  });
  let mean = 0;
  let variance = 0;
  for (const row of moments) {
    mean += row.mean;
    variance += row.sigma * row.sigma;
  }
  for (let i = 0; i < moments.length; i += 1) {
    for (let j = i + 1; j < moments.length; j += 1) {
      const a = moments[i]!;
      const b = moments[j]!;
      const rho = pairCorrelation(a.player, b.player);
      variance += 2 * rho * a.sigma * b.sigma;
    }
  }
  return {
    mean,
    variance: Math.max(0, variance),
    players: moments.map((row) => ({
      playerId: row.player.playerId,
      mean: row.mean,
      sigma: row.sigma,
    })),
  };
}

export function lineupCovariance(
  yours: readonly WinChancePlayer[],
  opponent: readonly WinChancePlayer[],
  weights: ScoringWeightsParams = BUILTIN_SCORING_WEIGHTS,
): number {
  const yoursM = yours.map((player) => ({ player, ...momentsFor(player, weights) }));
  const oppM = opponent.map((player) => ({ player, ...momentsFor(player, weights) }));
  let cov = 0;
  for (const a of yoursM) {
    for (const b of oppM) {
      cov += pairCorrelation(a.player, b.player) * a.sigma * b.sigma;
    }
  }
  return cov;
}

/**
 * P(yours beat opponent) with closed-form correlated normals.
 * Returns 0–1.
 */
export function correlatedWinProbability(
  yours: readonly WinChancePlayer[],
  opponent: readonly WinChancePlayer[],
  weights: ScoringWeightsParams = BUILTIN_SCORING_WEIGHTS,
): number {
  const y = lineupVariance(yours, weights);
  const o = lineupVariance(opponent, weights);
  const cov = lineupCovariance(yours, opponent, weights);
  return lineupWinChance(y.mean, y.variance, o.mean, o.variance, cov);
}

/** Assign WR1/WR2 ranks from target share within each NFL team. */
export function assignWrRanksByTargetShare<T extends { team?: string | null; position: string; targetShare?: number | null }>(
  players: T[],
): Array<T & { wrRankOnTeam: 1 | 2 | null }> {
  const byTeam = new Map<string, T[]>();
  for (const player of players) {
    if (player.position.toUpperCase() !== "WR") continue;
    const team = (player.team ?? "").toUpperCase();
    if (!team) continue;
    const list = byTeam.get(team) ?? [];
    list.push(player);
    byTeam.set(team, list);
  }
  const rank = new Map<T, 1 | 2 | null>();
  for (const list of byTeam.values()) {
    const sorted = [...list].sort((a, b) => (b.targetShare ?? 0) - (a.targetShare ?? 0));
    sorted.forEach((player, index) => {
      if (index === 0) rank.set(player, 1);
      else if (index === 1) rank.set(player, 2);
      else rank.set(player, null);
    });
  }
  return players.map((player) => ({
    ...player,
    wrRankOnTeam: rank.get(player) ?? null,
  }));
}

export function skillSigma(
  position: SkillPosition,
  pStar: number,
  weights: ScoringWeightsParams = BUILTIN_SCORING_WEIGHTS,
): number {
  return projectionSigma(pStar, weights.spreadA[position], weights.spreadB[position]);
}
