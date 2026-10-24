/**
 * Weekly scoring calibration jobs + free-data snapshots.
 * Invoked from api/cron/jobs.ts — no new Vercel functions.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { readGlobalDashboardSnapshot } from "./dashboard-build.js";
import type { Dashboard } from "./dashboard-schemas.js";
import { db, schema } from "./db.js";
import { eligibleForSlot, optimizeLineup } from "./lineup-optimizer.js";
import {
  assertLabelsNotRefit,
  blendProjection,
  BUILTIN_SCORING_WEIGHTS,
  scoreStartSit,
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
  if (!process.env.DATABASE_URL) {
    cachedActiveWeights = { params: BUILTIN_SCORING_WEIGHTS, loadedAt: Date.now() };
    return BUILTIN_SCORING_WEIGHTS;
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
  } catch (error) {
    // Table may not exist yet in local/dev. Do not cache transient failures.
    console.error("loadActiveScoringWeights: falling back to built-in weights", error);
    return BUILTIN_SCORING_WEIGHTS;
  }
  cachedActiveWeights = { params: BUILTIN_SCORING_WEIGHTS, loadedAt: Date.now() };
  return BUILTIN_SCORING_WEIGHTS;
}

export function clearActiveWeightsCache(): void {
  cachedActiveWeights = null;
}

export function scoringSnapshotId(
  season: number,
  week: number,
  leagueId: string,
  playerId: string,
): string {
  return `${season}:${week}:${leagueId}:${playerId}`;
}

type SnapshotPlayerSource = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  projection: number | null;
  vegasProjection: number | null;
  injuryStatus: string | null;
  isBye: boolean;
  gamePhase: "pregame" | "live" | "final" | null;
  actual: number | null;
  isRostered: boolean;
  isWaiverPool: boolean;
};

function collectSnapshotPlayers(dashboard: Dashboard, leagueId: string): SnapshotPlayerSource[] {
  const league = dashboard.leagues.find((row) => row.id === leagueId);
  if (!league) return [];

  const byId = new Map<string, SnapshotPlayerSource>();
  const upsert = (row: SnapshotPlayerSource) => {
    const existing = byId.get(row.playerId);
    if (!existing) {
      byId.set(row.playerId, row);
      return;
    }
    byId.set(row.playerId, {
      ...existing,
      ...row,
      isRostered: existing.isRostered || row.isRostered,
      isWaiverPool: existing.isWaiverPool || row.isWaiverPool,
      vegasProjection: row.vegasProjection ?? existing.vegasProjection,
      projection: row.projection ?? existing.projection,
    });
  };

  for (const player of [...league.starters, ...league.bench]) {
    if (!player.playerId || player.playerId === "0") continue;
    upsert({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      team: player.team,
      projection: player.projection,
      vegasProjection: player.projection,
      injuryStatus: player.injuryStatus,
      isBye: player.isBye,
      gamePhase: player.gamePhase,
      actual: player.actual,
      isRostered: true,
      isWaiverPool: false,
    });
  }

  for (const player of league.tradeWaiverPool) {
    if (!player.playerId || player.playerId === "0") continue;
    upsert({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      team: player.team,
      projection: player.projection,
      vegasProjection: player.projection,
      injuryStatus: player.injuryStatus,
      isBye: player.isBye,
      gamePhase: player.gamePhase,
      actual: player.actual,
      isRostered: false,
      isWaiverPool: true,
    });
  }

  for (const ranking of dashboard.rankings.filter((row) => row.leagueId === leagueId)) {
    const existing = byId.get(ranking.playerId);
    if (!existing) {
      upsert({
        playerId: ranking.playerId,
        name: ranking.name,
        position: ranking.position,
        team: ranking.team,
        projection: ranking.leagueProjection,
        vegasProjection: ranking.leagueProjection,
        injuryStatus: ranking.injuryStatus,
        isBye: ranking.isBye,
        gamePhase: null,
        actual: null,
        isRostered: false,
        isWaiverPool: true,
      });
      continue;
    }
    upsert({
      ...existing,
      vegasProjection: ranking.leagueProjection ?? existing.vegasProjection,
      projection: ranking.leagueProjection ?? existing.projection,
      injuryStatus: ranking.injuryStatus ?? existing.injuryStatus,
      isBye: ranking.isBye,
    });
  }

  return [...byId.values()];
}

/**
 * Saturday decision-time snapshot: one immutable row per rostered player and
 * waiver-pool / ranking player from the owner dashboard. Never overwrites.
 */
