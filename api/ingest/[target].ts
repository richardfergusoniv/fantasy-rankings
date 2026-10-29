import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "../_lib/db.js";
import { captureServerError } from "../_lib/posthog.js";
import {
  badRequest,
  BodyTooLargeError,
  forbidden,
  hasCronSecret,
  internalError,
  json,
  methodNotAllowed,
  payloadTooLarge,
  readJsonBody,
} from "../_lib/api-utils.js";
import {
  expireDashboardCaches,
  pfnTableKeys,
  stagedMatchupGradesSchema,
  stagedPfnTablesSchema,
  strengthOfScheduleEntrySchema,
  vegasProjectionPayloadSchema,
} from "../_lib/ingest-helpers.js";
import {
  buildPlayerNewsNameIndex,
  buildXNewsDraft,
  filterDuplicateDrafts,
  resolveXNewsPlayer,
  retentionCutoff,
  xNewsBatchSchema,
} from "../_lib/player-news-shared.js";
import {
  buildXNewsMentionNeedles,
  resolveXNewsPlayerIdsForItem,
} from "../_lib/x-news-mentions.js";
import { loadNflPlayersMap } from "../_lib/nfl-players-cache.js";
import { type SleeperPlayer } from "../_lib/sleeper.js";
import {
  propLineSnapshotPayloadSchema,
  toPropLineSnapshotRows,
} from "../_lib/prop-line-snapshots.js";
import {
  normalizeSleeperPicksBoard,
  sleeperPicksCacheKey,
  sleeperPicksIngestSchema,
  type SleeperPicksBoard,
} from "../_lib/sleeper-picks.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "../_lib/source-cache-payload.js";
import { writePfnWeeklyCopies } from "../_lib/scoring-jobs.js";
import { readNflState } from "../_lib/user-leagues.js";

// Ingest payloads are batched provider dumps — cap at 8 MB (the api-utils
// default of 1 MB covers the user-facing routes).
const MAX_INGEST_BODY_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/ingest/:target
 *   target = projections | matchup-grades | pfn-tables | player-news-x
 *            | prop-line-snapshots
 *
 * Single function replacing the three deferred ingest routes to stay within
 * Vercel's function budget. The pipeline POSTs staged JSON directly in the
 * request body; auth is `Authorization: Bearer <CRON_SECRET>` (shared with
 * the props pipeline). URLs are unchanged from the deferred design, so the
 * pipeline contract is untouched.
 *
 * - projections:    upserts `vegas_projection_snapshots`
 *                   (`{season}:{week}:{source}` — one row per source, so a
 *                   First Down board and a Vegas board for the same week
 *                   coexist), skips when that source's existing snapshot
 *                   has a newer `builtAt`, busts the dashboard cache on
 *                   commit.
 * - matchup-grades: writes `strength-of-schedule-v1:{league_id}` rows to
 *                   `source_cache`, skips leagues with a newer stored
 *                   `computedAt`, busts the dashboard cache on commit.
 * - pfn-tables:     writes `pfn:{tableKey}` rows to `source_cache` for the
 *                   4 PFN tables.
 * - player-news-x:  inserts shared player-news rows from X (dedupe by
 *                   post_id + player_id so one roundup can attach to several
 *                   players). Producers should send Sleeper `player_id` when
 *                   known; `player_name` (+ optional `team`) is a fallback.
 *                   Last-name-only names require `team` or the item is dropped.
 * - prop-line-snapshots: inserts dated consensus prop-line rows into
 *                   `prop_line_snapshots` (line-movement history).
 * - sleeper-picks:  stores the normalized Sleeper Picks NFL board as one
 *                   `sleeper-picks:{season}:{week}` source_cache row (the
 *                   Monitor props table's Sleeper reference column).
 */

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

async function handleProjections(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_INGEST_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = vegasProjectionPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid projections payload.", parsed.error.issues);
  }
  const payload = parsed.data;

  const snapshotId = `${payload.season}:${payload.week}:${payload.source}`;
  const builtAt = new Date(payload.built_at);
  const currentRows = await db
    .select()
    .from(schema.vegasProjectionSnapshots)
    .where(eq(schema.vegasProjectionSnapshots.id, snapshotId))
    .limit(1);
  const current = currentRows[0];

  if (current && current.builtAt.getTime() > builtAt.getTime()) {
    return json({
      ok: true,
      status: "ignored",
      season: payload.season,
      week: payload.week,
      savedProjections: 0,
    });
  }

  if (!current || current.builtAt.getTime() < builtAt.getTime()) {
    const storedAt = new Date();
    await db.insert(schema.vegasProjectionSnapshots).values({
      id: snapshotId,
      season: payload.season,
      week: payload.week,
      builtAt,
      source: payload.source,
      payload: JSON.stringify(payload),
      storedAt,
    }).onConflictDoUpdate({
      target: schema.vegasProjectionSnapshots.id,
      set: {
        builtAt,
        source: payload.source,
        payload: JSON.stringify(payload),
        storedAt,
      },
    });
    // Bust global + per-user dashboard caches so the next read rebuilds.
    await expireDashboardCaches();
  }

  return json({
    ok: true,
    status: "committed",
    season: payload.season,
    week: payload.week,
    savedProjections: payload.projections.length,
  });
}

