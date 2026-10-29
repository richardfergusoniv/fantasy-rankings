/** Pure helpers for the Outcomes tab: chart scale, tone, and number labels. */
import { formatDecimal, formatPercent } from "./lib/format-number";

export type OutcomesView = "playoffs" | "last";
export type Tone = "good" | "bad" | "flat";

export type OutcomeRow = {
  playoffPct: number;
  lastPct: number;
  previousPlayoffPct: number | null;
  previousLastPct: number | null;
};

/** Moves smaller than this many percentage points read as no change. */
export const FLAT_PP = 0.05;

export function outcomeMeasure(view: OutcomesView) {
  return view === "playoffs"
    ? { now: (team: OutcomeRow) => team.playoffPct, before: (team: OutcomeRow) => team.previousPlayoffPct, higherIsBetter: true }
    : { now: (team: OutcomeRow) => team.lastPct, before: (team: OutcomeRow) => team.previousLastPct, higherIsBetter: false };
}

/** Playoff odds always span 0-100; last-place odds zoom to the largest value in 10-point steps. */
export function axisMax(view: OutcomesView, teams: readonly OutcomeRow[]): number {
  if (view === "playoffs") return 100;
  const top = Math.max(0, ...teams.flatMap((team) => [team.lastPct, team.previousLastPct ?? 0]));
  return Math.max(10, Math.ceil(top / 10) * 10);
}

/** Green is a better outcome for the manager, red a worse one; last-place odds falling is good. */
export function changeTone(change: number | null, higherIsBetter: boolean): Tone {
  if (change == null || Math.abs(change) < FLAT_PP) return "flat";
  return (change > 0) === higherIsBetter ? "good" : "bad";
}

export function changeLabel(change: number | null): string {
  if (change == null) return "–";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return `${sign}${formatDecimal(Math.abs(change), 1)} pp`;
}

/** Tiny odds keep two decimals so 0.34% does not collapse to 0.3%. */
export function pctLabel(value: number): string {
  return value > 0 && value < 1 ? `${formatDecimal(value, 2)}%` : formatPercent(value);
}