export async function runScoringDecisionSnapshot(
  opts: { season?: number; week?: number } = {},
): Promise<{ ok: boolean; season: number; week: number; rows: number }> {
  const state = await readNflState(true);
  const dashboard = await readGlobalDashboardSnapshot();
  const season = opts.season ?? dashboard?.season ?? state.season;
  const week = opts.week ?? dashboard?.week ?? state.week;
  const weights = await loadActiveScoringWeights();
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

  if (!dashboard || dashboard.leagues.length === 0) {
    return { ok: true, season, week, rows: 0 };
  }

  const experts = dashboard.playerInsights?.experts ?? {};
  const capturedAt = new Date();
  const toInsert: Array<typeof schema.scoringSnapshots.$inferInsert> = [];

  for (const league of dashboard.leagues) {
    const players = collectSnapshotPlayers(dashboard, league.id);
    // Cap per league to keep egress bounded (roster + top of board).
    const limited = players.slice(0, 200);
    const toScored = (player: SnapshotPlayerSource) => ({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      team: player.team,
      vegasProjection: player.vegasProjection,
      injuryStatus: player.injuryStatus,
      isBye: player.isBye,
      gamePhase: player.gamePhase,
      projection: player.projection,
      actual: player.actual,
    });

    // Pairwise start/sit scores for the owner's roster (same pattern as suggest_lineup).
    const rostered = limited.filter((player) => player.isRostered);
    const starters = league.starters.filter((p) => p.playerId && p.playerId !== "0");
    const bench = league.bench.filter((p) => p.playerId && p.playerId !== "0");
    const optimized = optimizeLineup(
      starters.map((p) => ({ ...p })),
      bench.map((p) => ({ ...p })),
    );
    const byId = new Map(rostered.map((player) => [player.playerId, player]));
    const startSitById = new Map<string, ReturnType<typeof scoreStartSit>>();
    for (const starter of optimized.starters) {
      const player = byId.get(starter.playerId);
      if (!player) continue;
      const slot = starter.lineupSlot ?? starter.position;
      const alternativeRow =
        optimized.bench.find((benchPlayer) => eligibleForSlot(benchPlayer.position, slot))
        ?? null;
      const alternative = alternativeRow ? byId.get(alternativeRow.playerId) ?? null : null;
      startSitById.set(
        player.playerId,
        scoreStartSit({
          player: toScored(player),
          alternative: alternative ? toScored(alternative) : null,
          weights,
        }),
      );
    }
    for (const benchPlayer of optimized.bench) {
      const player = byId.get(benchPlayer.playerId);
      if (!player || startSitById.has(player.playerId)) continue;
      const alternativeRow =
        optimized.starters.find((starter) =>
          eligibleForSlot(benchPlayer.position, starter.lineupSlot ?? starter.position),
        )
        ?? null;
      const alternative = alternativeRow ? byId.get(alternativeRow.playerId) ?? null : null;
      // Only persist a Week score when we have a real slot alternative.
      if (!alternative) continue;
      startSitById.set(
        player.playerId,
        scoreStartSit({
          player: toScored(player),
          alternative: toScored(alternative),
          weights,
        }),
      );
    }

    for (const player of limited) {
      const scored = toScored(player);
      const blend = blendProjection(scored, { weights });
      const startSit = startSitById.get(player.playerId) ?? null;
      const expert = experts[player.playerId];
      const inputs = {
        pStar: blend.pStar,
        v: blend.v,
        u: blend.u,
        wV: blend.wV,
        projection: player.projection,
        vegasProjection: player.vegasProjection,
        usageProjection: null,
        vacatedTargetSharePts: null,
        vacatedCarriesPerGame: null,
        forecastWindMph: null,
        injuryStatus: player.injuryStatus,
        isBye: player.isBye,
        isRostered: player.isRostered,
        isWaiverPool: player.isWaiverPool,
        ecr: expert?.ecr ?? null,
        positionRank: expert?.positionRank ?? null,
      };
      // Never write the no-alternative placeholder (100 / Strong start).
      const scores = {
        week: startSit?.week.score ?? null,
        pStar: blend.pStar,
      };
      const labels = {
        week: startSit?.week.label ?? "",
      };
      const tiebreak = startSit?.week.tiebreak;
      toInsert.push({
        id: scoringSnapshotId(season, week, league.id, player.playerId),
        season,
        week,
        leagueId: league.id,
        playerId: player.playerId,
        weightsVersion: version,
        inputsJson: JSON.stringify(inputs),
        scoresJson: JSON.stringify(scores),
        labelsJson: JSON.stringify(labels),
        ruleApplied: tiebreak?.rule ?? null,
        pickBefore: tiebreak?.pickBefore ?? null,
        pickAfter: tiebreak?.pickAfter ?? null,
        finalPoints: null,
        capturedAt,
        finalizedAt: null,
      });
    }
  }

  let wrote = 0;
  for (let index = 0; index < toInsert.length; index += 50) {
    const chunk = toInsert.slice(index, index + 50);
    if (chunk.length === 0) continue;
    await db.insert(schema.scoringSnapshots).values(chunk).onConflictDoNothing();
    wrote += chunk.length;
  }

  return { ok: true, season, week, rows: wrote };
}

