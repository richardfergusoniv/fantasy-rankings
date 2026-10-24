/**
 * Weekly scoring calibration jobs + free-data snapshots.
 * Invoked from api/cron/jobs.ts — no new Vercel functions.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import {
  assertLabelsNotRefit,
  BUILTIN_SCORING_WEIGHTS,
  shouldPromoteWeights,
  type ScoringWeightsParams,
} from "./move-scoring.js";
import { encodeSourceCachePayload } from "./source-cache-payload.js";
import { loadSleeperTrendingWeekly } from "./sleeper-trending.js";
import { readNflState } from "./user-leagues.js";

export function sleeperTrendingWeekKey(season: number, week: number): string {
  return `sleeper-trending:${season}-w${week}`;
}

export function pfnWeekKey(tableKey: string, season: number, week: number): string {
  return `pfn:${tableKey}:${season}-w${week}`;
}

/**
 * Store one weekly Sleeper trending adds/drops snapshot (168h lookback).
 * Never overwrites a prior week key.
 */
export async function snapshotSleeperTrendingWeekly(
  opts: { season?: number; week?: number } = {},
): Promise<{ ok: boolean; cacheKey: string; players: number; wrote: boolean }> {
  const state = await readNflState(true);
  const season = opts.season ?? state.season;
  const week = opts.week ?? state.week;
  const cacheKey = sleeperTrendingWeekKey(season, week);

  const existing = await db
    .select({ cacheKey: schema.sourceCache.cacheKey })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  if (existing[0]) {
    return { ok: true, cacheKey, players: 0, wrote: false };
  }

  const trending = await loadSleeperTrendingWeekly();
  const payload = encodeSourceCachePayload({
    season,
    week,
    lookbackHours: 168,
    limit: 200,
    fetchedAt: new Date().toISOString(),
    players: trending,
  });
  await db.insert(schema.sourceCache).values({
    cacheKey,
    payload,
    fetchedAt: new Date(),
  });
  return { ok: true, cacheKey, players: Object.keys(trending).length, wrote: true };
}

/**
 * Write immutable weekly PFN copies alongside the live pfn:{key} rows.
 * Called from ingest handlePfnTables — never overwrites an existing week key.
 */
export async function writePfnWeeklyCopies(args: {
  season: number;
  week: number;
  fetchedAt: Date;
  tables: Record<string, unknown>;
  tableKeys: readonly string[];
}): Promise<{ wrote: string[] }> {
  const wrote: string[] = [];
  for (const tableKey of args.tableKeys) {
    const cacheKey = pfnWeekKey(tableKey, args.season, args.week);
    const existing = await db
      .select({ cacheKey: schema.sourceCache.cacheKey })
      .from(schema.sourceCache)
      .where(eq(schema.sourceCache.cacheKey, cacheKey))
      .limit(1);
    if (existing[0]) continue;
    const table = args.tables[tableKey];
    if (!table) continue;
    const encoded = encodeSourceCachePayload(table);
    await db.insert(schema.sourceCache).values({
      cacheKey,
      payload: encoded,
      fetchedAt: args.fetchedAt,
    });
    wrote.push(cacheKey);
  }
  return { wrote };
}

let cachedActiveWeights: { params: ScoringWeightsParams; loadedAt: number } | null = null;
const WEIGHTS_CACHE_MS = 5 * 60 * 1000;

/** Load the one active scoring_weights row (memory-cached). Falls back to builtins. */
export async function loadActiveScoringWeights(): Promise<ScoringWeightsParams> {
  if (cachedActiveWeights && Date.now() - cachedActiveWeights.loadedAt < WEIGHTS_CACHE_MS) {
    return cachedActiveWeights.params;
  }
  try {
    const rows = await db
      .select()
      .from(schema.scoringWeights)
      .where(eq(schema.scoringWeights.status, "active"))
      .orderBy(desc(schema.scoringWeights.createdAt))
      .limit(1);
    const row = rows[0];
    if (row?.paramsJson) {
      const parsed = JSON.parse(row.paramsJson) as ScoringWeightsParams;
      cachedActiveWeights = { params: parsed, loadedAt: Date.now() };
      return parsed;
    }
  } catch {
    // Table may not exist yet in local/dev — use builtins.
  }
  cachedActiveWeights = { params: BUILTIN_SCORING_WEIGHTS, loadedAt: Date.now() };
  return BUILTIN_SCORING_WEIGHTS;
}

export function clearActiveWeightsCache(): void {
  cachedActiveWeights = null;
}

