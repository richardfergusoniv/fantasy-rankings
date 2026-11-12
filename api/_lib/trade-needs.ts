/**
 * Position needs for the trade finder. A position's raw lineup value is not comparable across
 * positions (tight ends always total the least), so needs are ranked against the league average
 * for that position, and an incoming player must be an upgrade on a starter to be worth asking for.
 */

export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type SkillPosition = (typeof SKILL_POSITIONS)[number];
export type PositionValues = Record<SkillPosition, number>;

/** Skill positions ordered from weakest to strongest compared with the league average for each position. */
export function positionsByNeed(row: { positionValues: PositionValues }, league: Array<{ positionValues: PositionValues }>): SkillPosition[] {
  const average = (position: SkillPosition) => (league.length > 0 ? league.reduce((sum, team) => sum + team.positionValues[position], 0) / league.length : 0);
  const relative = (position: SkillPosition) => {
    const avg = average(position);
    return avg > 0 ? row.positionValues[position] / avg : row.positionValues[position];
  };
  return [...SKILL_POSITIONS].sort((a, b) => relative(a) - relative(b));
}

/** Lowest-valued starter at each position; a position with no starter has no floor. */
export function starterFloors(players: Array<{ position: string; isStarter: boolean; value: number | null }>): Map<string, number> {
  const floors = new Map<string, number>();
  for (const player of players) {
    if (!player.isStarter || player.value == null) continue;
    floors.set(player.position, Math.min(floors.get(player.position) ?? Number.POSITIVE_INFINITY, player.value));
  }
  return floors;
}

/** True when the player would take a starting spot: he is worth more than the weakest starter at his position. */
export function upgradesStarter(asset: { position: string; value: number }, floors: Map<string, number>): boolean {
  const floor = floors.get(asset.position);
  return floor === undefined || asset.value > floor;
}
