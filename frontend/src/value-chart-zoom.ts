/** Index where a zoomed value-history window starts (last ~65% of points). */
export function valueChartZoomStartIndex(length: number, zoomed: boolean): number {
  if (!zoomed || length < 4) return 0;
  return Math.floor(length * 0.35);
}

/** Numeric Y domain padded around visible points, or auto when not zoomed. */
export function valueChartYDomain(
  values: readonly number[],
  zoomed: boolean,
): [number, number] | [0, "auto"] {
  if (!zoomed) return [0, "auto"];
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [0, "auto"];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  return [Math.max(0, lo - pad), hi + pad];
}

export type ValueChartRange = "all" | "1y" | "6m" | "3m";

export const VALUE_CHART_RANGES: readonly { id: ValueChartRange; label: string; months: number | null }[] = [
  { id: "3m", label: "3M", months: 3 },
  { id: "6m", label: "6M", months: 6 },
  { id: "1y", label: "1Y", months: 12 },
  { id: "all", label: "All", months: null },
];

/** ISO date `months` calendar months before `isoDate` (UTC), clamping the day to the target month's length. */
function subtractUtcMonths(isoDate: string, months: number): string | null {
  const time = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() - months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Index of the first ISO date (ascending) within `range` of `anchor`, which
 * defaults to the newest date; pass the last historical date when `dates` also
 * holds projection rows. A range that would leave fewer than two points keeps everything.
 */
export function valueChartRangeStartIndex(
  dates: readonly string[],
  range: ValueChartRange,
  anchor: string | undefined = dates[dates.length - 1],
): number {
  const months = VALUE_CHART_RANGES.find((option) => option.id === range)?.months ?? null;
  if (months === null || anchor === undefined) return 0;
  const cutoff = subtractUtcMonths(anchor, months);
  if (cutoff === null) return 0;
  const index = dates.findIndex((date) => date >= cutoff);
  if (index < 0 || dates.length - index < 2) return 0;
  return index;
}