/**
 * Tuesday: fill final_points on last week's scoring_snapshots from
 * projection_accuracy (league-scored) when available. Indexed lookups only.
 */
export async function finalizeScoringSnapshotActuals(
  opts: { season: number; week: number },
): Promise<{ ok: boolean; scanned: number; updated: number }> {
  const snapshots = await db
    .select({
      id: schema.scoringSnapshots.id,
      leagueId: schema.scoringSnapshots.leagueId,
      playerId: schema.scoringSnapshots.playerId,
      finalPoints: schema.scoringSnapshots.finalPoints,
    })
    .from(schema.scoringSnapshots)
    .where(
      and(
        eq(schema.scoringSnapshots.season, opts.season),
        eq(schema.scoringSnapshots.week, opts.week),
      ),
    )
    .limit(5_000);

  if (snapshots.length === 0) {
    return { ok: true, scanned: 0, updated: 0 };
  }

  const accuracy = await db
    .select({
      leagueId: schema.projectionAccuracy.leagueId,
      playerId: schema.projectionAccuracy.playerId,
      actualScore: schema.projectionAccuracy.actualScore,
    })
    .from(schema.projectionAccuracy)
    .where(
      and(
        eq(schema.projectionAccuracy.season, opts.season),
        eq(schema.projectionAccuracy.week, opts.week),
        isNotNull(schema.projectionAccuracy.actualScore),
      ),
    )
    .limit(5_000);

  const actualByKey = new Map(
    accuracy
      .filter((row) => row.actualScore != null)
      .map((row) => [`${row.leagueId}:${row.playerId}`, row.actualScore as number]),
  );

  let updated = 0;
  const now = new Date();
  for (const row of snapshots) {
    if (row.finalPoints != null) continue;
    const actual = actualByKey.get(`${row.leagueId}:${row.playerId}`);
    if (actual == null) continue;
    await db
      .update(schema.scoringSnapshots)
      .set({ finalPoints: actual, finalizedAt: now })
      .where(eq(schema.scoringSnapshots.id, row.id));
    updated += 1;
  }

  return { ok: true, scanned: snapshots.length, updated };
}

type SnapshotMetricRow = {
  week: number;
  pStar: number;
  finalPoints: number;
};

