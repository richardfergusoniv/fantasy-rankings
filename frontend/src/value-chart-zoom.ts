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