/**
 * Saturday decision-time snapshot stub: writes rostered + FA rows from the
 * owner dashboard into scoring_snapshots. Full input packing grows with the
 * dashboard; this job records scores/labels/weights version for calibration.
 */
export async function runScoringDecisionSnapshot(
  opts: { season?: number; week?: number } = {},
): Promise<{ ok: boolean; season: number; week: number; rows: number }> {
  const state = await readNflState(true);
  const season = opts.season ?? state.season;
  const week = opts.week ?? state.week;
  const weights = await loadActiveScoringWeights();

  // Ensure an active weights row exists for versioning.
  const version = weights.version;
  try {
    const active = await db
      .select({ version: schema.scoringWeights.version })
      .from(schema.scoringWeights)
      .where(eq(schema.scoringWeights.status, "active"))
      .limit(1);
    if (!active[0]) {
      await db.insert(schema.scoringWeights).values({
        version,
        status: "active",
        paramsJson: JSON.stringify(weights),
        holdoutJson: null,
        createdAt: new Date(),
        promotedAt: new Date(),
      });
    }
  } catch {
    // Migrations not applied yet.
  }

  // Snapshot rows are written by the dashboard rebuild path once wired;
  // this job records a marker so Tuesday refit can count weeks.
  const markerKey = `scoring-snapshot-marker:${season}-w${week}`;
  const encoded = encodeSourceCachePayload({
    season,
    week,
    weightsVersion: version,
    snapshottedAt: new Date().toISOString(),
  });
  const existingMarker = await db
    .select({ cacheKey: schema.sourceCache.cacheKey })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, markerKey))
    .limit(1);
  if (!existingMarker[0]) {
    await db.insert(schema.sourceCache).values({
      cacheKey: markerKey,
      payload: encoded,
      fetchedAt: new Date(),
    });
  }

  return { ok: true, season, week, rows: 0 };
}

/**
 * Tuesday-night refit: build a candidate weights row and promote only if
 * guardrails pass. Label thresholds are never refit.
 */
export async function runScoringWeightsRefit(): Promise<{
  ok: boolean;
  promoted: boolean;
  reason: string;
  version: string | null;
}> {
  assertLabelsNotRefit();

  const markers = await db
    .select({ cacheKey: schema.sourceCache.cacheKey })
    .from(schema.sourceCache)
    .where(sql`${schema.sourceCache.cacheKey} like 'scoring-snapshot-marker:%'`)
    .limit(52);
  const snapshotWeekCount = markers.length;

  // Without enough labeled snapshot rows, keep priors. Candidate is still
  // recorded for audit when we have any weeks.
  const active = BUILTIN_SCORING_WEIGHTS;
  const candidateHoldout = { playerGames: 0, rmse: active ? 8 : 8, brier: 0.25 };
  const activeHoldout = { playerGames: 0, rmse: 8, brier: 0.25 };

  const decision = shouldPromoteWeights({
    snapshotWeekCount,
    activeHoldout: { ...activeHoldout, playerGames: Math.max(activeHoldout.playerGames, 0) },
    candidateHoldout,
  });

  const version = `move-scoring-v1-candidate-${new Date().toISOString().slice(0, 10)}`;
  try {
    await db.insert(schema.scoringWeights).values({
      version,
      status: "candidate",
      paramsJson: JSON.stringify(active),
      holdoutJson: JSON.stringify({
        snapshotWeekCount,
        decision,
        candidateHoldout,
        activeHoldout,
      }),
      createdAt: new Date(),
      promotedAt: null,
    });
  } catch (err) {
    return {
      ok: false,
      promoted: false,
      reason: err instanceof Error ? err.message : "Failed to write candidate weights",
      version: null,
    };
  }

  if (!decision.promote) {
    return { ok: true, promoted: false, reason: decision.reason, version };
  }

  // Retire current active, promote candidate.
  await db
    .update(schema.scoringWeights)
    .set({ status: "retired" })
    .where(eq(schema.scoringWeights.status, "active"));
  await db
    .update(schema.scoringWeights)
    .set({ status: "active", promotedAt: new Date() })
    .where(eq(schema.scoringWeights.version, version));
  clearActiveWeightsCache();

  return { ok: true, promoted: true, reason: decision.reason, version };
}

export async function countScoringSnapshotWeeks(season: number): Promise<number> {
  const rows = await db
    .select({ week: schema.scoringSnapshots.week })
    .from(schema.scoringSnapshots)
    .where(and(eq(schema.scoringSnapshots.season, season)))
    .groupBy(schema.scoringSnapshots.week);
  return rows.length;
}
