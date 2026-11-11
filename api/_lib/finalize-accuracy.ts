/**
 * Tuesday refill of projection_accuracy.actual_score after stat corrections.
 * Logic lives here; the cron dispatcher in api/cron/jobs.ts invokes it.
 * No new Vercel function.
 */

import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { readGlobalDashboardSnapshot } from "./dashboard-build.js";
import { db, schema } from "./db.js";
import { scoreProjectedPlayerStats } from "./fantasy-scoring.js";
import { firstDownLookup } from "./first-down-points.js";
import { vegasProjectionPayloadSchema } from "./ingest-helpers.js";
import { finalizeScoringSnapshotActuals } from "./scoring-jobs.js";
import {
  DYNASTICAL_CUCKS_LEAGUE_ID,
  loadSleeperPlayerWeeklySeason,
  sleeperActualStats,
  type SleeperWeeklyStatRow,
} from "./sleeper.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";
import { readNflState } from "./user-leagues.js";

/** Canonical full-PPR — matches the PPFD league's disclosed PPR-proxy projections. */
export const PPFD_ACTUAL_PPR_SCORING: Record<string, number> = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  fum_lost: -2,
};

export type FinalizeAccuracyResult = {
  ok: boolean;
  job: "finalize-accuracy";
  season: number;
  week: number;
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
  snapshotsUpdated?: number;
  /** True when the week had more rows than one call reads, so some were not looked at. */
  truncated?: boolean;
  /** False when copying the finals onto scoring snapshots failed. */
  snapshotsOk?: boolean;
};

/** Most rows one week's grading or First Down fill reads in a call; a week this big is reported, not silently cut short. */
export const ACCURACY_ROW_LIMIT = 2_000;
const WEEKLY_FETCH_CONCURRENCY = 6;
const UPSERT_CHUNK = 40;

function previousWeek(season: number, week: number): { season: number; week: number } {
  if (week > 1) return { season, week: week - 1 };
  return { season: season - 1, week: 18 };
}

function settingsFromScoringLabel(scoring: string): Record<string, number> {
  if (scoring === "ppfd" || scoring === "ppr") return { ...PPFD_ACTUAL_PPR_SCORING };
  return { ...PPFD_ACTUAL_PPR_SCORING, rec: 0.5 };
}

/**
 * Score a Sleeper weekly stats row into fantasy points.
 * Prefer full league scoring_settings when provided; otherwise fall back to
 * the row's scoring label (ppr / halfPpr / ppfd).
 */
export function scoreWeeklyActual(
  position: string,
  stats: Record<string, number>,
  scoring: string | Record<string, number>,
): number | null {
  if (Object.keys(stats).length === 0) return null;
  const settings =
    typeof scoring === "string" ? settingsFromScoringLabel(scoring) : scoring;
  const points = scoreProjectedPlayerStats(position, stats, settings);
  if (!Number.isFinite(points)) return null;
  return points;
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function flushAccuracyUpdates(
  rows: Array<{ id: string; actualScore: number }>,
): Promise<number> {
  let wrote = 0;
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK);
    await Promise.all(
      chunk.map((row) =>
        db
          .update(schema.projectionAccuracy)
          .set({ actualScore: row.actualScore })
          .where(eq(schema.projectionAccuracy.id, row.id)),
      ),
    );
    wrote += chunk.length;
  }
  return wrote;
}

/**
 * Refill last week's null/stale actuals from Sleeper weekly stats (box-score
 * components) in league scoring. Unique player loads with bounded concurrency;
 * updates flush in chunks so a timeout does not discard all work. Never scans
 * player_value_snapshots. Also copies finals onto scoring_snapshots.
 */
