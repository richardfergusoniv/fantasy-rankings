import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { internalError, json, methodNotAllowed } from "../lib/api-utils";

/**
 * GET /api/pfn-tables
 *
 * Replaces `getpfntables`. Pure read of `pfn:*` keys from `source_cache`,
 * plus the cached team-situational snapshot.
 */

const pfnTableKeys = ["offensive-line", "offense", "defense", "team-overall"] as const;
const pfnTableKeySchema = z.enum(pfnTableKeys);

const pfnMetricValueSchema = z.union([z.number(), z.string(), z.null()]);
const pfnRowSchema = z
  .object({
    rank: z.number().int(),
    team: z.string(),
    team_name: z.string(),
  })
  .catchall(pfnMetricValueSchema);

const storedPfnTableSchema = z.object({
  fetched_at: z.string(),
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(pfnRowSchema),
});

const storedPfnTableEnvelopeSchema = z.object({
  fetched_at: z.string(),
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(z.unknown()),
});

const teamSituationalStatSchema = z.object({
  team: z.string(),
  games: z.number().int(),
  thirdDownPct: z.number(),
  redZoneTdPct: z.number(),
});

const TEAM_SITUATIONAL_STATS_URL =
  "https://hindi3.sportskeeda.com/nfl/team-stat/third-down-percentage-leaders?season=2026&type=regular";

const teamSituationalSnapshotSchema = z.object({
  fetchedAt: z.string(),
  sourceUrl: z.literal(TEAM_SITUATIONAL_STATS_URL),
  rows: z.array(teamSituationalStatSchema),
});

const TEAM_SITUATIONAL_CACHE_KEY = "team-situational-stats-2026";

async function loadTeamSituationalSnapshot(): Promise<z.infer<typeof teamSituationalSnapshotSchema> | null> {
  const [cached] = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, TEAM_SITUATIONAL_CACHE_KEY))
    .limit(1);
  if (!cached) return null;
  try {
    const parsed = teamSituationalSnapshotSchema.safeParse(JSON.parse(cached.payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  try {
    const keys = pfnTableKeys.map((tableKey) => `pfn:${tableKey}`);
    const rows = await db
      .select()
      .from(schema.sourceCache)
      .where(inArray(schema.sourceCache.cacheKey, keys));

    const tables: Record<(typeof pfnTableKeys)[number], z.infer<typeof storedPfnTableSchema> | null> = {
      "offensive-line": null,
      offense: null,
      defense: null,
      "team-overall": null,
    };

    for (const row of rows) {
      const tableKey = row.cacheKey.slice(4);
      const parsedKey = pfnTableKeySchema.safeParse(tableKey);
      if (!parsedKey.success) continue;
      try {
        const envelope = storedPfnTableEnvelopeSchema.safeParse(JSON.parse(row.payload));
        if (!envelope.success) continue;
        const validRows = envelope.data.rows
          .flatMap((candidate) => {
            const parsedRow = pfnRowSchema.safeParse(candidate);
            return parsedRow.success ? [parsedRow.data] : [];
          })
          .sort((a, b) => a.rank - b.rank);
        tables[parsedKey.data] = {
          fetched_at: envelope.data.fetched_at,
          label: envelope.data.label,
          columns: envelope.data.columns,
          column_labels: envelope.data.column_labels,
          rows: validRows,
        };
      } catch {
        // Skip malformed cached tables.
      }
    }

    return json({
      tables,
      teamSituational: await loadTeamSituationalSnapshot(),
    });
  } catch (err) {
    return internalError(err);
  }
}
