import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db";
import {
  badRequest,
  forbidden,
  hasCronSecret,
  internalError,
  json,
  methodNotAllowed,
} from "../../lib/api-utils";
import { CACHE_KEY } from "../../lib/dashboard-schemas";

/**
 * POST /api/ingest/projections
 *
 * Replaces `ingeststagedprojections`.
 *
 * The Hatch version read `staged_for_push.json` via a privileged file handler.
 * On Vercel the pipeline POSTs the staged JSON directly in the request body.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (shared with the props pipeline).
 *
 * Behavior (mirrors the original):
 * - Parses the payload with `vegasProjectionPayloadSchema`
 * - Skips when an existing snapshot has a newer `builtAt` ("ignored")
 * - Upserts `vegas_projection_snapshots` (id = `{season}:{week}`)
 * - Busts the dashboard cache (`fetchedAt = epoch` on CACHE_KEY) on commit
 */

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  if (!hasCronSecret(req)) return forbidden("Invalid or missing webhook secret.");

  try {
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
  } catch (err) {
    return internalError(err);
  }
}
