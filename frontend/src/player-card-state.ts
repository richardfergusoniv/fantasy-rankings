import type { Dashboard, PlayerSearchResult } from "./dashboard-types";
export function refreshPlayerCard(history: { entries: PlayerSearchResult[]; index: number }, player: PlayerSearchResult) {
  if (history.entries[history.index]?.playerId !== player.playerId) return history;
  // Streamed dashboard assembly may create new objects without changing detail.
  if (JSON.stringify(history.entries[history.index]) === JSON.stringify(player)) return history;
  const entries = [...history.entries];
  entries[history.index] = player;
  return { ...history, entries };
}
export function playerPointsLabel(player: Pick<PlayerSearchResult, "gamePhase" | "actual">): string {
  if (player.gamePhase === "final" && typeof player.actual === "number" && Number.isFinite(player.actual)) return "points";
  return player.gamePhase === "live" ? "live projection" : "projection";
}

/** A final observed score is rankable even when no projection was available. */
export function playerWeeklyRank(
  weekly: Pick<Dashboard["rankings"][number], "leagueProjection" | "gamePhase" | "actual" | "pprRank" | "halfPprRank">,
  rankingField: "ppr" | "halfPpr",
): number | null {
  const hasFinalActual = weekly.gamePhase === "final"
    && typeof weekly.actual === "number" && Number.isFinite(weekly.actual);
  if (weekly.leagueProjection === null && !hasFinalActual) return null;
  return rankingField === "ppr" ? weekly.pprRank : weekly.halfPprRank;
}
