/**
 * Freshness/status model for the dashboard header strip.
 *
 * The API already records `status: "partial"`, `sourceErrors`, `asOf` (our
 * build time), `rankingsAsOf` (projection snapshot time), and
 * `fantasyCalcAsOf` (market value pull time). This module turns that into the
 * compact labels the shell shows, so stale/partial data never appears without
 * an explanation. Kept free of React so vitest can cover the source-failure
 * cases without mounting the app.
 */

export const PROJECTION_ESTIMATE_MARK = "*";

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
  rankings?: ReadonlyArray<{ projectionSource?: string | null }>;
  defenses?: ReadonlyArray<{ projectionSource?: string | null }>;
  leagues?: ReadonlyArray<{
    starters?: ReadonlyArray<{ projectionSource?: string | null }>;
    bench?: ReadonlyArray<{ projectionSource?: string | null }>;
    opponentTeam?: {
      starters?: ReadonlyArray<{ projectionSource?: string | null }>;
      bench?: ReadonlyArray<{ projectionSource?: string | null }>;
    } | null;
    tradeTeams?: ReadonlyArray<{ players?: ReadonlyArray<{ projectionSource?: string | null }> }>;
  }>;
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
  /** True when any visible projection is a fallback estimate (marked *). */
  hasEstimates: boolean;
};

function shortDate(value: string): string | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(time);
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
  const when = shortDate(asOf);
  return when ? `Updated ${when}` : null;
}

function rowIsEstimate(row: { projectionSource?: string | null }): boolean {
  // "fallback" is the builder's marker for a computed estimate; "sleeper" and
  // "vegas"/"first_down" are real source projections and stay unmarked.
  return row.projectionSource === "fallback";
}

export function dashboardHasEstimatedProjections(input: Pick<FreshnessInput, "rankings" | "defenses" | "leagues">): boolean {
  if ((input.rankings ?? []).some(rowIsEstimate)) return true;
  if ((input.defenses ?? []).some(rowIsEstimate)) return true;
  return (input.leagues ?? []).some((league) => {
    const pools: ReadonlyArray<ReadonlyArray<{ projectionSource?: string | null }>> = [
      league.starters ?? [],
      league.bench ?? [],
      league.opponentTeam?.starters ?? [],
      league.opponentTeam?.bench ?? [],
      (league.tradeTeams ?? []).flatMap((team) => team.players ?? []),
    ];
    return pools.some((rows) => rows.some(rowIsEstimate));
  });
}

export function dashboardFreshness(input: FreshnessInput, nowMs: number): DashboardFreshness {
  const sourceLabels: string[] = [];
  const rankingsWhen = input.rankingsAsOf ? shortDate(input.rankingsAsOf) : null;
  const calcWhen = input.fantasyCalcAsOf ? shortDate(input.fantasyCalcAsOf) : null;
  if (rankingsWhen) sourceLabels.push(`Rankings ${rankingsWhen}`);
  if (calcWhen) sourceLabels.push(`Values ${calcWhen}`);
  return {
    updatedLabel: updatedAgoLabel(input.asOf, nowMs),
    sourceLabels,
    partial: input.status === "partial" || input.sourceErrors.length > 0,
    notes: input.sourceErrors,
    hasEstimates: dashboardHasEstimatedProjections(input),
  };
}
