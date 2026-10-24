/**
 * Tuesday refill of projection_accuracy.actual_score after stat corrections.
 * Logic lives here; the cron dispatcher in api/cron/jobs.ts invokes it.
 * No new Vercel function.
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { scoreProjectedPlayerStats } from "./fantasy-scoring.js";
import {
  DYNASTICAL_CUCKS_LEAGUE_ID,
  loadSleeperPlayerWeeklySeason,
  sleeperActualStats,
} from "./sleeper.js";
import { readNflState } from "./user-leagues.js";

/** Canonical full-PPR — matches the PPFD league's disclosed PPR-proxy projections. */
export const PPFD_ACTUAL_PPR_SCORING: Record<string, number> = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
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
};

function previousWeek(season: number, week: number): { season: number; week: number } {
  if (week > 1) return { season, week: week - 1 };
  return { season: season - 1, week: 18 };
}

/**
 * Score a Sleeper weekly stats row into fantasy points.
 * PPFD leagues use canonical PPR so actuals match the proxy projection.
 */
export function scoreWeeklyActual(
  position: string,
  stats: Record<string, number>,
  scoring: string,
): number | null {
  if (Object.keys(stats).length === 0) return null;
  const settings =
    scoring === "ppfd" || scoring === "ppr"
      ? PPFD_ACTUAL_PPR_SCORING
      : {
        ...PPFD_ACTUAL_PPR_SCORING,
        rec: 0.5,
      };
  const points = scoreProjectedPlayerStats(position, stats, settings);
  if (!Number.isFinite(points)) return null;
  return points;
}

/**
 * Refill last week's null/stale actuals from Sleeper weekly stats (box-score
 * components) in league scoring. One batched upsert path; never scans
 * player_value_snapshots.
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

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const upserts: Array<{ id: string; actualScore: number }> = [];

  for (const row of rows) {
    try {
      const weekly = await loadSleeperPlayerWeeklySeason(row.playerId, season);
      const weekRow = weekly.find((candidate) => Number(candidate.week) === week);
      if (!weekRow) {
        skipped += 1;
        continue;
      }
      const stats = sleeperActualStats(weekRow);
      const scoring = row.leagueId === DYNASTICAL_CUCKS_LEAGUE_ID ? "ppfd" : row.scoring;
      const points = scoreWeeklyActual(row.position, stats, scoring);
      if (points === null) {
        skipped += 1;
        continue;
      }
      const actualScore = Math.round(points * 100);
      // Skip no-op updates when already filled with the same value.
      if (row.actualScore === actualScore) {
        skipped += 1;
        continue;
      }
      upserts.push({ id: row.id, actualScore });
    } catch {
      errors += 1;
    }
  }

  for (let index = 0; index < upserts.length; index += 50) {
    const chunk = upserts.slice(index, index + 50);
    await Promise.all(
      chunk.map((row) =>
        db
          .update(schema.projectionAccuracy)
          .set({ actualScore: row.actualScore })
          .where(eq(schema.projectionAccuracy.id, row.id)),
      ),
    );
    updated += chunk.length;
  }

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
  };
}