export async function finalizeProjectionAccuracy(
  opts: { season?: number; week?: number; /** Only grade rows that have no actual yet (a backfill). */ onlyMissing?: boolean } = {},
): Promise<FinalizeAccuracyResult> {
  let season = opts.season;
  let week = opts.week;
  if (season == null || week == null) {
    const state = await readNflState(true);
    const prev = previousWeek(state.season, state.week);
    season = opts.season ?? prev.season;
    week = opts.week ?? prev.week;
  }

  const rows = await db
    .select()
    .from(schema.projectionAccuracy)
    .where(
      and(
        eq(schema.projectionAccuracy.season, season),
        eq(schema.projectionAccuracy.week, week),
        opts.onlyMissing ? isNull(schema.projectionAccuracy.actualScore) : undefined,
      ),
    )
    .limit(ACCURACY_ROW_LIMIT);

  const dashboard = await readGlobalDashboardSnapshot().catch(() => null);
  const settingsByLeague = new Map<string, Record<string, number>>();
  if (dashboard) {
    for (const league of dashboard.leagues) {
      if (league.scoringSettings && Object.keys(league.scoringSettings).length > 0) {
        settingsByLeague.set(league.id, league.scoringSettings);
      }
    }
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const uniquePlayerIds = [...new Set(rows.map((row) => row.playerId))];
  const weeklyByPlayer = new Map<string, SleeperWeeklyStatRow[] | null>();
  await mapPool(uniquePlayerIds, WEEKLY_FETCH_CONCURRENCY, async (playerId) => {
    try {
      const weekly = await loadSleeperPlayerWeeklySeason(playerId, season!, { fresh: true });
      weeklyByPlayer.set(playerId, weekly);
    } catch {
      weeklyByPlayer.set(playerId, null);
    }
    return null;
  });

  const pending: Array<{ id: string; actualScore: number }> = [];
  for (const row of rows) {
    try {
      const isPpfd = row.leagueId === DYNASTICAL_CUCKS_LEAGUE_ID || row.scoring === "ppfd";
      const leagueSettings = settingsByLeague.get(row.leagueId);

      // A backfill must not save an approximate score: without the league's own scoring settings the row
      // stays ungraded and the week stays pending, instead of falling back to a PPR/half-PPR label.
      if (opts.onlyMissing && !isPpfd && !leagueSettings) {
        errors += 1;
        continue;
      }

      // Non-PPFD rows already filled by saveProjectionAccuracy at game-final use
      // the league's live scoring. Do not overwrite them with a PPR/half-PPR proxy
      // when full settings are unavailable.
      if (!isPpfd && row.actualScore != null && !leagueSettings) {
        skipped += 1;
        continue;
      }

      const weekly = weeklyByPlayer.get(row.playerId);
      if (weekly == null) {
        // Prefetch failed for this player — count one error per affected row so
        // a full Sleeper outage fails the job (errors === rows.length).
        errors += 1;
        continue;
      }
      const weekRow = weekly.find((candidate) => Number(candidate.week) === week);
      if (!weekRow) {
        skipped += 1;
        continue;
      }
      const stats = sleeperActualStats(weekRow);
      const scoring: string | Record<string, number> = isPpfd
        ? "ppfd"
        : (leagueSettings ?? row.scoring);
      const points = scoreWeeklyActual(row.position, stats, scoring);
      if (points === null) {
        skipped += 1;
        continue;
      }
      const actualScore = Math.round(points * 100);
      if (row.actualScore === actualScore) {
        skipped += 1;
        continue;
      }
      pending.push({ id: row.id, actualScore });
      if (pending.length >= UPSERT_CHUNK) {
        updated += await flushAccuracyUpdates(pending.splice(0, pending.length));
      }
    } catch {
      errors += 1;
    }
  }

  if (pending.length > 0) {
    updated += await flushAccuracyUpdates(pending);
  }

  const snapshots = await finalizeScoringSnapshotActuals({ season, week }).catch(() => ({
    ok: false,
    scanned: 0,
    updated: 0,
  }));

  return {
    // Fail the job when every scanned row errored (e.g. Sleeper outage).
    ok: rows.length === 0 || errors < rows.length,
    job: "finalize-accuracy",
    season,
    week,
    scanned: rows.length,
    updated,
    skipped,
    errors,
    snapshotsUpdated: snapshots.updated,
    truncated: rows.length >= ACCURACY_ROW_LIMIT,
    snapshotsOk: snapshots.ok,
  };
}


export type BackfillAccuracyResult = {
  ok: boolean;
  job: "finalize-accuracy-backfill";
  season: number;
  /** Weeks graded or filled in this call, oldest first. */
  weeksProcessed: number[];
  /** Weeks that still have rows without an actual; call again to continue. */
  weeksRemaining: number[];
  actualsGraded: number;
  firstDownFilled: number;
  errors: number;
  /** True when no week before the current one is waiting to be graded. */
  done: boolean;
};

const backfillCursorKey = (season: number) => `accuracy-backfill-cursor-v1:${season}`;

/** The last week the backfill finished for a season (0 when none). Weeks up to it are not looked at again. */
async function readBackfillCursor(season: number): Promise<number> {
  try {
    const rows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, backfillCursorKey(season))).limit(1);
    const payload = rows[0] ? decodeSourceCachePayload(rows[0].payload) as { lastWeek?: unknown } : null;
    return typeof payload?.lastWeek === "number" && Number.isInteger(payload.lastWeek) ? payload.lastWeek : 0;
  } catch {
    return 0;
  }
}

