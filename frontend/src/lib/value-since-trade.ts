import { nearestHistoryValue, type AggregateHistoryPoint } from "./aggregate-trade-history";

export type ValueSinceTradeRow = { date: string; a: number; b: number };

/**
 * Each side's FantasyCalc value, summed day by day from the trade date to the
 * latest stored day: the actual daily values, not rescaled to today. A player
 * with no stored history is left out of both the line and its total; one whose
 * history starts later carries his first stored value back to the trade date.
 */
export function valueSinceTrade(
  sideA: readonly string[],
  sideB: readonly string[],
  historyByPlayerId: ReadonlyMap<string, ReadonlyArray<AggregateHistoryPoint>>,
  tradeDate: string,
): ValueSinceTradeRow[] {
  const ascending = new Map<string, AggregateHistoryPoint[]>();
  for (const id of [...sideA, ...sideB]) {
    const points = historyByPlayerId.get(id);
    if (points?.length) ascending.set(id, [...points].sort((x, y) => x.date.localeCompare(y.date)));
  }
  if (ascending.size === 0) return [];
  const dates = new Set<string>([tradeDate]);
  for (const points of ascending.values()) {
    for (const point of points) if (point.date >= tradeDate) dates.add(point.date);
  }
  const total = (ids: readonly string[], date: string) => ids.reduce((sum, id) => {
    const points = ascending.get(id);
    return points ? sum + (nearestHistoryValue(points, date) ?? 0) : sum;
  }, 0);
  return [...dates].sort().map((date) => ({ date, a: total(sideA, date), b: total(sideB, date) }));
}
