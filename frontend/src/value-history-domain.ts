/**
 * Shared x-axis domain helpers for FantasyCalc value-history charts.
 * Start at the first real (>0) date in the continuous series; drop isolated
 * early outliers separated by a large calendar gap so redraft charts do not
 * pad empty January–April space.
 */

export const VALUE_HISTORY_OUTLIER_GAP_DAYS = 30;

export function isRealValueHistoryValue(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Whole UTC calendar days from `earlier` to `later` (YYYY-MM-DD). */
export function utcDateKeyDiffDays(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00.000Z`);
  const end = Date.parse(`${later}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Among ascending dates that carry real values, return the start of the final
 * continuous cluster (drop leading runs separated by gaps > `maxGapDays`).
 */
export function continuousValueHistoryStartDate(
  realDatesAscending: readonly string[],
  maxGapDays: number = VALUE_HISTORY_OUTLIER_GAP_DAYS,
): string | null {
  if (realDatesAscending.length === 0) return null;
  let startIndex = 0;
  for (let index = 0; index < realDatesAscending.length - 1; index += 1) {
    const current = realDatesAscending[index];
    const next = realDatesAscending[index + 1];
    if (current === undefined || next === undefined) continue;
    if (utcDateKeyDiffDays(current, next) > maxGapDays) {
      startIndex = index + 1;
    }
  }
  return realDatesAscending[startIndex] ?? null;
}

/** Collect sorted unique dates where any series has a real (>0) value. */
export function realValueHistoryDates(
  seriesList: ReadonlyArray<ReadonlyArray<{ date: string; value: number | null | undefined }>>,
): string[] {
  const dates = new Set<string>();
  for (const series of seriesList) {
    for (const point of series) {
      if (isRealValueHistoryValue(point.value)) dates.add(point.date);
    }
  }
  return [...dates].sort();
}

/**
 * Earliest continuous-series start across one or more plotted series.
 * Ignores isolated early outliers separated by large gaps.
 */
export function continuousStartAmongValueSeries(
  seriesList: ReadonlyArray<ReadonlyArray<{ date: string; value: number | null | undefined }>>,
  maxGapDays: number = VALUE_HISTORY_OUTLIER_GAP_DAYS,
): string | null {
  return continuousValueHistoryStartDate(realValueHistoryDates(seriesList), maxGapDays);
}

/** Drop points strictly before `startDate` (inclusive keep). */
export function sliceValueHistoryFromDate<T extends { date: string }>(
  points: readonly T[],
  startDate: string | null,
): T[] {
  if (!startDate) return [...points];
  return points.filter((point) => point.date >= startDate);
}

/**
 * Trim a single series to its continuous real-value window (leading non-positive
 * values and early gap outliers removed). After this, consecutive real points
 * are at most `maxGapDays` apart, so charts should not draw across a large gap.
 */
export function trimValueHistoryToContinuousStart<T extends { date: string; value: number }>(
  points: readonly T[],
  maxGapDays: number = VALUE_HISTORY_OUTLIER_GAP_DAYS,
): T[] {
  const firstPositive = points.findIndex((point) => isRealValueHistoryValue(point.value));
  if (firstPositive < 0) return [];
  const fromPositive = points.slice(firstPositive);
  const startDate = continuousStartAmongValueSeries([fromPositive], maxGapDays);
  return sliceValueHistoryFromDate(fromPositive, startDate);
}
