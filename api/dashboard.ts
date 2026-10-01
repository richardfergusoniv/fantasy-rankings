import { desc, eq, like } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  badRequest,
  internalError,
  json,
  queryBool,
} from "./_lib/api-utils.js";
import {
  CACHE_KEY,
  parseUsableDashboard,
  type Dashboard,
} from "./_lib/dashboard-schemas.js";
import { z } from "zod";

/**
 * /api/dashboard  and  /api/dashboard/section
 *
 * Combined route replacing the former dashboard.ts + dashboard/section.ts
 * pair to stay within Vercel's function limit. The /section path arrives
 * via a vercel.json rewrite (?__section=1).
 *
 * GET /api/dashboard
 *   Returns the last saved dashboard snapshot, or a `partial` shell when
 *   none exists. `force=true` is not yet supported (Phase 3 cron rebuild).
 *
 * GET /api/dashboard/section?section=meta|team|players|league|analytics
 *   Returns a small projection of the last complete snapshot for one view,
 *   so a slow refresh never blocks a section read.
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

async function handleDashboard(req: Request): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
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
}

const sectionParam = z.enum(["meta", "team", "players", "league", "analytics"]);

async function handleSection(req: Request): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const parsed = sectionParam.safeParse(url.searchParams.get("section"));
  if (!parsed.success) {
    return badRequest("Invalid or missing `section` query param.", parsed.error.issues);
  }
  const section = parsed.data;

  const cached = await getCached();

  if (section === "meta") {
    return json({
      section: "meta",
      data: cached
        ? {
            status: cached.status,
            season: cached.season,
            week: cached.week,
            asOf: cached.asOf,
            rankingsAsOf: cached.rankingsAsOf,
            fantasyCalcAsOf: cached.fantasyCalcAsOf,
            sourceErrors: cached.sourceErrors,
            leagues: cached.leagues.map(
              ({
                id,
                name,
                scoringLabel,
                rankingField,
                rosteredPlayerIds,
                rosterAssignments,
                rankingPositions,
                showSuperFilter,
                seasonLongFormat,
                tradeValuation,
              }) => ({
                id,
                name,
                scoringLabel,
                rankingField,
                rosteredPlayerIds,
                rosterAssignments,
                rankingPositions,
                showSuperFilter,
                seasonLongFormat,
                tradeValuation,
              }),
            ),
          }
        : null,
    });
  }

  if (section === "team") {
    return json({
      section: "team",
      data: cached
        ? {
            leagues: cached.leagues.map(
              ({
                id,
                record,
                teamActual,
                teamProjection,
                starters,
                bench,
                opponentTeam,
                suggestion,
                tradeTeams,
                tradeWaiverPool,
                tradeStarterSlots,
              }) => ({
                id,
                record,
                teamActual,
                teamProjection,
                starters,
                bench,
                opponentTeam,
                suggestion,
                tradeTeams,
                tradeWaiverPool,
                tradeStarterSlots,
              }),
            ),
          }
        : null,
    });
  }

  if (section === "players") {
    return json({
      section: "players",
      data: cached
        ? {
            rankings: cached.rankings,
            weeklyChartRankings: cached.weeklyChartRankings,
            seasonLongRankings: cached.seasonLongRankings,
            defenses: cached.defenses,
            strengthOfSchedule: cached.strengthOfSchedule ?? [],
          }
        : null,
    });
  }

  if (section === "league") {
    return json({
      section: "league",
      data: cached
        ? {
            leagues: cached.leagues.map(
              ({ id, powerRankingsWeek, powerRankingsSeasonLong, powerRankingsDynasty }) => ({
                id,
                powerRankingsWeek,
                powerRankingsSeasonLong,
                powerRankingsDynasty,
              }),
            ),
          }
        : null,
    });
  }

  return json({
    section: "analytics",
    data: cached ? { analytics: cached.analytics } : null,
  });
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    // /api/dashboard/section is rewritten to /api/dashboard?__section=1
    // (see vercel.json) so both paths share this one function.
    if (url.searchParams.has("__section")) {
      return await handleSection(req);
    }
    return await handleDashboard(req);
  } catch (err) {
    return internalError(err);
  }
}

// Vercel function config: allow up to 120s for future force-refresh support.
export const config = { maxDuration: 120 };
