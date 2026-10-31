/**
 * Publish guard for cached dashboards.
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
}): void {
  if (args.requireComplete && args.rosterFetchFailedLeagueIds.length > 0) {
    throw new IncompleteDashboardBuildError(args.rosterFetchFailedLeagueIds);
  }
}