function parseSnapshotMetrics(
  rows: Array<{ week: number; inputsJson: string; finalPoints: number | null }>,
): SnapshotMetricRow[] {
  const out: SnapshotMetricRow[] = [];
  for (const row of rows) {
    if (row.finalPoints == null) continue;
    try {
      const inputs = JSON.parse(row.inputsJson) as { pStar?: number };
      if (typeof inputs.pStar !== "number" || !Number.isFinite(inputs.pStar)) continue;
      out.push({
        week: row.week,
        pStar: inputs.pStar,
        finalPoints: row.finalPoints / 100,
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}

function rmseOf(rows: SnapshotMetricRow[]): number {
  if (rows.length === 0) return 8;
  const mse = rows.reduce((sum, row) => {
    const err = row.pStar - row.finalPoints;
    return sum + err * err;
  }, 0) / rows.length;
  return Math.sqrt(mse);
}

/**
 * Tuesday-night refit: build a candidate weights row and promote only if
 * guardrails pass. Label thresholds are never refit. Metrics come from
 * scoring_snapshots with final_points filled.
 */
export async function runScoringWeightsRefit(): Promise<{
  ok: boolean;
  promoted: boolean;
  reason: string;
  version: string | null;
}> {
  assertLabelsNotRefit();

  const state = await readNflState(true);
  const season = state.season;

  const weekRows = await db
    .select({ week: schema.scoringSnapshots.week })
    .from(schema.scoringSnapshots)
    .where(eq(schema.scoringSnapshots.season, season))
    .groupBy(schema.scoringSnapshots.week)
    .orderBy(schema.scoringSnapshots.week)
    .limit(52);
  const weeks = weekRows.map((row) => row.week).sort((a, b) => a - b);
  const snapshotWeekCount = weeks.length;

  const labeled = await db
    .select({
      week: schema.scoringSnapshots.week,
      inputsJson: schema.scoringSnapshots.inputsJson,
      finalPoints: schema.scoringSnapshots.finalPoints,
    })
    .from(schema.scoringSnapshots)
    .where(
      and(
        eq(schema.scoringSnapshots.season, season),
        isNotNull(schema.scoringSnapshots.finalPoints),
      ),
    )
    .limit(10_000);

  const metrics = parseSnapshotMetrics(labeled);
  const holdoutWeeks = weeks.slice(-2);
  const fitWeeks = weeks.slice(0, Math.max(0, weeks.length - 2));
  const holdoutRows = metrics.filter((row) => holdoutWeeks.includes(row.week));
  const fitRows = metrics.filter((row) => fitWeeks.includes(row.week));

  const active = await loadActiveScoringWeights();
  const activeHoldout = {
    playerGames: holdoutRows.length,
    rmse: rmseOf(holdoutRows),
    // Win-chance Brier needs paired start/sit outcomes; until those are stored,
    // keep a neutral prior so the Brier guardrail does not block on missing data.
    brier: 0.25,
  };
  // Candidate uses the same projection path today (weights unchanged until a
  // real observed-w_v fit lands). Holdout metrics therefore match active;
  // shouldPromoteWeights rejects until RMSE improves.
  const candidateHoldout = {
    playerGames: holdoutRows.length,
    rmse: rmseOf(holdoutRows),
    brier: 0.25,
  };

  const decision = shouldPromoteWeights({
    snapshotWeekCount,
    activeHoldout,
    candidateHoldout,
  });

  const version = `move-scoring-v1-candidate-${new Date().toISOString().slice(0, 10)}`;
  try {
    await db.insert(schema.scoringWeights).values({
      version,
      status: "candidate",
      // Persist the candidate version inside params so snapshots after
      // promotion record the promoted row id, not the prior builtin string.
      paramsJson: JSON.stringify({ ...active, version }),
      holdoutJson: JSON.stringify({
        snapshotWeekCount,
        fitWeeks,
        holdoutWeeks,
        fitPlayerGames: fitRows.length,
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

/** Test helper: expose metric parsing without DB. */
export function __testParseSnapshotMetrics(
  rows: Array<{ week: number; inputsJson: string; finalPoints: number | null }>,
): { playerGames: number; rmse: number } {
  const metrics = parseSnapshotMetrics(rows);
  return { playerGames: metrics.length, rmse: rmseOf(metrics) };
}
