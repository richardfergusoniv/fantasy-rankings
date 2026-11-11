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

/** A lineup that gains less than this isn't worth telling the user to change. */
export const MIN_SWAP_GAIN = 0.1;

/**
 * The lineup moves the Assistant recommends: who comes into the lineup and who
 * goes out to the bench. A player the optimizer only shifts between slots (a
 * starter moving into FLEX) is not a move, so the list is the real
 * substitutions: following it gives the optimized lineup and its points gain.
 * Returns null when no move is worth making. Locked players never move.
 */
export function lineupAssistantAnswer(league: Pick<League, "starters" | "bench" | "opponentTeam">, now = Date.now()): LineupAssistantAnswer | null {
  const optimized = optimizeLineup(league.starters, league.bench, now);
  const points = (player: RosterPlayer | null) => (player ? liveForecastPoints(player, now) ?? 0 : 0);
  const keptIds = new Set(optimized.starters.filter((player) => player.playerId !== "0").map((player) => player.playerId));
  const currentIds = new Set(league.starters.map((player) => player.playerId));
  const ins = optimized.starters.filter((player) => player.playerId !== "0" && !currentIds.has(player.playerId));
  // A slot that was empty and is now filled counts as an exit of "nobody".
  let stillEmpty = optimized.starters.filter((player) => player.playerId === "0").length;
  const outs = league.starters.filter((player) => {
    if (player.playerId !== "0") return !keptIds.has(player.playerId);
    if (stillEmpty > 0) {
      stillEmpty -= 1;
      return false;
    }
    return true;
  });
  // Biggest improvement first: best incoming player replaces the worst outgoing one.
  const sortedIns = [...ins].sort((a, b) => points(b) - points(a));
  const sortedOuts = [...outs].sort((a, b) => (a.playerId === "0" ? -1 : points(a)) - (b.playerId === "0" ? -1 : points(b)));
  const swaps: LineupSwap[] = sortedIns.flatMap((playerIn, index) => {
    const playerOut = sortedOuts[index];
    if (!playerOut) return [];
    const slotIndex = optimized.starters.findIndex((player) => player.playerId === playerIn.playerId);
    const slotPlayer = league.starters[slotIndex] ?? playerOut;
    return [{
      slot: (slotPlayer.lineupSlot ?? slotPlayer.position).replace("_", " "),
      playerIn,
      playerOut,
      gain: Number((points(playerIn) - points(playerOut)).toFixed(1)),
    }];
  });
  const total = sumLiveForecast(optimized.starters, now) ?? 0;
  const before = sumLiveForecast(league.starters, now) ?? 0;
  const gain = Number((total - before).toFixed(1));
  if (swaps.length === 0 || gain < MIN_SWAP_GAIN) return null;

  const theirs = league.opponentTeam ? teamOutlook(league.opponentTeam.starters, now) : null;
  const winOf = (starters: RosterPlayer[]) => {
    const mine = teamOutlook(starters, now);
    return mine && theirs ? winPercent(winProbability(mine, theirs)) : null;
  };
  return {
    swaps: swaps.sort((a, b) => b.gain - a.gain),
    gain,
    winBefore: winOf(league.starters),
    winAfter: winOf(optimized.starters),
  };
}
