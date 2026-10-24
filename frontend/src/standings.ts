/** Display helpers for the league standings table. */
export type StandingsRowLike = {
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  playoffSeed: number | null;
  gamesOutOfPlayoffs: number | null;
};

function games(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Right-hand column: the seed if in position, games back if not. */
export function playoffStatusLabel(row: StandingsRowLike): string {
  if (row.playoffSeed !== null) return `Seed ${row.playoffSeed}`;
  if (row.gamesOutOfPlayoffs === null) return "—";
  if (row.gamesOutOfPlayoffs === 0) return "Tiebreak";
  return `${games(row.gamesOutOfPlayoffs)} GB`;
}

export function pointsLine(row: StandingsRowLike): string {
  return `PF ${row.pointsFor.toFixed(1)} · PA ${row.pointsAgainst.toFixed(1)}`;
}

/** e.g. "Top 6 make the playoffs · starts Week 15". */
export function playoffsCaption(playoffs: { teams: number | null; weekStart: number | null } | null | undefined): string | null {
  if (!playoffs?.teams) return null;
  return `Top ${playoffs.teams} make the playoffs${playoffs.weekStart ? ` · starts Week ${playoffs.weekStart}` : ""}`;
}
