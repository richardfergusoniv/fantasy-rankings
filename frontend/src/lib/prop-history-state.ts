import type { PropHistory } from "../../../api/_lib/prop-line-reads";

/** Unavailable history cannot choose a side; healthy ties still default to over. */
export function propHistoryDirection(history: PropHistory, unavailable: boolean): "over" | "under" | null {
  if (unavailable) return null;
  return history.underRate !== null && (history.hitRate === null || history.underRate > history.hitRate)
    ? "under"
    : "over";
}

/** Explain an ungraded week without confusing missing stats with missing lines. */
export function missingPropWeekLabel(
  week: number,
  weeklyLines: ReadonlyMap<number, number>,
  playedWeeks: ReadonlySet<number>,
  statWeeks: ReadonlySet<number>,
): string {
  if (!statWeeks.has(week) && (weeklyLines.has(week) || playedWeeks.has(week))) return "stats unavailable";
  if (!playedWeeks.has(week)) return "no game";
  return weeklyLines.has(week) ? "stats unavailable" : "no line";
}

type PropHistoryQuery = { state: { data?: { propLines: { weeklyLinesDegraded?: boolean } } } };

/** Keep the board visible while retrying a temporary closing-line failure. */
export function propHistoryRefreshOptions(healthyStaleTime: number) {
  return {
    staleTime: (query: PropHistoryQuery) => query.state.data?.propLines.weeklyLinesDegraded ? 0 : healthyStaleTime,
    refetchInterval: (query: PropHistoryQuery): number | false => query.state.data?.propLines.weeklyLinesDegraded ? 30_000 : false,
  };
}
