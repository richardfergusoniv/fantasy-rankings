/** Explain an ungraded week: he either did not play, or a played week's stats are not usable. */
export function missingPropWeekLabel(
  week: number,
  playedWeeks: ReadonlySet<number>,
): string {
  return playedWeeks.has(week) ? "stats unavailable" : "no game";
}

/** Stable React Query freshness for the prop board (hit grading uses this week's line). */
export function propHistoryRefreshOptions(healthyStaleTime: number) {
  return {
    staleTime: healthyStaleTime,
    refetchInterval: false as const,
  };
}