async function writeBackfillCursor(season: number, lastWeek: number): Promise<void> {
  const payload = JSON.stringify({ lastWeek });
  const fetchedAt = new Date();
  await db.insert(schema.sourceCache).values({ cacheKey: backfillCursorKey(season), payload, fetchedAt }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload, fetchedAt },
  });
}

/**
 * The weeks still to do, in order: finished weeks after the cursor. A week whose
 * only missing actuals are players who never played would otherwise be re-checked
 * on every call and use up the time budget before later weeks are reached.
 */
export function weeksToBackfill(weeksWithRows: readonly number[], cursor: number): number[] {
  return [...new Set(weeksWithRows)].filter((week) => week > cursor).sort((a, b) => a - b);
}

/**
 * A week is complete only when nothing errored and every row was looked at. A week
 * with more rows than one call reads stays pending (and the job reports not done)
 * instead of being passed silently with rows left unfilled.
 */
export function backfillWeekCompleted(week: { errors: number; truncated: boolean; snapshotsOk?: boolean }): boolean {
  return week.errors === 0 && !week.truncated && week.snapshotsOk !== false;
}

/**
 * Whether a First Down board can stand beside a projection captured at `capturedAt`. A board built
 * after the capture would be a later forecast than the props projection it is paired with, so the
 * row is left empty instead (only the latest board per week is stored, so the earlier one is gone).
 */
export function firstDownBoardPrecedesCapture(builtAt: string, capturedAt: Date): boolean {
  const built = Date.parse(builtAt);
  return Number.isFinite(built) && built <= capturedAt.getTime();
}

/** Start no new week once this much of the budget is spent: one week's Sleeper loads take 10-30 seconds. */
const BACKFILL_BUDGET_MS = 20_000;

/**
 * Fills First Down's projection into rows saved before it was recorded, from the
 * First Down snapshot stored for the same week. Returns how many rows it filled.
 */
