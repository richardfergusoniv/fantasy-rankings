/** True when Optimized starters differ from the current lineup at any slot. */
export function isOptimizedLineupChanged(
  optimizedStarterIds: Array<string | null | undefined>,
  currentStarterIds: Array<string | null | undefined>,
): boolean {
  const length = Math.max(optimizedStarterIds.length, currentStarterIds.length);
  for (let index = 0; index < length; index += 1) {
    if ((optimizedStarterIds[index] ?? null) !== (currentStarterIds[index] ?? null)) {
      return true;
    }
  }
  return false;
}

/** Per-player score button classes — no amber highlight on row projections. */
export function matchupProjectionClassName(options: {
  scoreLabel: "PROJ" | "PTS";
}): string {
  const parts = ["matchup-number", "matchup-player-score"];
  if (options.scoreLabel === "PTS") parts.push("actual");
  return parts.join(" ");
}

/** Matchup card total projection — amber only when Optimized and lineup isn't already set. */
export function optimizedTotalProjectionClassName(options: {
  optimizedMode: boolean;
  lineupChanged: boolean;
}): string | undefined {
  if (options.optimizedMode && options.lineupChanged) return "is-optimized-total";
  return undefined;
}
