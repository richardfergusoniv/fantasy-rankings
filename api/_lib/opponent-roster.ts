export function weeklyOpponentRosterId(
  opponentName: string | null | undefined,
  teams: readonly { rosterId: number; teamName: string; isUser: boolean }[],
  rosterId?: number | null,
): number | null {
  if (rosterId != null) return teams.some((team) => !team.isUser && team.rosterId === rosterId) ? rosterId : null;
  if (!opponentName) return null;
  const matches = teams.filter((team) => !team.isUser && team.teamName === opponentName);
  return matches.length === 1 ? matches[0]?.rosterId ?? null : null;
}
