/**
 * Exact name + team + position always wins.
 * A name + position row is used only when it is unambiguous:
 * one row whose team is blank or matches, or exactly one row whose team matches.
 * A row from a different team is never borrowed, even if it is the only name hit.
 */
export function selectProjectionFeed<T>(
  exact: T | undefined,
  nameMatches: readonly T[],
  baseTeam: string,
  teamOf: (row: T) => string,
): T | undefined {
  if (exact) return exact;
  if (nameMatches.length === 1) {
    const only = nameMatches[0];
    if (!only) return undefined;
    const team = teamOf(only);
    if (team === "" || team === baseTeam) return only;
    return undefined;
  }
  const matched = nameMatches.filter((row) => teamOf(row) === baseTeam && baseTeam !== "");
  return matched.length === 1 ? matched[0] : undefined;
}
