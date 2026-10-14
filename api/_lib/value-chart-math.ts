/**
 * Pure series helpers for the Monitor Value chart: rolling averages and a
 * dampened forward trend cone. Shared by the UI and unit tests.
 */

export type ValueChartPoint = { date: string; value: number };

export type TrendConePoint = {
  date: string;
  center: number;
  low: number;
  high: number;
};

/** 80% two-sided normal interval ≈ ±1.28σ. */
export const TREND_CONE_Z = 1.28;
export const TREND_CONE_PHI = 0.9;
export const TREND_CONE_HORIZON_DAYS = 30;
export const TREND_CONE_LOOKBACK_DAYS = 30;

/** Add `days` to a YYYY-MM-DD UTC calendar date. */
export function addUtcDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

/**
 * Trailing simple moving average. Index `i` is null until `window` finite
 * values are available ending at `i`.
 */
export function movingAverage(
  values: ReadonlyArray<number | null | undefined>,
  window: number,
): Array<number | null> {
  if (!Number.isInteger(window) || window < 1) {
    throw new Error("movingAverage window must be a positive integer");
  }
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < window) {
      out.push(null);
      continue;
    }
    let sum = 0;
    let ok = true;
    for (let j = i - window + 1; j <= i; j += 1) {
      const value = values[j];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        ok = false;
        break;
      }
      sum += value;
    }
    out.push(ok ? sum / window : null);
  }
  return out;
}

/** Ordinary least-squares slope of `values` against index 0..n-1. */
export function linearSlope(values: ReadonlyArray<number>): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i += 1) {
    const y = values[i];
    if (typeof y !== "number" || !Number.isFinite(y)) return 0;
    sumX += i;
    sumY += y;
    sumXX += i * i;
    sumXY += i * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Sample standard deviation of consecutive daily changes. */
export function dailyChangeStdDev(values: ReadonlyArray<number>): number {
  if (values.length < 2) return 0;
  const changes: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const next = values[i];
    if (
      typeof prev !== "number"
      || typeof next !== "number"
      || !Number.isFinite(prev)
      || !Number.isFinite(next)
    ) {
      return 0;
    }
    changes.push(next - prev);
  }
  if (changes.length < 2) return 0;
  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const variance =
    changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (changes.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Geometric partial sum φ + φ² + … + φʰ = φ (1 − φʰ) / (1 − φ).
 * When φ = 1, the sum is simply h.
 */
export function dampenedDriftFactor(phi: number, horizon: number): number {
  if (horizon <= 0) return 0;
  if (phi === 1) return horizon;
  return (phi * (1 - phi ** horizon)) / (1 - phi);
}

/**
 * 30-day forward dampened trend cone.
 *
 * Slope is the linear fit of the last `lookback` daily values. Day-h center is
 * today's value + slope × Σ_{k=1..h} φ^k. Band is an 80% interval
 * ± z · σ · √h where σ is the stdev of daily changes over the lookback.
 * All outputs are clamped at 0.
 */
export function dampenedTrendCone(
  points: ReadonlyArray<ValueChartPoint>,
  options: {
    horizon?: number;
    phi?: number;
    z?: number;
    lookback?: number;
  } = {},
): TrendConePoint[] {
  const horizon = options.horizon ?? TREND_CONE_HORIZON_DAYS;
  const phi = options.phi ?? TREND_CONE_PHI;
  const z = options.z ?? TREND_CONE_Z;
  const lookback = options.lookback ?? TREND_CONE_LOOKBACK_DAYS;
  if (points.length === 0 || horizon < 1) return [];

  const recent = points.slice(-lookback);
  // Slope/σ treat adjacent samples as one calendar day; skip when history gaps.
  const hasGap = recent.some((point, index) => {
    const previous = recent[index - 1];
    return previous !== undefined && addUtcDateKey(previous.date, 1) !== point.date;
  });
  if (hasGap) return [];
  const values = recent.map((point) => point.value);
  const slope = linearSlope(values);
  const sigma = dailyChangeStdDev(values);
  const today = points[points.length - 1];
  if (!today) return [];

  const cone: TrendConePoint[] = [];
  for (let h = 1; h <= horizon; h += 1) {
    const center = Math.max(0, today.value + slope * dampenedDriftFactor(phi, h));
    const halfWidth = z * sigma * Math.sqrt(h);
    const low = Math.max(0, center - halfWidth);
    const high = Math.max(0, center + halfWidth);
    cone.push({
      date: addUtcDateKey(today.date, h),
      center,
      low,
      high,
    });
  }
  return cone;
}
