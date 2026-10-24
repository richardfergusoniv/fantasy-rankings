/**
 * Freshness/status model for the dashboard (the partial-data notes under the
 * header use it).
 *
 * The API already records `status: "partial"`, `sourceErrors`, `asOf` (our
 * build time), `rankingsAsOf` (projection snapshot time), and
 * `fantasyCalcAsOf` (market value pull time). This module turns that into the
 * compact labels the shell shows, so stale/partial data never appears without
 * an explanation. Kept free of React so vitest can cover the source-failure
 * cases without mounting the app.
 */

/** Minimal shape — anything with these fields works (Dashboard satisfies it). */
export type FreshnessInput = {
  status: "ok" | "partial";
  /** Our build/snapshot time (ISO). */
  asOf: string;
  /** Projection-source snapshot time, when known (ISO). */
  rankingsAsOf: string | null;
  /** FantasyCalc market-value pull time, when known (ISO). */
  fantasyCalcAsOf: string | null;
  /** Backend explanations of what is unavailable or fell back. */
  sourceErrors: string[];
};

export type DashboardFreshness = {
  /** "Updated 3m ago" — our build/snapshot time, null when asOf is unparsable. */
  updatedLabel: string | null;
  /** Underlying source times, e.g. ["Rankings Oct 24", "Values Oct 23"]. */
  sourceLabels: string[];
  /** True when the build recorded partial failures. */
  partial: boolean;
  /** What is unavailable / fell back, straight from the build. */
  notes: string[];
};

/** "Oct 24", or "Oct 24, 2025" when it isn't the current year (old data must look old). */
function shortDate(value: string, nowMs: number): string | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  const sameYear = new Date(time).getFullYear() === new Date(nowMs).getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }).format(time);
}

/** "Updated just now" / "Updated Nm ago" / "Updated Nh ago" / "Updated Oct 24". */
export function updatedAgoLabel(asOf: string, nowMs: number): string | null {
  const time = new Date(asOf).getTime();
  if (!Number.isFinite(time)) return null;
  const diffMs = Math.max(0, nowMs - time);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const when = shortDate(asOf, nowMs);
  return when ? `Updated ${when}` : null;
}

export function dashboardFreshness(input: FreshnessInput, nowMs: number): DashboardFreshness {
  const sourceLabels: string[] = [];
  const rankingsWhen = input.rankingsAsOf ? shortDate(input.rankingsAsOf, nowMs) : null;
  const calcWhen = input.fantasyCalcAsOf ? shortDate(input.fantasyCalcAsOf, nowMs) : null;
  if (rankingsWhen) sourceLabels.push(`Rankings ${rankingsWhen}`);
  if (calcWhen) sourceLabels.push(`Values ${calcWhen}`);
  return {
    updatedLabel: updatedAgoLabel(input.asOf, nowMs),
    sourceLabels,
    partial: input.status === "partial" || input.sourceErrors.length > 0,
    notes: input.sourceErrors,
  };
}
