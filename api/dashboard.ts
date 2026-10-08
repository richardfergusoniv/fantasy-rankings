import {
  badRequest,
  internalError,
  json,
  queryBool,
  unauthorized,
} from "./_lib/api-utils.js";
import { readOwnerSleeperUserId, resolveSleeperUserId } from "./_lib/auth.js";
import { dashboardForViewer, sectionDashboardForViewer, SIGN_IN_REQUIRED } from "./_lib/dashboard-access.js";
import {
  kickUserDashboardBuild,
  loadOrBuildUserDashboard,
  readGlobalDashboardSnapshot,
  readUserDashboardCache,
} from "./_lib/dashboard-build.js";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

/**
 * /api/dashboard  and  /api/dashboard/section
 *
 * Combined route replacing the former dashboard.ts + dashboard/section.ts
 * pair to stay within Vercel's function limit. The /section path arrives
 * via a vercel.json rewrite (?__section=1).
 *
 * GET /api/dashboard
 *   Requires a signed-in user with a connected Sleeper account. They get
 *   their own dashboard (per-user cache, built on miss; `force=true`
 *   rebuilds). The scheduled owner's stored snapshot is a fallback only
 *   for that owner. Every signed-out read, including force=false, is 401.
 *
 * GET /api/dashboard/section?section=meta|team|players|league|analytics
 *   Same sign-in rule. A cold per-user cache returns `data: null` and
 *   rebuilds in the background; the client polls. It does not fill that
 *   gap with the owner snapshot unless the caller is the scheduled owner.
 */

async function handleDashboard(req: Request, sleeperUserId: string): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const force = queryBool(url, "force", false);
  const result = await dashboardForViewer({
    sleeperUserId,
    ownerSleeperUserId: readOwnerSleeperUserId(),
    force,
    loadFreshOwn: async (id) => {
      const cached = await readUserDashboardCache(id);
      return cached?.fresh ? cached.dashboard : null;
    },
    loadOwnerSnapshot: () => readGlobalDashboardSnapshot(),
    buildOwn: (id) => loadOrBuildUserDashboard(id, force),
  });
  if (!result.ok) return unauthorized(result.error);
  return json({ dashboard: result.dashboard });
}

/**
 * Section reads never block on a build. A cold or stale per-user cache
 * starts a background build and returns whatever is already stored.
 */
async function sectionDashboard(sleeperUserId: string) {
  return sectionDashboardForViewer({
    sleeperUserId,
    ownerSleeperUserId: readOwnerSleeperUserId(),
    loadOwn: async (id) => {
      try {
        const cached = await readUserDashboardCache(id);
        if (!cached || !cached.fresh) {
          waitUntil(kickUserDashboardBuild(id));
        }
        return cached?.dashboard ?? null;
      } catch {
        return null;
      }
    },
    loadOwnerSnapshot: () => readGlobalDashboardSnapshot(),
  });
}

const sectionParam = z.enum(["meta", "team", "players", "league", "analytics"]);

async function handleSection(req: Request, sleeperUserId: string): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const parsed = sectionParam.safeParse(url.searchParams.get("section"));
  if (!parsed.success) {
    return badRequest("Invalid or missing `section` query param.", parsed.error.issues);
  }
  const section = parsed.data;

  const resolved = await sectionDashboard(sleeperUserId);
  if (!resolved.ok) return unauthorized(resolved.error);
  const cached = resolved.dashboard;

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
    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized(SIGN_IN_REQUIRED);
    const url = new URL(req.url, "https://localhost");
    // /api/dashboard/section is rewritten to /api/dashboard?__section=1
    // (see vercel.json) so both paths share this one function.
    if (url.searchParams.has("__section")) {
      return await handleSection(req, sleeperUserId);
    }
    return await handleDashboard(req, sleeperUserId);
  } catch (err) {
    return internalError(err);
  }
}

// Hobby plan caps maxDuration at 60s. vercel.json is the source of truth.
export const config = { maxDuration: 60 };
