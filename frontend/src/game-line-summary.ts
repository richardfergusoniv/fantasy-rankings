/**
 * One-line betting summary for an NFL game from the dashboard's per-team
 * lines, e.g. "KC −6.5 · O/U 45.5 · Implied KC 26, LV 19.5".
 */
export type TeamGameLineLike = {
  team: string;
  opponent: string;
  spread: number | null;
  total: number | null;
  impliedPoints: number | null;
};

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function gameLineSummary(lines: readonly TeamGameLineLike[], team: string, opponent: string): string | null {
  const mine = lines.find((line) => line.team === team && line.opponent === opponent);
  if (!mine) return null;
  const theirs = lines.find((line) => line.team === opponent && line.opponent === team);
  const parts: string[] = [];
  if (mine.spread !== null) {
    if (mine.spread === 0) parts.push("Pick'em");
    else {
      const favorite = mine.spread < 0 ? team : opponent;
      parts.push(`${favorite} −${points(Math.abs(mine.spread))}`);
    }
  }
  if (mine.total !== null) parts.push(`O/U ${points(mine.total)}`);
  if (mine.impliedPoints !== null && theirs?.impliedPoints != null) {
    parts.push(`Implied ${team} ${points(mine.impliedPoints)}, ${opponent} ${points(theirs.impliedPoints)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
