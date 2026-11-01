import { eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db.js";
import { CACHE_KEY, strengthOfScheduleEntrySchema } from "./dashboard-schemas.js";

export const DASHBOARD_USER_CACHE_PREFIX = "dashboard:user:";

/**
 * Expire the global dashboard snapshot and every per-user dashboard cache row
 * (`dashboard:user:*` full + section keys) in one UPDATE.
 */
export async function expireDashboardCaches(): Promise<void> {
  await db
    .update(schema.sourceCache)
    .set({ fetchedAt: new Date(0) })
    .where(
      or(
        eq(schema.sourceCache.cacheKey, CACHE_KEY),
        like(schema.sourceCache.cacheKey, `${DASHBOARD_USER_CACHE_PREFIX}%`),
      ),
    );
}

/** Predicate used by expireDashboardCaches — exported for unit tests. */
export function isDashboardCacheKey(cacheKey: string): boolean {
  return cacheKey === CACHE_KEY || cacheKey.startsWith(DASHBOARD_USER_CACHE_PREFIX);
}

export const vegasProjectionPayloadSchema = z.object({
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(25),
  built_at: z.string().datetime(),
  source: z.string().min(1).max(160),
  leagues: z
    .array(
      z.object({
        league_id: z.string().min(1).max(80),
        name: z.string().min(1).max(160),
      }),
    )
    .max(32),
  projections: z
    .array(
      z.object({
        player: z.string().min(1).max(160),
        team: z.string().min(1).max(12),
        position: z.string().min(1).max(12),
        opponent: z.string().max(12).nullable(),
        expected_stats: z.record(z.string(), z.number()),
        td_probability: z.union([z.number(), z.record(z.string(), z.number())]).nullable(),
        // Each stat's lowest and highest book line (pipeline 2026-11). Optional so older snapshots still parse.
        expected_stats_low: z.record(z.string(), z.number()).optional(),
        expected_stats_high: z.record(z.string(), z.number()).optional(),
        td_probability_low: z.union([z.number(), z.record(z.string(), z.number())]).nullable().optional(),
        td_probability_high: z.union([z.number(), z.record(z.string(), z.number())]).nullable().optional(),
        coverage: z.object({
          stats: z.union([z.number(), z.array(z.string()), z.record(z.string(), z.number())]),
          provider_count: z.number().int().nonnegative(),
          book_count: z.number().int().nonnegative(),
        }),
        leagues: z.record(z.string(), z.number()),
        components: z.record(z.string(), z.record(z.string(), z.number())),
      }),
    )
    .max(2500),
});

const strengthOfScheduleCellSchema = z.object({
  avg: z.number(),
  weeks: z.number().int(),
  rank: z.number().int(),
});

export const stagedMatchupGradesSchema = z.object({
  source: z.literal("matchup-grades"),
  season: z.number().int(),
  through_week: z.number().int(),
  built_at: z.string().datetime(),
  leagues: z.array(
    z.object({
      league_id: z.string(),
      league_name: z.string(),
      through_week: z.number().int(),
      completed_weeks: z.array(z.number().int()),
      computed_at: z.string().datetime(),
      table: z.record(
        z.string(),
        z.record(z.enum(["QB", "RB", "WR", "TE"]), strengthOfScheduleCellSchema),
      ),
    }),
  ),
});

const pfnTableKeys = ["offensive-line", "offense", "defense", "team-overall"] as const;
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

export const stagedPfnTablesSchema = z.object({
  source: z.literal("pfn-nfl-hq"),
  fetched_at: z.string().datetime(),
  tables: z.object({
    "offensive-line": pfnTableSchema,
    offense: pfnTableSchema,
    defense: pfnTableSchema,
    "team-overall": pfnTableSchema,
  }),
});

export { CACHE_KEY, strengthOfScheduleEntrySchema, pfnTableKeys };
