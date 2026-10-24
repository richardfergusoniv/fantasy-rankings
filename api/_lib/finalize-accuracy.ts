/**
 * Tuesday refill of projection_accuracy.actual_score after stat corrections.
 * Logic lives here; the cron dispatcher in api/cron/jobs.ts invokes it.
 * No new Vercel function.
 */

import { and, eq } from "drizzle-orm";
import { readGlobalDashboardSnapshot } from "./dashboard-build.js";
import { db, schema } from "./db.js";
import { scoreProjectedPlayerStats } from "./fantasy-scoring.js";
import { finalizeScoringSnapshotActuals } from "./scoring-jobs.js";
import {
  DYNASTICAL_CUCKS_LEAGUE_ID,
  loadSleeperPlayerWeeklySeason,
  sleeperActualStats,
  type SleeperWeeklyStatRow,
} from "./sleeper.js";
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
};

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
  opts: { season?: number; week?: number } = {},
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
      ),
    )
    .limit(2_000);

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
      errors += 1;
    }
    return null;
  });

  const pending: Array<{ id: string; actualScore: number }> = [];
  for (const row of rows) {
    try {
      const isPpfd = row.leagueId === DYNASTICAL_CUCKS_LEAGUE_ID || row.scoring === "ppfd";
      const leagueSettings = settingsByLeague.get(row.leagueId);

      // Non-PPFD rows already filled by saveProjectionAccuracy at game-final use
      // the league's live scoring. Do not overwrite them with a PPR/half-PPR proxy
      // when full settings are unavailable.
      if (!isPpfd && row.actualScore != null && !leagueSettings) {
        skipped += 1;
        continue;
      }

      const weekly = weeklyByPlayer.get(row.playerId);
      if (weekly == null) {
        // Fetch failed earlier — already counted in errors when the map entry is null.
        if (weeklyByPlayer.has(row.playerId) && weeklyByPlayer.get(row.playerId) === null) {
          skipped += 1;
        } else {
          errors += 1;
        }
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
  };
}
