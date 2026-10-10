type RosterAssignment = {
  playerId: string;
  teamName: string;
  isUser: boolean;
};

type TradeTeam = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
  players: readonly { playerId: string }[];
};

type PowerTeam = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
};

/**
 * League power-rankings row for the team that rosters `playerId`.
 * Roster id wins when two teams share a name. Returns null when the player is available.
 */
export function leaguePowerTeamForPlayer<T extends PowerTeam>(
  league: {
    rosterAssignments: readonly RosterAssignment[];
    tradeTeams: readonly TradeTeam[];
    powerRankingsWeek: readonly T[];
  },
  playerId: string,
): T | null {
  const assignment = league.rosterAssignments.find((row) => row.playerId === playerId);
  const tradeTeam = league.tradeTeams.find((team) => team.players.some((player) => player.playerId === playerId))
    ?? (assignment
      ? league.tradeTeams.find((team) => team.teamName === assignment.teamName && team.isUser === assignment.isUser)
        ?? league.tradeTeams.find((team) => team.teamName === assignment.teamName)
      : undefined);
  if (tradeTeam) {
    const byRoster = league.powerRankingsWeek.find((team) => team.rosterId === tradeTeam.rosterId);
    if (byRoster) return byRoster;
  }
  if (!assignment) return null;
  const named = league.powerRankingsWeek.filter((team) => team.teamName === assignment.teamName && team.isUser === assignment.isUser);
  if (named.length === 1) return named[0] ?? null;
  const anyName = league.powerRankingsWeek.filter((team) => team.teamName === assignment.teamName);
  return anyName.length === 1 ? anyName[0] ?? null : null;
}
