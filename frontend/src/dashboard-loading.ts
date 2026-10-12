/**
 * Pure loading-shell guards for the streamed dashboard. Kept free of React so
 * vitest can cover "trade slower than team" without mounting App.
 */

export type ProgressiveShellInput = {
  hasDashboard: boolean;
  metaPending: boolean;
  teamPending: boolean;
  waitingForFirstBuild: boolean;
  firstBuildTimedOut: boolean;
  tradeSectionWaiting: boolean;
  tradeWaiverWaiting: boolean;
};

/**
 * True when the progressive loading shell should show instead of the empty /
 * error screen. Trade (and league-mode waiver) waits must be included: those
 * sections normally land after meta/team, and without them `hasDashboard` is
 * false until trade resolves (streamed assemble withholds).
 */
export function shouldShowProgressiveShell(input: ProgressiveShellInput): boolean {
  if (input.hasDashboard) return false;
  return input.metaPending
    || input.teamPending
    || input.tradeSectionWaiting
    || input.tradeWaiverWaiting
    || (input.waitingForFirstBuild && !input.firstBuildTimedOut);
}

export type SectionWaitingInput = {
  active: boolean;
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  /** True when the query has returned a non-null section payload. */
  hasPayload: boolean;
  dataUndefined: boolean;
};

/** Waiting for a lazily loaded dashboard section that must land before UI. */
export function isSectionWaiting(input: SectionWaitingInput): boolean {
  if (!input.active || input.isError) return false;
  return input.isPending
    || input.dataUndefined
    || (input.isFetching && !input.hasPayload);
}
