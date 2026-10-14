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
  record?: { wins: number; losses: number; ties: number };
};

type PowerTeam = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
};

/** Full weekly power-rankings row used by LeagueTeamCard. */
export type LeagueTeamCardTeam = {
  rosterId: number;
  teamName: string;
  record: { wins: number; losses: number; ties: number };
  rank: number;
  totalValue: number;
  futurePickValue: number;
  positionValues: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    K: number;
    DEF: number;
  };
  isUser: boolean;
};

const EMPTY_POSITION_VALUES: LeagueTeamCardTeam["positionValues"] = {
  QB: 0,
  RB: 0,
  WR: 0,
  TE: 0,
  FLEX: 0,
  K: 0,
  DEF: 0,
};

/**
 * Resolve a league team card target by roster id.
 * Prefers power rankings when present; otherwise opens immediately from tradeTeams
 * with `powerLoading` until league power data arrives.
 */
export function resolveLeagueTeamCard(
  league: {
    tradeTeams: readonly TradeTeam[];
    powerRankingsWeek: readonly LeagueTeamCardTeam[];
  },
  rosterId: number,
  powerPending = false,
): { team: LeagueTeamCardTeam; powerLoading: boolean } | null {
  const ranked = league.powerRankingsWeek.find((team) => team.rosterId === rosterId);
  if (ranked) return { team: ranked, powerLoading: false };
  const trade = league.tradeTeams.find((team) => team.rosterId === rosterId);
  if (!trade) return null;
  return {
    team: {
      rosterId: trade.rosterId,
      teamName: trade.teamName,
      record: trade.record ?? { wins: 0, losses: 0, ties: 0 },
      rank: 0,
      totalValue: 0,
      futurePickValue: 0,
      positionValues: EMPTY_POSITION_VALUES,
      isUser: trade.isUser,
    },
    powerLoading: powerPending || league.powerRankingsWeek.length === 0,
  };
}

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
