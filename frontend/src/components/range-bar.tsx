import { formatDecimal } from "../lib/format-number";

export type ProjectionRange = { low: number; high: number };

/** Shared scale for a list of bars: lowest low to highest high, padded a little so ends never touch the edge. */
export type RangeDomain = { min: number; max: number };

/**
 * A player's book range under a weekly projection: a thin track across the
 * list's shared scale, a band from the lowest to the highest book, and a tick at
 * the projection. A short band means the books agree. No words: the numbers are
 * in the accessible name and the hover title.
 */
export function RangeBar({ range, value, domain, className, valueNote }: {
  range: ProjectionRange;
  value: number | null;
  /** Shared scale so every bar in a list compares directly. */
  domain: RangeDomain;
  className?: string;
  /** Appended to the accessible name, e.g. where an actual finish landed. */
  valueNote?: string;
}) {
  const min = Math.min(domain.min, range.low);
  const span = Math.max(Math.max(domain.max, range.high) - min, 0.01);
  const pct = (n: number) => `${Math.max(0, Math.min(100, ((n - min) / span) * 100))}%`;
  const label = `Books range ${formatDecimal(range.low, 1)} to ${formatDecimal(range.high, 1)}${valueNote ? `, ${valueNote}` : ""}`;
  return (
    <span className={["range-bar", className].filter(Boolean).join(" ")} role="img" aria-label={label} title={label}>
      <b style={{ left: pct(range.low), width: `calc(${pct(range.high)} - ${pct(range.low)})` }} />
      {value !== null ? <u style={{ left: pct(value) }} /> : null}
    </span>
  );
}

/** One scale for a list of bars: from the lowest low to the highest high, padded 5% each side. */
export function rangeDomain(ranges: ReadonlyArray<ProjectionRange | null | undefined>): RangeDomain {
  const present = ranges.filter((range): range is ProjectionRange => Boolean(range));
  if (present.length === 0) return { min: 0, max: 1 };
  const low = Math.min(...present.map((range) => range.low));
  const high = Math.max(...present.map((range) => range.high));
  const pad = Math.max((high - low) * 0.05, 0.5);
  // Floor at zero unless a book line projects below it, then pad under that low too.
  return { min: low < 0 ? low - pad : Math.max(0, low - pad), max: high + pad };
}