// ---------------------------------------------------------------------------
// matchup-grades
// ---------------------------------------------------------------------------

const STRENGTH_OF_SCHEDULE_CACHE_PREFIX = "strength-of-schedule-v1";

async function handleMatchupGrades(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_INGEST_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = stagedMatchupGradesSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid matchup-grades payload.", parsed.error.issues);
  }
  const payload = parsed.data;

  let committed = 0;
  for (const league of payload.leagues) {
    const cacheKey = `${STRENGTH_OF_SCHEDULE_CACHE_PREFIX}:${league.league_id}`;
    const entry = strengthOfScheduleEntrySchema.parse({
      leagueId: league.league_id,
      season: payload.season,
      throughWeek: league.through_week,
      computedAt: league.computed_at,
      table: league.table,
    });
    const existingRows = await db
      .select()
      .from(schema.sourceCache)
      .where(eq(schema.sourceCache.cacheKey, cacheKey))
      .limit(1);
    const existing = existingRows[0];
    if (existing) {
      try {
        const prev = decodeSourceCachePayload(existing.payload) as { computedAt?: string };
        if (
          prev.computedAt &&
          new Date(prev.computedAt).getTime() >= new Date(league.computed_at).getTime()
        ) {
          continue; // a newer or equal build is already stored
        }
      } catch {
        // Fall through to commit on malformed existing payload.
      }
    }
    const fetchedAt = new Date(league.computed_at);
    const encoded = encodeSourceCachePayload(entry);
    await db
      .insert(schema.sourceCache)
      .values({ cacheKey, payload: encoded, fetchedAt })
      .onConflictDoUpdate({
        target: schema.sourceCache.cacheKey,
        set: { payload: encoded, fetchedAt },
      });
    committed += 1;
  }

  const status = committed > 0 ? ("committed" as const) : ("ignored" as const);
  if (status === "committed") {
    await expireDashboardCaches();
  }

  return json({
    ok: true,
    status,
    season: payload.season,
    throughWeek: payload.through_week,
    leagues: committed,
  });
}

// ---------------------------------------------------------------------------
// pfn-tables
// ---------------------------------------------------------------------------

