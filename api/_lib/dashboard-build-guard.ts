/**
 * Publish guard and build-budget rules for cached dashboards.
 *
 * A build that dropped a league because its roster fetch failed (after
 * retries) must not overwrite a cached snapshot that still has that
 * league: stale-and-complete beats fresh-and-missing-a-league, and the
 * caller's fallback keeps serving the complete snapshot. A cold build
 * (no snapshot to protect) publishes what it has, since partial data
 * beats none. League membership changes do not trip this guard — a
 * league the user left is never attempted, so it never appears in
 * `rosterFetchFailedLeagueIds`.
 */

export class IncompleteDashboardBuildError extends Error {
  readonly rosterFetchFailedLeagueIds: readonly string[];

  constructor(leagueIds: readonly string[]) {
    super(`Dashboard build incomplete: rosters unavailable for league(s) ${leagueIds.join(", ")}`);
    this.name = "IncompleteDashboardBuildError";
    this.rosterFetchFailedLeagueIds = leagueIds;
  }
}

export function assertDashboardBuildPublishable(args: {
  requireComplete: boolean;
  rosterFetchFailedLeagueIds: readonly string[];
  /**
   * The leagues present in the cached snapshot this build would
   * replace. Only their failures block publishing: a league joined
   * after the snapshot was taken has nothing stored to protect, so its
   * failure must not hold the other leagues' fresh data hostage to a
   * stale snapshot. When omitted, every failure blocks (the behavior
   * for callers that do not know the snapshot's leagues).
   */
  protectedLeagueIds?: readonly string[];
}): void {
  if (!args.requireComplete) return;
  const protectedSet = args.protectedLeagueIds ? new Set(args.protectedLeagueIds) : null;
  const blocking = protectedSet
    ? args.rosterFetchFailedLeagueIds.filter((leagueId) => protectedSet.has(leagueId))
    : args.rosterFetchFailedLeagueIds;
  if (blocking.length > 0) {
    throw new IncompleteDashboardBuildError(blocking);
  }
}

/**
 * A retry that cannot finish inside the caller's remaining budget is not
 * worth starting: below this much time left, a forced load should skip
 * straight to its fallback so the fallback itself still has time to run.
 */
export const MIN_BUILD_RETRY_BUDGET_MS = 5_000;

/**
 * The build budget for one attempt of a load, against ONE shared request
 * deadline. A forced load retries its build once, but both attempts draw
 * from the same deadline (the build budget inside the function's
 * maxDuration): two full back-to-back build windows could exceed the
 * platform cap and the client's deadline, and the request would die
 * before reaching its fallback. Returns null when a retry should not
 * start at all (too little budget remains).
 */
export function buildRetryBudgetMs(args: {
  requestDeadlineAtMs: number;
  nowMs: number;
  attempt: number;
}): number | null {
  const remainingMs = args.requestDeadlineAtMs - args.nowMs;
  if (args.attempt > 0 && remainingMs < MIN_BUILD_RETRY_BUDGET_MS) return null;
  return Math.max(0, remainingMs);
}
