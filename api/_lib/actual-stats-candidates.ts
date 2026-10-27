/**
 * Choose which live/final players need weekly-stat actuals when Sleeper
 * matchup points are missing. Rostered players are preferred uncapped when
 * the matchup feed failed; free agents stay capped so a cold cache cannot
 * fan out unbounded Sleeper weekly-stat reads.
 */

export const FREE_AGENT_ACTUALS_CAP = 400;

export type ActualStatsCandidateRow = {
  playerId: string;
  gamePhase: "pregame" | "live" | "final" | null;
  leagueProjection: number | null;
};

/**
 * Returns player ids that should load weekly stat lines for actuals.
 * When the matchup feed is missing, every rostered live/final player without
 * points is included (no cap). Free agents are sorted by projection and
 * capped at `freeAgentCap` (default {@link FREE_AGENT_ACTUALS_CAP}).
 */
export function selectActualStatsCandidateIds(opts: {
  rows: ReadonlyArray<ActualStatsCandidateRow>;
  rosteredIds: ReadonlySet<string>;
  matchupPointsByPlayerId: ReadonlyMap<string, number>;
  matchupFeedMissing: boolean;
  freeAgentCap?: number;
}): string[] {
  const freeAgentCap = opts.freeAgentCap ?? FREE_AGENT_ACTUALS_CAP;
  const needsStats = (row: ActualStatsCandidateRow): boolean => (
    (row.gamePhase === "live" || row.gamePhase === "final")
    && !opts.matchupPointsByPlayerId.has(row.playerId)
  );

  const rosteredNeeded = opts.matchupFeedMissing
    ? opts.rows
      .filter((row) => needsStats(row) && opts.rosteredIds.has(row.playerId))
      .map((row) => row.playerId)
    : [];

  const freeAgents = opts.rows
    .filter((row) => needsStats(row) && !opts.rosteredIds.has(row.playerId))
    .sort((a, b) => (
      (b.leagueProjection ?? Number.NEGATIVE_INFINITY)
      - (a.leagueProjection ?? Number.NEGATIVE_INFINITY)
      || a.playerId.localeCompare(b.playerId)
    ))
    .slice(0, freeAgentCap)
    .map((row) => row.playerId);

  return [...new Set([...rosteredNeeded, ...freeAgents])];
}
