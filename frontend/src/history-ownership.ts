import type { DashboardUrlState } from "./dashboard-url";

/**
 * Which overlays the current history entry was pushed to open. Closing an overlay steps back only when this is
 * true, because only then is there a dialog-less entry to step back to; a link landed on directly, or an entry
 * reached some other way, is cleared in place instead of leaving the page. The flags live in `history.state`,
 * so they survive a reload and are read back on popstate.
 */
export type OpenedByPush = { player: boolean; matchup: boolean };

export const NOT_PUSHED: OpenedByPush = { player: false, matchup: false };

export function readOpenedByPush(historyState: unknown): OpenedByPush {
  const raw = (historyState as { openedByPush?: Partial<OpenedByPush> } | null | undefined)?.openedByPush;
  return { player: raw?.player === true, matchup: raw?.matchup === true };
}

/** What a commit opens by pushing a new entry (a replace opens nothing). */
export function opensByPush(action: "push" | "replace", current: DashboardUrlState, next: DashboardUrlState): OpenedByPush {
  return {
    player: action === "push" && next.playerId !== null && current.playerId !== next.playerId,
    matchup: action === "push" && current.matchup === null && next.matchup !== null,
  };
}

/**
 * Flags for the entry being written. A push carries only what it opens; a replace edits the entry in place, so
 * the overlays still open keep their flags. An overlay that is closed never keeps one.
 */
export function flagsForWrite(
  mode: "push" | "replace",
  previous: OpenedByPush,
  next: DashboardUrlState,
  opens: OpenedByPush = NOT_PUSHED,
): OpenedByPush {
  const kept = mode === "replace" ? previous : NOT_PUSHED;
  return {
    player: next.playerId !== null && (opens.player || kept.player),
    matchup: next.matchup !== null && (opens.matchup || kept.matchup),
  };
}

/** The object stored in `history.state`: the URL state, plus the flags when any is set. */
export function historyStateFor(next: DashboardUrlState, flags: OpenedByPush): DashboardUrlState | (DashboardUrlState & { openedByPush: OpenedByPush }) {
  return flags.player || flags.matchup ? { ...next, openedByPush: flags } : next;
}
