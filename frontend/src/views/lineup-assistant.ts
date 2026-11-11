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

/** A starter who stays in the lineup but changes slot (for example from FLEX to WR) so the swaps can be carried out. */
export type LineupSlotMove = { player: RosterPlayer; from: string; to: string };

export type LineupAssistantAnswer = {
  swaps: LineupSwap[];
  /** Slot changes for players who stay in the lineup; do these along with the swaps. */
  slotMoves: LineupSlotMove[];
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
  // Pair each incoming player with an outgoing one who can really be replaced by him: the same
  // position first (best in for worst out), then whoever is left (a FLEX slot takes any skill position).
  const byPoints = (a: RosterPlayer, b: RosterPlayer) => points(b) - points(a);
  const remainingIns = [...ins].sort(byPoints);
  const remainingOuts = [...outs].sort((a, b) => -byPoints(a, b));
  const pairs: Array<{ playerIn: RosterPlayer; playerOut: RosterPlayer }> = [];
  for (const playerIn of [...remainingIns]) {
    const matchIndex = remainingOuts.findIndex((candidate) => candidate.playerId !== "0" && candidate.position === playerIn.position);
    if (matchIndex < 0) continue;
    pairs.push({ playerIn, playerOut: remainingOuts[matchIndex]! });
    remainingOuts.splice(matchIndex, 1);
    remainingIns.splice(remainingIns.indexOf(playerIn), 1);
  }
  for (const playerIn of remainingIns) {
    const playerOut = remainingOuts.shift();
    if (playerOut) pairs.push({ playerIn, playerOut });
  }
  const swaps: LineupSwap[] = pairs.map(({ playerIn, playerOut }) => {
    const slotIndex = optimized.starters.findIndex((player) => player.playerId === playerIn.playerId);
    const slotPlayer = league.starters[slotIndex] ?? playerOut;
    return {
      slot: (slotPlayer.lineupSlot ?? slotPlayer.position).replace("_", " "),
      playerIn,
      playerOut,
      gain: Number((points(playerIn) - points(playerOut)).toFixed(1)),
    };
  });
  // Players who stay starters but sit in a different slot in the best lineup (a FLEX starter moving up to WR).
  const slotName = (index: number) => {
    const slotPlayer = league.starters[index];
    return slotPlayer ? (slotPlayer.lineupSlot ?? slotPlayer.position).replace("_", " ") : "";
  };
  const slotMoves: LineupSlotMove[] = [];
  optimized.starters.forEach((player, newIndex) => {
    if (player.playerId === "0") return;
    const oldIndex = league.starters.findIndex((candidate) => candidate.playerId === player.playerId);
    if (oldIndex < 0 || oldIndex === newIndex || slotName(oldIndex) === slotName(newIndex)) return;
    slotMoves.push({ player, from: slotName(oldIndex), to: slotName(newIndex) });
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
    slotMoves,
    gain,
    winBefore: winOf(league.starters),
    winAfter: winOf(optimized.starters),
  };
}
