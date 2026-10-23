/** Stats listed first for each position, main stat leading. Anything else keeps its incoming order after these. */
const LEADING_STATS: Record<string, readonly string[]> = {
  QB: ["pass_yards", "pass_tds", "pass_completions", "pass_attempts", "rush_yards"],
  RB: ["rush_yards", "rec_yards", "receptions", "rush_attempts"],
  WR: ["rec_yards", "receptions", "longest_reception"],
  TE: ["rec_yards", "receptions", "longest_reception"],
  K: ["kicker_points", "field_goals_made"],
  DEF: ["sacks", "tackles"],
};

/** Put a player's main prop first. Stable: lines outside the list keep their order. */
export function sortPropLines<T extends { stat: string }>(lines: readonly T[], position: string): T[] {
  const leading = LEADING_STATS[position] ?? [];
  const rank = (stat: string): number => {
    const index = leading.indexOf(stat);
    return index === -1 ? leading.length : index;
  };
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => rank(a.line.stat) - rank(b.line.stat) || a.index - b.index)
    .map(({ line }) => line);
}
