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

function writeHistory(next: DashboardUrlState, mode: "push" | "replace"): void {
  const url = currentAddress(serializeDashboardSearch(next));
  if (mode === "push") window.history.pushState(next, "", url);
  else window.history.replaceState(next, "", url);
}

export function useDashboardUrl() {
  const [state, setState] = useState<DashboardUrlState>(() => parseDashboardSearch(window.location.search));
  const stateRef = useRef(state);
  const sheetFromPush = useRef(false);

  useEffect(() => {
    const parsed = parseDashboardSearch(window.location.search);
    const nextUrl = currentAddress(serializeDashboardSearch(parsed));
    const currentUrl = currentAddress(window.location.search);
    if (nextUrl !== currentUrl || window.history.state == null) writeHistory(parsed, "replace");
    stateRef.current = parsed;
    setState(parsed);

    const onPop = () => {
      const next = parseDashboardSearch(window.location.search);
      sheetFromPush.current = next.playerId !== null;
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
    writeHistory(next, action);
    if (current.playerId !== next.playerId) sheetFromPush.current = next.playerId !== null && action === "push";
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

  return { state, commit, closePlayer };
}
