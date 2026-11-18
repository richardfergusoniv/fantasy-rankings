import { useCallback, useEffect, useRef, useState } from "react";
import {
  dashboardUrlHistoryMode,
  parseDashboardSearch,
  serializeDashboardSearch,
  type DashboardUrlState,
} from "./dashboard-url";
import { flagsForWrite, historyStateFor, NOT_PUSHED, opensByPush, readOpenedByPush, type OpenedByPush } from "./history-ownership";
import { withViewTransition } from "./view-transition";

function currentAddress(search: string): string {
  return `${window.location.pathname}${search}${window.location.hash}`;
}

function writeHistory(next: DashboardUrlState, mode: "push" | "replace", opens: OpenedByPush = NOT_PUSHED): void {
  const url = currentAddress(serializeDashboardSearch(next));
  const state = historyStateFor(next, flagsForWrite(mode, readOpenedByPush(window.history.state), next, opens));
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}

type CommitDeps = {
  /** The newest requested state. Updated at commit time, before any animated render. */
  intended: { current: DashboardUrlState };
  render: (state: DashboardUrlState) => void;
  writeHistory: (next: DashboardUrlState, mode: "push" | "replace", opens: OpenedByPush) => void;
  animate: (update: () => void) => void;
};

/**
 * Apply one URL commit. The history entry and the intended state change at
 * once, so a second commit (or Back) before an animation's callback compares
 * against what was just asked for, not against what is still on screen. Only
 * the render waits for the view transition, and it reads the intended state
 * when it runs: Team, Rankings, Team in quick succession ends on Team, and a
 * Back pressed mid-transition wins instead of being overwritten.
 */
export function commitDashboardUrl(patch: Partial<DashboardUrlState>, deps: CommitDeps): void {
  const current = deps.intended.current;
  const next = { ...current, ...patch };
  const action = dashboardUrlHistoryMode(current, next);
  if (action === "none") return;
  deps.writeHistory(next, action, opensByPush(action, current, next));
  deps.intended.current = next;
  // Only a change of view animates: a tab switch, or a Draft room switch
  // (the Draft subview bar is the one subview that is not itself a tab).
  const viewChanges = next.tab !== current.tab || next.draftRoom !== current.draftRoom;
  if (viewChanges) deps.animate(() => deps.render(deps.intended.current));
  else deps.render(next);
}

export function useDashboardUrl() {
  const [state, setState] = useState<DashboardUrlState>(() => parseDashboardSearch(window.location.search));
  const stateRef = useRef(state);

  useEffect(() => {
    const parsed = parseDashboardSearch(window.location.search);
    const nextUrl = currentAddress(serializeDashboardSearch(parsed));
    const currentUrl = currentAddress(window.location.search);
    if (nextUrl !== currentUrl || window.history.state == null) writeHistory(parsed, "replace");
    stateRef.current = parsed;
    setState(parsed);

    const onPop = () => {
      const next = parseDashboardSearch(window.location.search);
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const commit = useCallback((patch: Partial<DashboardUrlState>) => {
    commitDashboardUrl(patch, {
      intended: stateRef,
      render: setState,
      writeHistory,
      animate: withViewTransition,
    });
  }, []);

  /** Close an overlay: step back if opening it added a history entry, else clear it in place. */
  const closeOverlay = useCallback((overlay: keyof OpenedByPush, clear: Partial<DashboardUrlState>) => {
    if (readOpenedByPush(window.history.state)[overlay]) {
      window.history.back();
      return;
    }
    const next = { ...stateRef.current, ...clear };
    writeHistory(next, "replace");
    stateRef.current = next;
    setState(next);
  }, []);

  const closePlayer = useCallback(() => {
    if (stateRef.current.playerId) closeOverlay("player", { playerId: null });
  }, [closeOverlay]);

  const closeMatchup = useCallback(() => {
    if (stateRef.current.matchup) closeOverlay("matchup", { matchup: null });
  }, [closeOverlay]);

  return { state, commit, closePlayer, closeMatchup };
}
