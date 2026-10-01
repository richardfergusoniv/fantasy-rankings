import { desc, eq, like } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  badRequest,
  internalError,
  json,
  methodNotAllowed,
  queryBool,
} from "./_lib/api-utils.js";
import {
  CACHE_KEY,
  parseUsableDashboard,
  type Dashboard,
} from "./_lib/dashboard-schemas.js";

/**
 * GET /api/dashboard
 *
 * Replaces `getDashboard` (non-force path) + `getCachedDashboard`.
 *
 * Query params:
 *   force=true — admin-only trigger for a live rebuild. In Phase 2 this
 *   returns 501; the rebuild moves to POST /api/cron/refresh-dashboard in Phase 3.
 *
 * Returns the last saved dashboard snapshot, or a `partial` shell when none exists.
 */

async function getCached(): Promise<Dashboard | null> {
  const currentRows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, CACHE_KEY))
    .limit(1);
  const current = currentRows[0];
  if (current) {
    const dashboard = parseUsableDashboard(current.payload);
    if (dashboard) return dashboard;
  }

  // Legacy cache-key compatibility (only when canonical snapshot is absent).
  const legacyRows = await db
    .select()
    .from(schema.sourceCache)
    .where(like(schema.sourceCache.cacheKey, "dashboard-live-projections-v%"))
    .orderBy(desc(schema.sourceCache.fetchedAt))
    .limit(6);
  for (const row of legacyRows) {
    if (row.cacheKey === CACHE_KEY) continue;
    const dashboard = parseUsableDashboard(row.payload);
    if (dashboard) return dashboard;
  }
  return null;
}

function partialShell(): Dashboard {
  return {
    status: "partial",
    season: new Date().getUTCFullYear(),
    week: 0,
    asOf: new Date().toISOString(),
    rankingsAsOf: null,
    fantasyCalcAsOf: null,
    leagues: [],
    rankings: [],
    weeklyChartRankings: [],
    seasonLongRankings: [],
    defenses: [],
    analytics: {
      asOf: null,
      throughWeek: null,
      sourceUrl: "",
      entities: [],
      teamUsage: [],
      teamRecords: [],
    },
    strengthOfSchedule: [],
    sourceErrors: ["No saved dashboard snapshot is available yet."],
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  try {
    const url = new URL(req.url);
    const force = queryBool(url, "force", false);

    if (force) {
      // Phase 2: the live rebuild is not yet migrated. It becomes
      // POST /api/cron/refresh-dashboard (Vercel Cron) in Phase 3.
      return badRequest(
        "force=true is not supported yet. The live dashboard rebuild moves to the cron endpoint in Phase 3.",
      );
    }

    const dashboard = await getCached();
    return json({ dashboard: dashboard ?? partialShell() });
  } catch (err) {
    return internalError(err);
  }
}

// Vercel function config: allow up to 120s for future force-refresh support.
export const config = { maxDuration: 120 };