export async function fillFirstDownProjections(season: number, week: number): Promise<{ filled: number; truncated: boolean }> {
  const snapshotRows = await db
    .select()
    .from(schema.vegasProjectionSnapshots)
    .where(and(eq(schema.vegasProjectionSnapshots.season, season), eq(schema.vegasProjectionSnapshots.week, week)));
  let snapshot: ReturnType<typeof vegasProjectionPayloadSchema.parse> | null = null;
  for (const row of snapshotRows.sort((a, b) => b.builtAt.getTime() - a.builtAt.getTime())) {
    try {
      const payload = vegasProjectionPayloadSchema.parse(JSON.parse(row.payload));
      if (payload.source === "first_down") {
        snapshot = payload;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!snapshot) return { filled: 0, truncated: false };
  const lookup = firstDownLookup(snapshot);
  const rows = await db
    .select()
    .from(schema.projectionAccuracy)
    .where(and(eq(schema.projectionAccuracy.season, season), eq(schema.projectionAccuracy.week, week), isNull(schema.projectionAccuracy.firstDownProjection)))
    .limit(ACCURACY_ROW_LIMIT);
  const updates = rows.flatMap((row) => {
    if (!firstDownBoardPrecedesCapture(snapshot!.built_at, row.capturedAt)) return [];
    const points = lookup({ leagueId: row.leagueId, name: row.playerName, position: row.position });
    return points === null ? [] : [{ id: row.id, firstDownProjection: Math.round(points * 100) }];
  });
  for (let index = 0; index < updates.length; index += UPSERT_CHUNK) {
    await Promise.all(
      updates.slice(index, index + UPSERT_CHUNK).map((update) =>
        db.update(schema.projectionAccuracy).set({ firstDownProjection: update.firstDownProjection }).where(eq(schema.projectionAccuracy.id, update.id)),
      ),
    );
  }
  return { filled: updates.length, truncated: rows.length >= ACCURACY_ROW_LIMIT };
}

/**
 * Catches up every finished week of the season: grades rows that never got an
 * actual and fills in First Down's projection. Oldest week first, within a time
 * budget, so a call that runs out of time can simply be repeated.
 */
export async function backfillProjectionAccuracy(opts: { season?: number; budgetMs?: number; /** Ignore the saved cursor and go through every finished week again. */ reset?: boolean } = {}): Promise<BackfillAccuracyResult> {
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? BACKFILL_BUDGET_MS;
  const state = await readNflState(true);
  const season = opts.season ?? state.season;
  // The current week is still being played; the Tuesday job grades it once it is over.
  const finishedBefore = season === state.season ? state.week : 19;

  const weekRows = await db
    .selectDistinct({ week: schema.projectionAccuracy.week })
    .from(schema.projectionAccuracy)
    .where(and(eq(schema.projectionAccuracy.season, season), lt(schema.projectionAccuracy.week, finishedBefore)))
    .orderBy(asc(schema.projectionAccuracy.week));
  // A reset clears the saved cursor first, so a failed first week can't leave the old one in place.
  if (opts.reset) await writeBackfillCursor(season, 0);
  const cursor = opts.reset ? 0 : await readBackfillCursor(season);
  const weeks = weeksToBackfill(weekRows.map((row) => row.week), cursor);

  const weeksProcessed: number[] = [];
  let cursorNow = cursor;
  let actualsGraded = 0;
  let firstDownFilled = 0;
  let errors = 0;
  for (const week of weeks) {
    // One week's Sleeper loads take 10-30 seconds and the function stops at 60, so no new week starts late.
    if (Date.now() - startedAt > budgetMs) break;
    let completed = false;
    try {
      const fill = await fillFirstDownProjections(season, week);
      firstDownFilled += fill.filled;
      const missing = await db
        .select({ id: schema.projectionAccuracy.id })
        .from(schema.projectionAccuracy)
        .where(and(eq(schema.projectionAccuracy.season, season), eq(schema.projectionAccuracy.week, week), isNull(schema.projectionAccuracy.actualScore)))
        .limit(1);
      if (missing.length > 0) {
        const result = await finalizeProjectionAccuracy({ season, week, onlyMissing: true });
        actualsGraded += result.updated;
        errors += result.errors;
        completed = backfillWeekCompleted({ errors: result.errors, truncated: fill.truncated || result.truncated === true, snapshotsOk: result.snapshotsOk });
      } else {
        completed = backfillWeekCompleted({ errors: 0, truncated: fill.truncated });
      }
    } catch (error) {
      console.error("[finalize-accuracy] backfill failed for week", week, error instanceof Error ? error.message : error);
      errors += 1;
    }
    weeksProcessed.push(week);
    // Stop at the first week that isn't complete: the cursor can't pass it, and it is tried again next call.
    if (!completed) break;
    // Saved week by week, so a call cut off by the time limit still keeps the weeks it finished.
    cursorNow = week;
    await writeBackfillCursor(season, week);
  }

  const unprocessed = weeks.filter((week) => week > cursorNow);
  return {
    ok: errors === 0,
    job: "finalize-accuracy-backfill",
    season,
    weeksProcessed,
    weeksRemaining: unprocessed,
    actualsGraded,
    firstDownFilled,
    errors,
    // Rows left without an actual after grading are players who didn't play (no stat line), so only unprocessed weeks count.
    done: unprocessed.length === 0,
  };
}
