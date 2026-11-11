import { liveForecastPoints, optimizeLineup, sumLiveForecast } from "../../../api/_lib/lineup-optimizer";
import { teamOutlook, winPercent, winProbability } from "./win-probability";
import type { League, RosterPlayer } from "../dashboard-types";

export type LineupSwap = {
  slot: string;
  playerIn: RosterPlayer;
  playerOut: RosterPlayer;
  /** Points the swap adds, using the live-aware forecast the Matchup totals use. */
  gain: number;
};

export type LineupAssistantAnswer = {
  swaps: LineupSwap[];
  /** Total points the changes add. */
  gain: number;
  /** Your win chance in percent before and after the changes; null without an opponent. */
  winBefore: number | null;
  winAfter: number | null;
};

/** Changes smaller than this aren't worth telling the user to make. */
export const MIN_SWAP_GAIN = 0.1;

/**
 * The lineup moves the Assistant recommends: the optimizer's lineup compared
 * with the current one, slot by slot. Returns null when no move is worth making.
 * Locked players never move, so a finished game can't be "fixed".
 */
export function lineupAssistantAnswer(league: Pick<League, "starters" | "bench" | "opponentTeam">, now = Date.now()): LineupAssistantAnswer | null {
  const optimized = optimizeLineup(league.starters, league.bench, now);
  const swaps: LineupSwap[] = [];
  league.starters.forEach((current, index) => {
    const best = optimized.starters[index];
    if (!best || best.playerId === current.playerId) return;
    const gain = (liveForecastPoints(best, now) ?? 0) - (liveForecastPoints(current, now) ?? 0);
    if (gain >= MIN_SWAP_GAIN) swaps.push({ slot: (current.lineupSlot ?? current.position).replace("_", " "), playerIn: best, playerOut: current, gain: Number(gain.toFixed(1)) });
  });
  if (swaps.length === 0) return null;

  const total = sumLiveForecast(optimized.starters, now) ?? 0;
  const before = sumLiveForecast(league.starters, now) ?? 0;
  const theirs = league.opponentTeam ? teamOutlook(league.opponentTeam.starters, now) : null;
  const winOf = (starters: RosterPlayer[]) => {
    const mine = teamOutlook(starters, now);
    return mine && theirs ? winPercent(winProbability(mine, theirs)) : null;
  };
  return {
    swaps: swaps.sort((a, b) => b.gain - a.gain),
    gain: Number((total - before).toFixed(1)),
    winBefore: winOf(league.starters),
    winAfter: winOf(optimized.starters),
  };
}
