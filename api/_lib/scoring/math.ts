/**
 * Shared math for move scoring: normal CDF and projection spread.
 */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** σ = a + b · P* for a skill-position projection. */
export function projectionSigma(pStar: number, a: number, b: number): number {
  return a + b * Math.max(0, pStar);
}

/**
 * Chance player A outscores player B given independent normals.
 * Returns 0–100 (win-the-slot chance).
 */
export function outscoreChance(
  meanA: number,
  sigmaA: number,
  meanB: number,
  sigmaB: number,
): number {
  const spread = Math.sqrt(sigmaA * sigmaA + sigmaB * sigmaB);
  if (spread === 0) {
    if (meanA > meanB) return 100;
    if (meanA < meanB) return 0;
    return 50;
  }
  return Math.min(100, Math.max(0, normalCdf((meanA - meanB) / spread) * 100));
}

/** Chance team A beats team B from means and correlated variances. */
export function lineupWinChance(
  meanA: number,
  varA: number,
  meanB: number,
  varB: number,
  covAB: number,
): number {
  const denom = Math.sqrt(Math.max(0, varA + varB - 2 * covAB));
  if (denom === 0) {
    if (meanA > meanB) return 1;
    if (meanA < meanB) return 0;
    return 0.5;
  }
  const p = normalCdf((meanA - meanB) / denom);
  return Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, p));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