async function handlePfnTables(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_INGEST_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = stagedPfnTablesSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid PFN tables payload.", parsed.error.issues);
  }
  const payload = parsed.data;

  const fetchedAt = new Date(payload.fetched_at);
  const weeklyTables: Record<string, unknown> = {};
  for (const tableKey of pfnTableKeys) {
    const table = payload.tables[tableKey];
    const stored = {
      fetched_at: payload.fetched_at,
      label: table.label,
      columns: table.columns,
      column_labels: table.column_labels,
      rows: table.rows,
    };
    weeklyTables[tableKey] = stored;
    const cacheKey = `pfn:${tableKey}`;
    const encoded = encodeSourceCachePayload(stored);
    await db.insert(schema.sourceCache).values({
      cacheKey,
      payload: encoded,
      fetchedAt,
    }).onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: encoded, fetchedAt },
    });
  }

  // Immutable weekly copies for calibration (never overwritten).
  let weeklyKeys: string[] = [];
  try {
    const state = await readNflState(false);
    const weekly = await writePfnWeeklyCopies({
      season: state.season,
      week: state.week,
      fetchedAt,
      tables: weeklyTables,
      tableKeys: pfnTableKeys,
    });
    weeklyKeys = weekly.wrote;
  } catch (err) {
    console.error("[ingest/pfn-tables] weekly copy failed", err instanceof Error ? err.message : err);
  }

  return json({
    ok: true,
    status: "committed",
    fetched_at: payload.fetched_at,
    tables: [...pfnTableKeys],
    weeklyCopies: weeklyKeys,
  });
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// player-news-x
// ---------------------------------------------------------------------------

function playerLabel(player: SleeperPlayer): string {
  return player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
}

async function loadPlayerNameIndex() {
  const players = await loadNflPlayersMap(false);
  const entries = [];
  for (const [playerId, player] of Object.entries(players)) {
    const name = playerLabel(player);
    if (!name) continue;
    entries.push({
      playerId,
      player: name,
      team: player.team ?? "FA",
      firstName: player.first_name ?? null,
      lastName: player.last_name ?? null,
    });
  }
  const index = buildPlayerNewsNameIndex(entries);
  const mentionNeedles = buildXNewsMentionNeedles(entries, index);
  return { index, mentionNeedles };
}

async function handlePlayerNewsX(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_INGEST_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = xNewsBatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid player-news-x payload.", parsed.error.issues);
  }

  let loaded: Awaited<ReturnType<typeof loadPlayerNameIndex>>;
  try {
    loaded = await loadPlayerNameIndex();
  } catch {
    return json({ ok: false, error: "Sleeper player data is temporarily unavailable." }, 502);
  }
  const { index, mentionNeedles } = loaded;

  const unresolved: string[] = [];
  const drafts = [];
  for (const item of parsed.data.items) {
    // Producer may send one extract; expand text mentions to every resolvable
    // Sleeper id so multi-player roundups attach Amon-Ra / Gibbs / … too.
    const playerIds = resolveXNewsPlayerIdsForItem(
      item,
      index,
      mentionNeedles,
      resolveXNewsPlayer,
    );
    if (playerIds.length === 0) {
      unresolved.push(item.player_id ?? item.player_name ?? item.post_id);
      continue;
    }
    for (const playerId of playerIds) {
      const meta = index.byId.get(playerId);
      if (!meta) continue;
      drafts.push(
        buildXNewsDraft(item, {
          playerId,
          player: meta.player,
          team: meta.team,
        }),
      );
    }
  }

  const unique = filterDuplicateDrafts(drafts);
  let inserted = 0;
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100).map((draft) => ({
      id: draft.id,
      playerId: draft.playerId,
      player: draft.player,
      team: draft.team,
      change: draft.change,
      newsType: draft.newsType,
      roleContext: draft.roleContext,
      source: draft.source,
      sourceLabel: draft.sourceLabel,
      sourceUrl: draft.sourceUrl,
      author: draft.author,
      externalId: draft.externalId,
      publishedAt: draft.publishedAt,
      signal: draft.signal,
      score: draft.score,
      createdAt: new Date(),
    }));
    const result = await db
      .insert(schema.sharedPlayerNews)
      .values(chunk)
      // Bare ON CONFLICT skips rows that hit either unique index
      // ((source_url, player_id) or (source, external_id, player_id)), so a
      // resent post with a rewritten URL still counts as a duplicate.
      .onConflictDoNothing()
      .returning({ id: schema.sharedPlayerNews.id });
    inserted += result.length;
  }

  const cutoff = retentionCutoff();
  const purged = await db
    .delete(schema.sharedPlayerNews)
    .where(
      or(
        and(
          sql`${schema.sharedPlayerNews.publishedAt} is not null`,
          lt(schema.sharedPlayerNews.publishedAt, cutoff),
        ),
        and(
          isNull(schema.sharedPlayerNews.publishedAt),
          lt(schema.sharedPlayerNews.createdAt, cutoff),
        ),
      ),
    )
    .returning({ id: schema.sharedPlayerNews.id });

  const unresolvedSamples = unresolved.slice(0, 10);
  if (unresolvedSamples.length > 0) {
    console.warn(
      "[ingest/player-news-x] unresolved samples",
      unresolved.length,
      unresolvedSamples,
    );
  }

  return json({
    ok: true,
    status: "committed",
    received: parsed.data.items.length,
    resolved: unique.length,
    inserted,
    duplicates: Math.max(0, unique.length - inserted),
    unresolved: unresolved.length,
    unresolvedSamples,
    purged: purged.length,
  });
}

