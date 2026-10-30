/** Display helpers for the Projected standings table. */
export function recordLabel(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}

/** "3rd of 12": the ordinal for a 1-based place. */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

/** Places gained (positive) or lost (negative) from today's table to the projected one. */
export function placesMoved(currentRank: number, projectedRank: number): number {
  return currentRank - projectedRank;
}

export type NextGame = { week: number; opponentRosterId: number; mine: number; theirs: number; margin: number; result: "W" | "L" | "T" };

/** The team's next games in week order, each with projected totals, result, and score margin. */
export function nextGamesForTeam(
  games: ReadonlyArray<{ week: number; rosterIdA: number; rosterIdB: number; projectedA: number; projectedB: number }>,
  rosterId: number,
  limit = 3,
): NextGame[] {
  return games
    .filter((game) => game.rosterIdA === rosterId || game.rosterIdB === rosterId)
    .sort((a, b) => a.week - b.week)
    .slice(0, limit)
    .map((game) => {
      const isA = game.rosterIdA === rosterId;
      const mine = isA ? game.projectedA : game.projectedB;
      const theirs = isA ? game.projectedB : game.projectedA;
      const margin = Math.round((mine - theirs) * 100) / 100;
      return { week: game.week, opponentRosterId: isA ? game.rosterIdB : game.rosterIdA, mine, theirs, margin, result: margin > 0 ? "W" : margin < 0 ? "L" : "T" };
    });
}
