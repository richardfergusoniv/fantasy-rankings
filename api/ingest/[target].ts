import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../_lib/db.js";
import {
  badRequest,
  forbidden,
  hasCronSecret,
  internalError,
  json,
  methodNotAllowed,
} from "../_lib/api-utils.js";
import { CACHE_KEY, strengthOfScheduleEntrySchema } from "../_lib/dashboard-schemas.js";

/**
 * POST /api/ingest/:target  (target = projections | matchup-grades | pfn-tables)
 *
 * Single function replacing the three deferred ingest routes to stay within
 * Vercel's function budget. The pipeline POSTs staged JSON directly in the
 * request body; auth is `Authorization: Bearer <CRON_SECRET>` (shared with
 * the props pipeline). URLs are unchanged from the deferred design, so the
 * pipeline contract is untouched.
 *
 * - projections:    upserts `vegas_projection_snapshots` (`{season}:{week}`),
 *                   skips when an existing snapshot has a newer `builtAt`,
 *                   busts the dashboard cache on commit.
 * - matchup-grades: writes `strength-of-schedule-v1:{league_id}` rows to
 *                   `source_cache`, skips leagues with a newer stored
 *                   `computedAt`, busts the dashboard cache on commit.
 * - pfn-tables:     writes `pfn:{tableKey}` rows to `source_cache` for the
 *                   4 PFN tables.
 */

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

const vegasProjectionLeagueSchema = z.object({
  league_id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
});

const vegasPlayerProjectionSchema = z.object({
  player: z.string().min(1).max(160),
  team: z.string().min(1).max(12),
  position: z.string().min(1).max(12),
  opponent: z.string().max(12).nullable(),
  expected_stats: z.record(z.string(), z.number()),
  td_probability: z.union([z.number(), z.record(z.string(), z.number())]).nullable(),
  coverage: z.object({
    stats: z.union([z.number(), z.array(z.string()), z.record(z.string(), z.number())]),
    provider_count: z.number().int().nonnegative(),
    book_count: z.number().int().nonnegative(),
  }),
  leagues: z.record(z.string(), z.number()),
  components: z.record(z.string(), z.record(z.string(), z.number())),
});

const vegasProjectionPayloadSchema = z.object({
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(25),
  built_at: z.string().datetime(),
  source: z.string().min(1).max(160),
  leagues: z.array(vegasProjectionLeagueSchema).max(32),
  projections: z.array(vegasPlayerProjectionSchema).max(2500),
});

async function handleProjections(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = vegasProjectionPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid projections payload.", parsed.error.issues);
  }
  const payload = parsed.data;

  const snapshotId = `${payload.season}:${payload.week}`;
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
    // Bust the dashboard cache so the next read rebuilds from fresh data.
    await db
      .update(schema.sourceCache)
      .set({ fetchedAt: new Date(0) })
      .where(eq(schema.sourceCache.cacheKey, CACHE_KEY));
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

const strengthOfScheduleCellSchema = z.object({
  avg: z.number(),
  weeks: z.number().int(),
  rank: z.number().int(),
});

const stagedMatchupGradesSchema = z.object({
  source: z.literal("matchup-grades"),
  season: z.number().int(),
  through_week: z.number().int(),
  built_at: z.string(),
  leagues: z.array(
    z.object({
      league_id: z.string(),
      league_name: z.string(),
      through_week: z.number().int(),
      completed_weeks: z.array(z.number().int()),
      computed_at: z.string(),
      table: z.record(z.string(), z.record(z.enum(["QB", "RB", "WR", "TE"]), strengthOfScheduleCellSchema)),
    }),
  ),
});

async function handleMatchupGrades(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
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
        const prev = JSON.parse(existing.payload) as { computedAt?: string };
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
    await db
      .insert(schema.sourceCache)
      .values({ cacheKey, payload: JSON.stringify(entry), fetchedAt })
      .onConflictDoUpdate({
        target: schema.sourceCache.cacheKey,
        set: { payload: JSON.stringify(entry), fetchedAt },
      });
    committed += 1;
  }

  const status = committed > 0 ? ("committed" as const) : ("ignored" as const);
  if (status === "committed") {
    await db
      .update(schema.sourceCache)
      .set({ fetchedAt: new Date(0) })
      .where(eq(schema.sourceCache.cacheKey, CACHE_KEY));
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

const pfnTableKeys = ["offensive-line", "offense", "defense", "team-overall"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only schema
const pfnTableKeySchema = z.enum(pfnTableKeys);

const pfnMetricValueSchema = z.union([z.number(), z.string(), z.null()]);
const pfnRowSchema = z
  .object({
    rank: z.number().int(),
    team: z.string(),
    team_name: z.string(),
  })
  .catchall(pfnMetricValueSchema);

const pfnTableSchema = z.object({
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(pfnRowSchema),
});

const stagedPfnTablesSchema = z.object({
  source: z.literal("pfn-nfl-hq"),
  fetched_at: z.string(),
  tables: z.object({
    "offensive-line": pfnTableSchema,
    offense: pfnTableSchema,
    defense: pfnTableSchema,
    "team-overall": pfnTableSchema,
  }),
});

async function handlePfnTables(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = stagedPfnTablesSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid PFN tables payload.", parsed.error.issues);
  }
  const payload = parsed.data;

  const fetchedAt = new Date(payload.fetched_at);
  for (const tableKey of pfnTableKeys) {
    const table = payload.tables[tableKey];
    const stored = {
      fetched_at: payload.fetched_at,
      label: table.label,
      columns: table.columns,
      column_labels: table.column_labels,
      rows: table.rows,
    };
    const cacheKey = `pfn:${tableKey}`;
    await db.insert(schema.sourceCache).values({
      cacheKey,
      payload: JSON.stringify(stored),
      fetchedAt,
    }).onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: JSON.stringify(stored), fetchedAt },
    });
  }

  return json({
    ok: true,
    status: "committed",
    fetched_at: payload.fetched_at,
    tables: [...pfnTableKeys] as Array<z.infer<typeof pfnTableKeySchema>>,
  });
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  if (!hasCronSecret(req)) return forbidden("Invalid or missing webhook secret.");
  const url = new URL(req.url, "https://localhost");
  try {
    if (url.pathname.endsWith("/projections")) return await handleProjections(req);
    if (url.pathname.endsWith("/matchup-grades")) return await handleMatchupGrades(req);
    if (url.pathname.endsWith("/pfn-tables")) return await handlePfnTables(req);
    return json({ ok: false, error: "Unknown ingest target." }, 404);
  } catch (err) {
    return internalError(err);
  }
}

export async function GET(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["POST"]);
}