// ---------------------------------------------------------------------------
// prop-line-snapshots
// ---------------------------------------------------------------------------

async function handlePropLineSnapshots(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_INGEST_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = propLineSnapshotPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid prop-line-snapshots payload.", parsed.error.issues);
  }

  let index: Awaited<ReturnType<typeof loadPlayerNameIndex>>;
  try {
    index = await loadPlayerNameIndex();
  } catch {
    return json({ ok: false, error: "Sleeper player data is temporarily unavailable." }, 502);
  }

  const { rows, unresolved, skippedDuplicates } = toPropLineSnapshotRows(
    parsed.data,
    index.byName,
  );

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const result = await db
      .insert(schema.propLineSnapshots)
      .values(chunk)
      .onConflictDoNothing()
      .returning({
        playerId: schema.propLineSnapshots.playerId,
        stat: schema.propLineSnapshots.stat,
      });
    inserted += result.length;
  }

  return json({
    ok: true,
    status: "committed",
    season: parsed.data.season,
    week: parsed.data.week,
    received: parsed.data.consensus.length,
    resolved: rows.length,
    inserted,
    duplicates: Math.max(0, rows.length - inserted) + skippedDuplicates,
    unresolved: unresolved.length,
    unresolvedSamples: unresolved.slice(0, 10),
  });
}

async function handleSleeperPicks(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_INGEST_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = sleeperPicksIngestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid sleeper-picks payload.", parsed.error.issues);
  }
  const payload = parsed.data;

  const lines = normalizeSleeperPicksBoard(payload.lines);
  const board: SleeperPicksBoard = { pulledAt: payload.pulled_at, lines };
  const cacheKey = sleeperPicksCacheKey(payload.season, payload.week);
  const fetchedAt = new Date(payload.pulled_at);
  const encoded = encodeSourceCachePayload(board);
  await db
    .insert(schema.sourceCache)
    .values({ cacheKey, payload: encoded, fetchedAt })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: encoded, fetchedAt },
    });

  return json({
    ok: true,
    status: "committed",
    season: payload.season,
    week: payload.week,
    received: payload.lines.length,
    stored: lines.length,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!hasCronSecret(req)) return forbidden("Invalid or missing webhook secret.");
  const url = new URL(req.url, "https://localhost");
  try {
    if (url.pathname.endsWith("/projections")) return await handleProjections(req);
    if (url.pathname.endsWith("/matchup-grades")) return await handleMatchupGrades(req);
    if (url.pathname.endsWith("/pfn-tables")) return await handlePfnTables(req);
    if (url.pathname.endsWith("/player-news-x")) return await handlePlayerNewsX(req);
    if (url.pathname.endsWith("/prop-line-snapshots")) return await handlePropLineSnapshots(req);
    if (url.pathname.endsWith("/sleeper-picks")) return await handleSleeperPicks(req);
    return json({ ok: false, error: "Unknown ingest target." }, 404);
  } catch (err) {
    await captureServerError(err, {
      route: "ingest",
      target: url.pathname.split("/").pop() ?? "unknown",
    });
    return internalError(err);
  }
}

export async function GET(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["POST"]);
}
