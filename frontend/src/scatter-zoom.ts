/** Axis domain for scatter zoom. Zoomed mode uses the central 70% of values. */
export type ScatterDomain = [number, number] | ["auto", "auto"];

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function scatterAxisDomain(values: readonly number[], zoomed: boolean): ScatterDomain {
  if (!zoomed || values.length === 0) return ["auto", "auto"];
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return ["auto", "auto"];
  const lo = percentile(sorted, 0.15);
  const hi = percentile(sorted, 0.85);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}
