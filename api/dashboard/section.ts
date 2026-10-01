import { desc, eq, like } from "drizzle-orm";
import { db, schema } from "../_lib/db.js";
import {
  badRequest,
  internalError,
  json,
  methodNotAllowed,
} from "../_lib/api-utils.js";
import {
  CACHE_KEY,
  parseUsableDashboard,
  type Dashboard,
} from "../_lib/dashboard-schemas.js";
import { z } from "zod";

/**
 * GET /api/dashboard/section?section=meta|team|players|league|analytics
 *
 * Replaces `getDashboardSection`.
 *
 * Each view reads a deliberately small projection of the last complete
 * snapshot. Calls are independent, so a slow live refresh never blocks the
 * saved Team, Players, League, or analytics section.
 */

const sectionParam = z.enum(["meta", "team", "players", "league", "analytics"]);

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  try {
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
  } catch (err) {
    return internalError(err);
  }
}
