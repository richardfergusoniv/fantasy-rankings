/**
 * League standings and waiver status from Sleeper league + roster settings:
 * record, points for/against, playoff seed and games out, plus the user's
 * FAAB budget and waiver position.
 */

export type SleeperStandingsRoster = {
  roster_id: number;
  settings?: {
    division?: number;
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
  };
};

export type SleeperLeagueSettings = {
  divisions?: number;
  playoff_teams?: number;
  playoff_week_start?: number;
  waiver_type?: number;
  waiver_budget?: number;
};

export type StandingsRow = {
  rosterId: number;
  teamName: string;
  isUser: boolean;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Seed if the season ended today, else null. */
  playoffSeed: number | null;
  /** Games behind the last playoff spot; null when in position or unknown. */
  gamesOutOfPlayoffs: number | null;
};

export type LeaguePlayoffs = {
  teams: number | null;
  weekStart: number | null;
  positionKnown?: boolean;
};

export type WaiverStatus = {
  type: "faab" | "rolling" | "reverse_standings" | null;
  /** FAAB leagues only. */
  budget: number | null;
  remaining: number | null;
  /** The user's waiver priority (1 = first). */
  position: number | null;
  teams: number;
};

function points(whole: number | undefined, decimal: number | undefined): number {
  return Math.round(((whole ?? 0) + (decimal ?? 0) / 100) * 100) / 100;
}

function winPct(row: Pick<StandingsRow, "wins" | "losses" | "ties">): number {
  const games = row.wins + row.losses + row.ties;
  return games === 0 ? 0 : (row.wins + row.ties / 2) / games;
}

/**
 * Ranked by win percentage, then points for (Sleeper's default tiebreak).
 * Division qualification is not modeled; leave playoff position unknown in those leagues.
 */
export function buildStandings(
  rosters: readonly SleeperStandingsRoster[],
  ownRosterId: number,
  teamName: (roster: SleeperStandingsRoster) => string,
  settings: SleeperLeagueSettings | undefined,
): { standings: StandingsRow[]; playoffs: LeaguePlayoffs } {
  const playoffTeams = settings?.playoff_teams && settings.playoff_teams > 0 ? settings.playoff_teams : null;
  const positionKnown = !(settings?.divisions && settings.divisions > 0)
    && !rosters.some((roster) => (roster.settings?.division ?? 0) > 0);
  const rows = rosters
    .map((roster) => ({
      rosterId: roster.roster_id,
      teamName: teamName(roster),
      isUser: roster.roster_id === ownRosterId,
      rank: 0,
      wins: roster.settings?.wins ?? 0,
      losses: roster.settings?.losses ?? 0,
      ties: roster.settings?.ties ?? 0,
      pointsFor: points(roster.settings?.fpts, roster.settings?.fpts_decimal),
      pointsAgainst: points(roster.settings?.fpts_against, roster.settings?.fpts_against_decimal),
      playoffSeed: null as number | null,
      gamesOutOfPlayoffs: null as number | null,
    }))
    .sort((a, b) => winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || a.teamName.localeCompare(b.teamName))
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const cutoff = playoffTeams ? rows[playoffTeams - 1] : undefined;
  for (const row of rows) {
    if (!positionKnown || !playoffTeams || !cutoff) continue;
    if (row.rank <= playoffTeams) {
      row.playoffSeed = row.rank;
    } else {
      row.gamesOutOfPlayoffs = Math.max(0, ((cutoff.wins - row.wins) + (row.losses - cutoff.losses)) / 2);
    }
  }
  return {
    standings: rows,
    playoffs: {
      teams: playoffTeams,
      positionKnown,
      weekStart: settings?.playoff_week_start && settings.playoff_week_start > 0 ? settings.playoff_week_start : null,
    },
  };
}

const WAIVER_TYPES: Record<number, WaiverStatus["type"]> = {
  0: "rolling",
  1: "reverse_standings",
  2: "faab",
};

export function waiverStatus(
  settings: SleeperLeagueSettings | undefined,
  ownRoster: SleeperStandingsRoster | undefined,
  teams: number,
): WaiverStatus {
  const type = settings?.waiver_type === undefined ? null : WAIVER_TYPES[settings.waiver_type] ?? null;
  const budget = type === "faab" && typeof settings?.waiver_budget === "number" ? settings.waiver_budget : null;
  const used = ownRoster?.settings?.waiver_budget_used ?? 0;
  const position = ownRoster?.settings?.waiver_position;
  return {
    type,
    budget,
    remaining: budget === null ? null : Math.max(0, budget - used),
    position: typeof position === "number" && position > 0 ? position : null,
    teams,
  };
}
