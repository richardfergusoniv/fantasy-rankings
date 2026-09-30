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
import { CACHE_KEY, strengthOfScheduleEntrySchema } from "../../lib/dashboard-schemas";

/**
 * POST /api/ingest/matchup-grades
 *
 * Replaces `ingeststagedmatchupgrades`.
 *
 * The Hatch version read `staged_matchup_grades.json` via a privileged file handler.
 * On Vercel the pipeline POSTs the staged JSON directly in the request body.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (shared with the props pipeline).
 *
 * Behavior (mirrors the original):
 * - Writes one `source_cache` row per league (`strength-of-schedule-v1:{league_id}`)
 * - Skips leagues where a newer or equal `computedAt` is already stored
 * - Busts the dashboard cache on commit
 */

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
  } catch (err) {
    return internalError(err);
  }
}
