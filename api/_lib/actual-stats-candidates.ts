/**
 * Choose which live/final players need weekly-stat actuals when Sleeper
 * matchup points are missing for that player. Rostered players are always
 * preferred uncapped; free agents stay capped and time-bounded so a cold
 * cache cannot fan out unbounded Sleeper weekly-stat reads on the build path.
 */

export const FREE_AGENT_ACTUALS_CAP = 400;

/** Soft budget for optional FA weekly-stat loads on the dashboard critical path. */
export const FREE_AGENT_ACTUALS_BUDGET_MS = 4_000;

export type ActualStatsCandidateRow = {
  playerId: string;
  gamePhase: "pregame" | "live" | "final" | null;
  leagueProjection: number | null;
};

export type ActualStatsCandidates = {
  /** Rostered live/final players missing their own matchup points (uncapped). */
  priorityPlayerIds: string[];
  /** Unrostered live/final players, projection-sorted and capped. */
  freeAgentPlayerIds: string[];
};

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Roster/lineup actual for one player: prefer Sleeper matchup points, then
 * the ranking-row or defense actual already stamped by the weekly-stats
 * fallback. Returns null when neither source has a usable score.
 */
export function resolveRosterPlayerActual(opts: {
  matchupPoints: number | null | undefined;
  rankingActual?: number | null;
  defenseActualScore?: number | null;
}): number | null {
  return finiteOrNull(opts.matchupPoints)
    ?? finiteOrNull(opts.rankingActual)
    ?? finiteOrNull(opts.defenseActualScore);
}

/**
 * Split weekly-stat actual candidates into critical rostered ids and capped
 * free agents. A rostered player is selected whenever *that* player lacks
 * numeric matchup points — even if other players already have scores.
 */
export function selectActualStatsCandidates(opts: {
  rows: ReadonlyArray<ActualStatsCandidateRow>;
  rosteredIds: ReadonlySet<string>;
  matchupPointsByPlayerId: ReadonlyMap<string, number>;
  freeAgentCap?: number;
}): ActualStatsCandidates {
  const freeAgentCap = opts.freeAgentCap ?? FREE_AGENT_ACTUALS_CAP;
  const needsStats = (row: ActualStatsCandidateRow): boolean => (
    (row.gamePhase === "live" || row.gamePhase === "final")
    && !opts.matchupPointsByPlayerId.has(row.playerId)
  );

  const priorityPlayerIds = [...new Set(
    opts.rows
      .filter((row) => needsStats(row) && opts.rosteredIds.has(row.playerId))
      .map((row) => row.playerId),
  )];

  const freeAgentPlayerIds = opts.rows
    .filter((row) => needsStats(row) && !opts.rosteredIds.has(row.playerId))
    .sort((a, b) => (
      (b.leagueProjection ?? Number.NEGATIVE_INFINITY)
      - (a.leagueProjection ?? Number.NEGATIVE_INFINITY)
      || a.playerId.localeCompare(b.playerId)
    ))
    .slice(0, freeAgentCap)
    .map((row) => row.playerId);

  return { priorityPlayerIds, freeAgentPlayerIds };
}

/** Milliseconds left until `deadlineAtMs` (never negative). */
export function remainingMsUntil(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, deadlineAtMs - nowMs);
}

/**
 * Soft FA budget capped by the harder build-lease deadline so optional waves
 * cannot outlive the lease wait.
 */
export function remainingOptionalActualsBudgetMs(
  optionalDeadlineAtMs: number,
  buildDeadlineAtMs: number,
  nowMs = Date.now(),
): number {
  return remainingMsUntil(Math.min(optionalDeadlineAtMs, buildDeadlineAtMs), nowMs);
}

/**
 * Await `work` up to `budgetMs`. On timeout, invoke `onTimeout` with the still-
 * pending work (caller can background it) and return `"timeout"` without
 * rejecting — so optional loads cannot blow the dashboard deadline.
 */
export async function awaitWithBudget(
  work: Promise<void>,
  budgetMs: number,
  onTimeout: (pending: Promise<void>) => void,
): Promise<"done" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work.then(() => "done" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), budgetMs);
      }),
    ]);
    if (result === "timeout") onTimeout(work);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
