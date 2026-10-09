export function weeklyOpponentRosterId(
  opponentName: string | null | undefined,
  teams: readonly { rosterId: number; teamName: string; isUser: boolean }[],
): number | null {
  if (!opponentName) return null;
  const matches = teams.filter((team) => !team.isUser && team.teamName === opponentName);
  return matches.length === 1 ? matches[0]?.rosterId ?? null : null;
}
