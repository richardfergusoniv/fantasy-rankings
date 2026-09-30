import { z } from "zod";
import { db, schema } from "../../lib/db";
import {
  badRequest,
  forbidden,
  hasCronSecret,
  internalError,
  json,
  methodNotAllowed,
} from "../../lib/api-utils";

/**
 * POST /api/ingest/pfn-tables
 *
 * Replaces `ingeststagedpfntables`.
 *
 * The Hatch version read `staged_pfn_tables.json` via a privileged file handler.
 * On Vercel the pipeline POSTs the staged JSON directly in the request body.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (shared with the props pipeline).
 *
 * Behavior (mirrors the original):
 * - Writes `pfn:{tableKey}` rows to `source_cache` for each of the 4 tables
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
  } catch (err) {
    return internalError(err);
  }
}
