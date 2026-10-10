/** True when Optimized mode put a different player in this slot than the current lineup. */
export function isOptimizedSlotChanged(
  optimizedPlayerId: string | null | undefined,
  currentPlayerId: string | null | undefined,
): boolean {
  return (optimizedPlayerId ?? null) !== (currentPlayerId ?? null);
}

/** Score button classes — amber projection only when the optimizer changed the slot. */
export function matchupProjectionClassName(options: {
  scoreLabel: "PROJ" | "PTS";
  slotChanged: boolean;
}): string {
  const parts = ["matchup-number", "matchup-player-score"];
  if (options.scoreLabel === "PTS") parts.push("actual");
  if (options.slotChanged) parts.push("is-optimized-change");
  return parts.join(" ");
}
