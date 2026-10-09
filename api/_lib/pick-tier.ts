export type PickTier = "early" | "mid" | "late";

export type PickStanding = {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  /** 1 is the most valuable redraft roster. */
  valueRank: number;
};

function gamesPlayed(team: PickStanding): number {
  return team.wins + team.losses + team.ties;
}

function winPct(team: PickStanding): number {
  const games = gamesPlayed(team);
  if (games <= 0) return -1;
  return (team.wins + 0.5 * team.ties) / games;
}

/**
 * Contender order for dynasty pick tiers.
 *
 * Equal weight: sort by the average of record-rank and redraft roster-value
 * rank (1 is best in both). The resulting place is what the tier split uses.
 * Before any team has played, the order is value rank only. A team that has
 * not played, while other teams have, is last on record.
 */
export function blendedContenderRanks(teams: readonly PickStanding[]): Map<number, number> {
  if (teams.length === 0) return new Map();
  const played = teams.some((team) => gamesPlayed(team) > 0);
  if (!played) return new Map(teams.map((team) => [team.rosterId, team.valueRank]));

  const recordRank = new Map<number, number>();
  [...teams].sort((left, right) => {
    const pctGap = winPct(right) - winPct(left);
    if (pctGap !== 0) return pctGap;
    if (left.wins !== right.wins) return right.wins - left.wins;
    return left.rosterId - right.rosterId;
  }).forEach((team, index) => {
    recordRank.set(team.rosterId, index + 1);
  });

  const ordered = [...teams].sort((left, right) => {
    const leftScore = ((recordRank.get(left.rosterId) ?? teams.length) + left.valueRank) / 2;
    const rightScore = ((recordRank.get(right.rosterId) ?? teams.length) + right.valueRank) / 2;
    if (leftScore !== rightScore) return leftScore - rightScore;
    const leftRecord = recordRank.get(left.rosterId) ?? teams.length;
    const rightRecord = recordRank.get(right.rosterId) ?? teams.length;
    if (leftRecord !== rightRecord) return leftRecord - rightRecord;
    if (left.valueRank !== right.valueRank) return left.valueRank - right.valueRank;
    return left.rosterId - right.rosterId;
  });
  return new Map(ordered.map((team, index) => [team.rosterId, index + 1]));
}

/** Top third of the contender order is a late pick, bottom third an early pick. */
export function pickTierForRank(rank: number | undefined, teamCount: number): PickTier {
  if (rank === undefined || teamCount <= 0) return "mid";
  if (rank <= teamCount / 3) return "late";
  if (rank <= (2 * teamCount) / 3) return "mid";
  return "early";
}
