import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import { badRequest, internalError, json } from "./_lib/api-utils.js";
import {
  readTeamSituationalSnapshot,
  type TeamSituationalSnapshot,
} from "./_lib/team-situational.js";
import { decodeSourceCachePayload } from "./_lib/source-cache-payload.js";
import { loadPropLineWeek, type PropLineWeekPayload } from "./_lib/prop-line-week.js";

/**
 * GET /api/pfn-tables
 *
 * Replaces `getpfntables`. Pure read of `pfn:*` keys from `source_cache`,
 * plus the cached team-situational snapshot.
 *
 * Also serves current-week prop lines from `prop_line_snapshots` (one compact
 * season/week query, in-process cached) so Monitor Props stays inside the
 * existing function budget — no new Vercel route file.
 *
 * Optional query: `season`, `week` (defaults to current NFL state).
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only schema
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

const propWeekQuerySchema = z.object({
  season: z.number().int().min(2020).max(2100).optional(),
  week: z.number().int().min(1).max(25).optional(),
});

export type PfnTables = {
  tables: Record<(typeof pfnTableKeys)[number], z.infer<typeof storedPfnTableSchema> | null>;
  teamSituational: TeamSituationalSnapshot | null;
  propLines: PropLineWeekPayload;
};

const PROP_LINES_HTTP_CACHE_SECONDS = 15 * 60;

async function loadPfnTables(): Promise<PfnTables["tables"]> {
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
      const envelope = storedPfnTableEnvelopeSchema.safeParse(decodeSourceCachePayload(row.payload));
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

  return tables;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    const seasonRaw = url.searchParams.get("season");
    const weekRaw = url.searchParams.get("week");
    const parsedQuery = propWeekQuerySchema.safeParse({
      season: seasonRaw == null || seasonRaw === "" ? undefined : Number(seasonRaw),
      week: weekRaw == null || weekRaw === "" ? undefined : Number(weekRaw),
    });
    if (!parsedQuery.success) {
      return badRequest("Invalid season/week query params.", parsedQuery.error.issues);
    }

    let propLinesDegraded = false;
    const [tables, teamSituational, propLines] = await Promise.all([
      loadPfnTables(),
      readTeamSituationalSnapshot(),
      loadPropLineWeek(parsedQuery.data).catch((err): PropLineWeekPayload => {
        propLinesDegraded = true;
        console.error("[pfn-tables] prop lines unavailable", err instanceof Error ? err.message : err);
        return {
          season: parsedQuery.data.season ?? 0,
          week: parsedQuery.data.week ?? 0,
          pulledAt: null,
          lines: [],
        };
      }),
    ]);

    return json(
      { tables, teamSituational, propLines },
      200,
      {
        "Cache-Control": propLinesDegraded
          ? "private, no-store"
          : `private, max-age=${PROP_LINES_HTTP_CACHE_SECONDS}`,
      },
    );
  } catch (err) {
    return internalError(err);
  }
}
