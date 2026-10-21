import { useCallback, useEffect, useRef, useState } from "react";
import {
  dashboardUrlHistoryMode,
  parseDashboardSearch,
  serializeDashboardSearch,
  type DashboardUrlState,
} from "./dashboard-url";

function currentAddress(search: string): string {
  return `${window.location.pathname}${search}${window.location.hash}`;
}

/**
 * Entries that opened the matchup dialog carry this flag in `history.state`, so closing it can step back only
 * when there is a dialog-less entry to step back to. It survives a reload; a link landed on directly lacks it.
 */
function openedMatchupByPush(): boolean {
  return (window.history.state as { matchupOpenedByPush?: boolean } | null)?.matchupOpenedByPush === true;
}

function writeHistory(next: DashboardUrlState, mode: "push" | "replace", matchupOpenedByPush = false): void {
  const url = currentAddress(serializeDashboardSearch(next));
  // Edits made while the dialog is open replace its entry; keep the flag on it.
  const flagged = matchupOpenedByPush || (mode === "replace" && next.matchup !== null && openedMatchupByPush());
  const state = flagged ? { ...next, matchupOpenedByPush: true } : next;
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}

export function useDashboardUrl() {
  const [state, setState] = useState<DashboardUrlState>(() => parseDashboardSearch(window.location.search));
  const stateRef = useRef(state);
  const sheetFromPush = useRef(false);
  const matchupFromPush = useRef(false);

  useEffect(() => {
    const parsed = parseDashboardSearch(window.location.search);
    const nextUrl = currentAddress(serializeDashboardSearch(parsed));
    const currentUrl = currentAddress(window.location.search);
    if (nextUrl !== currentUrl || window.history.state == null) writeHistory(parsed, "replace");
    stateRef.current = parsed;
    matchupFromPush.current = parsed.matchup !== null && openedMatchupByPush();
    setState(parsed);

    const onPop = () => {
      const next = parseDashboardSearch(window.location.search);
      sheetFromPush.current = next.playerId !== null;
      matchupFromPush.current = next.matchup !== null && openedMatchupByPush();
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const commit = useCallback((patch: Partial<DashboardUrlState>) => {
    const current = stateRef.current;
    const next = { ...current, ...patch };
    const action = dashboardUrlHistoryMode(current, next);
    if (action === "none") return;
    const opensMatchup = action === "push" && current.matchup === null && next.matchup !== null;
    writeHistory(next, action, opensMatchup);
    if (current.playerId !== next.playerId) sheetFromPush.current = next.playerId !== null && action === "push";
    if ((current.matchup === null) !== (next.matchup === null)) matchupFromPush.current = opensMatchup;
    stateRef.current = next;
    setState(next);
  }, []);

  const closePlayer = useCallback(() => {
    if (sheetFromPush.current) {
      sheetFromPush.current = false;
      window.history.back();
      return;
    }
    const current = stateRef.current;
    if (!current.playerId) return;
    const next = { ...current, playerId: null };
    writeHistory(next, "replace");
    stateRef.current = next;
    setState(next);
  }, []);

  /** Close the matchup dialog: step back if opening it added a history entry, else clear it in place. */
  const closeMatchup = useCallback(() => {
    if (matchupFromPush.current) {
      matchupFromPush.current = false;
      window.history.back();
      return;
    }
    const current = stateRef.current;
    if (!current.matchup) return;
    const next = { ...current, matchup: null };
    writeHistory(next, "replace");
    stateRef.current = next;
    setState(next);
  }, []);

  return { state, commit, closePlayer, closeMatchup };
}
