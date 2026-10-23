type GamePlayer = {
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  projection: number | null;
  isStarter: boolean;
};

/**
 * The user's players whose team is playing in this game, starters first and
 * each group by projection. `canonical` maps team aliases to one code.
 */
export function playersInGame<T extends GamePlayer>(
  players: readonly T[],
  teams: readonly [string, string],
  canonical: (team: string | null) => string | null,
): T[] {
  const codes = new Set(teams.map((team) => canonical(team)).filter((code): code is string => code !== null));
  return players
    .filter((player) => {
      const code = canonical(player.team);
      return code !== null && codes.has(code);
    })
    .sort((a, b) => Number(b.isStarter) - Number(a.isStarter) || (b.projection ?? -1) - (a.projection ?? -1) || a.name.localeCompare(b.name));
}
