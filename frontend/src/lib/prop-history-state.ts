/** Explain an ungraded week: he either did not play, or a played week's stats are not usable. */
export function missingPropWeekLabel(
  week: number,
  playedWeeks: ReadonlySet<number>,
): string {
  return playedWeeks.has(week) ? "stats unavailable" : "no game";
}

type PropHistoryQuery = { state: { data?: { propLines: { weeklyLinesDegraded?: boolean } } } };

/** Keep the board visible while retrying a temporary closing-line failure. */
export function propHistoryRefreshOptions(healthyStaleTime: number) {
  return {
    staleTime: (query: PropHistoryQuery) => query.state.data?.propLines.weeklyLinesDegraded ? 0 : healthyStaleTime,
    refetchInterval: (query: PropHistoryQuery): number | false => query.state.data?.propLines.weeklyLinesDegraded ? 30_000 : false,
  };
}
