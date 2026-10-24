import { SCORING_CONSTANTS, skillOrAll, type ScoringWeightsParams, type SkillPosition } from "./weights.js";
import { projectionSigma } from "./math.js";

const UNAVAILABLE = new Set(
  SCORING_CONSTANTS.injury.unavailable_statuses.map((s) => s.toLowerCase()),
);

export function isUnavailableForScoring(injuryStatus: string | null | undefined): boolean {
  if (!injuryStatus) return false;
  const normalized = injuryStatus.trim().toLowerCase();
  if (UNAVAILABLE.has(normalized)) return true;
  // Accept common Sleeper variants already covered by lineup-optimizer.
  if (normalized === "injured reserve" || normalized === "sus" || normalized === "suspension") return true;
  return false;
}

export function isQuestionable(injuryStatus: string | null | undefined): boolean {
  if (!injuryStatus) return false;
  return injuryStatus.trim().toLowerCase() === "questionable";
}

export type ProjectionMoments = {
  mean: number;
  variance: number;
  sigma: number;
};

/**
 * Apply injury / bye / Questionable rules to a blended P*.
 * Doubtful and other unavailable statuses → mean 0.
 */
export function applyInjuryToProjection(
  pStar: number,
  position: string,
  opts: {
    injuryStatus?: string | null;
    isBye?: boolean;
    gamePhase?: "pregame" | "live" | "final" | null;
    actual?: number | null;
    weights: ScoringWeightsParams;
    /** True once kickoff inactives confirm the player is active. */
    activeAtKickoff?: boolean;
  },
): ProjectionMoments {
  const { weights } = opts;
  const pos = (position === "QB" || position === "RB" || position === "WR" || position === "TE"
    ? position
    : "WR") as SkillPosition;
  const a = weights.spreadA[pos] ?? weights.spreadA.WR;
  const b = weights.spreadB[pos] ?? weights.spreadB.WR;
  const baseSigma = projectionSigma(pStar, a, b);

  if (opts.isBye) return { mean: 0, variance: 0, sigma: 0 };

  if (isUnavailableForScoring(opts.injuryStatus)) {
    // Live Out: actual only (already scored). Otherwise projection 0.
    if (opts.gamePhase === "live" && typeof opts.actual === "number") {
      return { mean: opts.actual, variance: 0, sigma: 0 };
    }
    return { mean: 0, variance: 0, sigma: 0 };
  }

  if (isQuestionable(opts.injuryStatus) && opts.gamePhase !== "final" && opts.gamePhase !== "live") {
    const pPlay = skillOrAll(weights.questionablePPlay, position);
    const m = skillOrAll(weights.questionableM, position);
    if (opts.activeAtKickoff) {
      const mean = m * pStar;
      const sigma = projectionSigma(mean, a, b);
      return { mean, variance: sigma * sigma, sigma };
    }
    const mean = pPlay * m * pStar;
    const sigmaHealthy = baseSigma;
    const variance =
      pPlay * (sigmaHealthy * sigmaHealthy) + pPlay * (1 - pPlay) * (m * pStar) * (m * pStar);
    return { mean, variance, sigma: Math.sqrt(Math.max(0, variance)) };
  }

  return { mean: pStar, variance: baseSigma * baseSigma, sigma: baseSigma };
}
