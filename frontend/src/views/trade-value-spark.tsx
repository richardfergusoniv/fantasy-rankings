import type { ValueSinceTradeRow } from "../lib/value-since-trade";
import { formatWhole } from "../lib/format-number";

/**
 * Value since the trade, on a history card: one line per side from the trade
 * date to today. The side that's ahead now is drawn in the trade-winner amber
 * (the "won" line under the chart names it); the other side is gray.
 */
export function TradeValueSpark({ rows, names, leader }: {
  rows: readonly ValueSinceTradeRow[];
  names: readonly [string, string];
  /** 0 or 1 for the side ahead now; null when even. */
  leader: 0 | 1 | null;
}) {
  if (rows.length < 2) return null;
  const values = rows.flatMap((row) => [row.a, row.b]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1);
  const width = 300;
  const height = 48;
  const x = (index: number) => (index / (rows.length - 1)) * width;
  const y = (value: number) => 4 + (1 - (value - low) / span) * (height - 8);
  const path = (key: "a" | "b") => rows.map((row, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(row[key]).toFixed(1)}`).join(" ");
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const label = `Value since the trade: ${names[0]} ${formatWhole(first.a)} to ${formatWhole(last.a)}, ${names[1]} ${formatWhole(first.b)} to ${formatWhole(last.b)}`;
  return (
    <svg className="trade-value-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={path("a")} className={leader === 0 ? "is-leader" : "is-other"} />
      <path d={path("b")} className={leader === 1 ? "is-leader" : "is-other"} />
    </svg>
  );
}
