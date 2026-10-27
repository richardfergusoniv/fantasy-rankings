/**
 * Resolve the Sleeper roster id for an analytics entity.
 * nflverse player_id / entity id keys are GSIS; Sleeper rosters use Sleeper ids
 * (DST uses the NFL team abbreviation on both sides).
 */
export function analyticsSleeperPlayerId(
  position: string,
  gsisId: string,
  team: string,
  sleeperByGsis: Record<string, string> | undefined,
): string | null {
  if (position === "DEF" || position === "DST") return team;
  return sleeperByGsis?.[gsisId] ?? null;
}
