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

export const VALUE_CHART_RANGES: readonly { id: ValueChartRange; label: string; days: number | null }[] = [
  { id: "3m", label: "3M", days: 92 },
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 366 },
  { id: "all", label: "All", days: null },
];

/**
 * Index of the first ISO date (ascending) within `range` of the newest date.
 * A range that would leave fewer than two points keeps everything.
 */
export function valueChartRangeStartIndex(dates: readonly string[], range: ValueChartRange): number {
  const days = VALUE_CHART_RANGES.find((option) => option.id === range)?.days ?? null;
  const last = dates[dates.length - 1];
  if (days === null || last === undefined) return 0;
  const lastTime = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(lastTime)) return 0;
  const cutoff = lastTime - days * 86_400_000;
  const index = dates.findIndex((date) => Date.parse(`${date}T00:00:00Z`) >= cutoff);
  if (index < 0 || dates.length - index < 2) return 0;
  return index;
}
