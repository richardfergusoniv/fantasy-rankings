import { isVacantLineupSlot, isUnavailableStatus, optimizeLineup, sumLiveForecast } from "../../../api/_lib/lineup-optimizer";
import { teamOutlook, winPercent, winProbability } from "./win-probability";
import type { League, RosterPlayer } from "../dashboard-types";

/** A bench player must beat the current lineup by at least this many points to be worth a flag. */
export const BENCH_GAIN_THRESHOLD = 1.5;

export type MonitorIssueKind = "out" | "bye" | "empty" | "bench";
export type MonitorIssue = { kind: MonitorIssueKind; label: string };

export type MonitorLeagueSummary = {
  leagueId: string;
  /** Opponent team name, when the league has a matchup this week. */
  opponentName: string | null;
  /** Your win chance in percent, or null with no opponent or no projections. */
  winPercent: number | null;
  /** Your projected (or live) points minus theirs, or null when either side has none. */
  margin: number | null;
  issues: MonitorIssue[];
};

function slotLabel(player: RosterPlayer): string {
  return (player.lineupSlot ?? player.position).replace("_", " ");
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/**
 * What the Monitor page shows for one league: your win chance, the projected
 * margin, and every lineup problem. A finished game is never a problem, so a
 * player who was ruled out but already played is skipped.
 */
export function summarizeLeagueForMonitor(league: League, now = Date.now()): MonitorLeagueSummary {
  const issues: MonitorIssue[] = [];
  for (const player of league.starters) {
    if (isVacantLineupSlot(player)) {
      issues.push({ kind: "empty", label: `${slotLabel(player)} empty` });
    } else if (player.isBye) {
      issues.push({ kind: "bye", label: `${lastName(player.name)} on bye` });
    } else if (isUnavailableStatus(player.injuryStatus) && player.gamePhase !== "final" && player.gamePhase !== "live") {
      issues.push({ kind: "out", label: `${lastName(player.name)} out` });
    }
  }

  const optimized = optimizeLineup(league.starters, league.bench, now);
  const current = sumLiveForecast(league.starters, now);
  const best = sumLiveForecast(optimized.starters, now);
  const gain = current !== null && best !== null ? best - current : 0;
  if (gain >= BENCH_GAIN_THRESHOLD) {
    issues.push({ kind: "bench", label: `Bench +${gain.toFixed(1)}` });
  }

  const opponent = league.opponentTeam;
  const mine = teamOutlook(league.starters, now);
  const theirs = opponent ? teamOutlook(opponent.starters, now) : null;
  const theirTotal = opponent ? sumLiveForecast(opponent.starters, now) : null;
  return {
    leagueId: league.id,
    opponentName: opponent?.name ?? null,
    winPercent: mine && theirs ? winPercent(winProbability(mine, theirs)) : null,
    margin: current !== null && theirTotal !== null ? Number((current - theirTotal).toFixed(1)) : null,
    issues,
  };
}

/** Leagues with problems first; each group keeps the order the leagues arrived in. */
export function sortMonitorSummaries<T extends { issues: readonly unknown[] }>(items: readonly T[]): T[] {
  return [...items.filter((item) => item.issues.length > 0), ...items.filter((item) => item.issues.length === 0)];
}
