/**
 * Implied team / game totals for weekly Analytics charts.
 * Prefer nflverse dashboard.gameLines; fall back to defense.opponentProjectedPoints.
 */

export type WeeklyGameLine = {
  team: string;
  opponent: string;
  total: number | null;
  impliedPoints: number | null;
};

export type DefenseImpliedTotalRow = {
  team: string;
  opponent: string;
  opponentProjectedPoints: number | null;
};

export function buildImpliedTotalMaps(
  gameLines: readonly WeeklyGameLine[],
  defenses: readonly DefenseImpliedTotalRow[],
): {
  teamTotals: Map<string, number>;
  gameTotals: Map<string, number>;
} {
  const teamTotals = new Map<string, number>();
  const gameTotals = new Map<string, number>();
  for (const line of gameLines) {
    if (typeof line.impliedPoints === "number" && Number.isFinite(line.impliedPoints)) {
      teamTotals.set(line.team, line.impliedPoints);
    }
    if (typeof line.total === "number" && Number.isFinite(line.total)) {
      gameTotals.set(line.team, line.total);
    }
  }
  for (const defense of defenses) {
    if (defense.opponentProjectedPoints !== null && !teamTotals.has(defense.opponent)) {
      teamTotals.set(defense.opponent, defense.opponentProjectedPoints);
    }
  }
  return { teamTotals, gameTotals };
}

/** Values stamped onto a kicker / skill weekly chart entity. */
export function skillImpliedTotalValues(
  team: string,
  teamTotals: ReadonlyMap<string, number>,
  gameTotals: ReadonlyMap<string, number>,
): Record<string, number> {
  const values: Record<string, number> = {};
  const teamTotal = teamTotals.get(team);
  if (teamTotal !== undefined) values.teamTotal = teamTotal;
  const gameTotal = gameTotals.get(team);
  if (gameTotal !== undefined) values.gameTotal = gameTotal;
  return values;
}

/** Values stamped onto a DST weekly chart entity. */
export function defenseImpliedTotalValues(
  team: string,
  opponent: string,
  opponentProjectedPoints: number | null,
  teamTotals: ReadonlyMap<string, number>,
  gameTotals: ReadonlyMap<string, number>,
): Record<string, number> {
  const values: Record<string, number> = {};
  const opponentTotal = opponentProjectedPoints ?? teamTotals.get(opponent);
  if (opponentTotal !== undefined && opponentTotal !== null) values.opponentTotal = opponentTotal;
  const ownTotal = teamTotals.get(team);
  if (ownTotal !== undefined) values.teamTotal = ownTotal;
  const gameTotal = gameTotals.get(team) ?? gameTotals.get(opponent);
  if (gameTotal !== undefined) values.gameTotal = gameTotal;
  return values;
}
