import type { CSSProperties } from "react";

export type OutcomeSummary = { floor: number; p25: number; median: number; p75: number; ceiling: number };

/** Floor, quartiles, median and ceiling of a player's weekly scores; null with fewer than two games. */
export function outcomeSummary(points: readonly number[]): OutcomeSummary | null {
  const ordered = points.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (ordered.length < 2) return null;
  const at = (quantile: number) => {
    const rank = (ordered.length - 1) * quantile;
    const lower = ordered[Math.floor(rank)]!;
    const upper = ordered[Math.ceil(rank)]!;
    return Number((lower + (upper - lower) * (rank - Math.floor(rank))).toFixed(2));
  };
  return { floor: ordered[0]!, p25: at(0.25), median: at(0.5), p75: at(0.75), ceiling: ordered[ordered.length - 1]! };
}

/** One scale for every box in a list: zero (or the lowest floor) to the highest ceiling. */
export function outcomeDomain(summaries: ReadonlyArray<OutcomeSummary | null | undefined>): { min: number; max: number } {
  const present = summaries.filter((summary): summary is OutcomeSummary => Boolean(summary));
  if (present.length === 0) return { min: 0, max: 1 };
  const min = Math.min(0, ...present.map((summary) => summary.floor));
  const max = Math.max(...present.map((summary) => summary.ceiling));
  return { min, max: max > min ? max : min + 1 };
}

/**
 * Start/sit box: the whisker runs floor to ceiling, the box covers the middle half
 * of his weeks, and the tick is his median. `leads` draws the box in the winner
 * gold, like the leading side of a Comparison bar.
 */
export function OutcomeBox({ summary, domain, leads = false, className = "" }: {
  summary: OutcomeSummary;
  domain: { min: number; max: number };
  leads?: boolean;
  className?: string;
}) {
  const pct = (value: number) => ((Math.min(domain.max, Math.max(domain.min, value)) - domain.min) / (domain.max - domain.min)) * 100;
  const span = (from: number, to: number): CSSProperties => ({ left: `${pct(from)}%`, width: `${Math.max(0, pct(to) - pct(from))}%` });
  return (
    <span className={`outcome-box${leads ? " is-leader" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      <i className="outcome-whisker" style={span(summary.floor, summary.ceiling)} />
      <i className="outcome-middle" style={span(summary.p25, summary.p75)} />
      <i className="outcome-median" style={{ left: `${pct(summary.median)}%` }} />
    </span>
  );
}
