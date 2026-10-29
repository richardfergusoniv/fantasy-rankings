/**
 * Dynasty vs redraft signal for player-news fetches.
 * Prefer the selected league on the effective dashboard (cached or streamed);
 * with no league context, treat as redraft so dynasty-tagged rows stay hidden.
 */

export function isDynastyNewsContext(
  leagues: ReadonlyArray<{ id: string; seasonLongFormat: { isDynasty: boolean } }> | undefined,
  selectedLeagueId: string | null | undefined,
): boolean {
  if (!leagues || leagues.length === 0) return false;
  const match = leagues.find((item) => item.id === selectedLeagueId) ?? leagues[0];
  return Boolean(match?.seasonLongFormat.isDynasty);
}
