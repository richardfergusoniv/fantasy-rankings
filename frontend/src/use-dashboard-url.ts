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
    const current = stateRef.current;
    const next = { ...current, ...patch };
    if (dashboardUrlHistoryMode(current, next) === "none") return;
    // Only a change of view animates: a tab switch, or a Draft room switch
    // (the Draft subview bar is the one subview that is not itself a tab).
    // Filter, selection, league and overlay commits apply as before.
    const viewChanges = next.tab !== current.tab || next.draftRoom !== current.draftRoom;
    const apply = () => {
      // Recompute against the latest state: a transition callback runs a
      // frame later, and another commit may have landed in between.
      const latest = stateRef.current;
      const applied = { ...latest, ...patch };
      const action = dashboardUrlHistoryMode(latest, applied);
      if (action === "none") return;
      writeHistory(applied, action, opensByPush(action, latest, applied));
      stateRef.current = applied;
      setState(applied);
    };
    if (viewChanges) withViewTransition(apply);
    else apply();
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
