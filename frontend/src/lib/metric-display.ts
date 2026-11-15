import { formatDecimal, formatPercent, formatWhole } from "./format-number";

/** The part of a comparison / analytics metric that decides how its number is written. */
export type DisplayMetric = { key: string; unit?: string };

/** One metric value as text: percents, whole ranks, whole market value and yardage, two decimals otherwise. */
export function metricDisplay(value: number, metric: DisplayMetric): string {
  if (metric.unit === "%") return formatPercent(value);
  // Ranks stay whole; analytics values are per-game averages / fractional → two decimals.
  if (metric.key.endsWith("Rank")) return formatWhole(value);
  // Market value and yardage are whole numbers everywhere else (rankings, player card).
  if (metric.key === "fantasyCalcValue" || /_yds?$/.test(metric.key)) return `${formatWhole(value)}${metric.unit ?? ""}`;
  return `${formatDecimal(value, 2)}${metric.unit ?? ""}`;
}
