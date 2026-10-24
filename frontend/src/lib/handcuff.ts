type DepthEntry = { position: string; rank: number };

/**
 * The starter a running back is the handcuff for: the RB2 on his team's depth chart,
 * unless his own weekly rank already makes him a starter in the league.
 * Returns the starter's name, or null when he is not a handcuff.
 */
export function handcuffStarter({
  playerId,
  position,
  team,
  weeklyRank,
  leagueSize,
  depth,
  players,
}: {
  playerId: string;
  position: string;
  team: string | null;
  weeklyRank: number | null;
  leagueSize: number;
  depth: Readonly<Record<string, DepthEntry>>;
  players: ReadonlyArray<{ playerId: string; name: string; team: string | null }>;
}): string | null {
  if (position !== "RB" || !team) return null;
  const own = depth[playerId];
  if (!own || own.position !== "RB" || own.rank !== 2) return null;
  if (weeklyRank !== null && weeklyRank <= leagueSize * 2) return null;
  const starter = players.find((candidate) => {
    if (candidate.team !== team || candidate.playerId === playerId) return false;
    const entry = depth[candidate.playerId];
    return entry?.position === "RB" && entry.rank === 1;
  });
  return starter?.name ?? null;
}
