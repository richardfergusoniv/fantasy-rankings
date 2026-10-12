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
  readUserDashboardSection,
} from "./_lib/dashboard-build.js";
import {
  projectDashboardSection,
  type DashboardCacheSection,
} from "./_lib/dashboard-section-cache.js";
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
 * GET /api/dashboard/section?section=meta|team|players|league|analytics|trade|trade-waiver
 *   Same sign-in rule. A cold per-user cache returns `data: null` and
 *   rebuilds in the background; the client polls. It does not fill that
 *   gap with the owner snapshot unless the caller is the scheduled owner.
 *   Section reads prefer slim per-section `source_cache` rows and fall back
 *   to the legacy full dashboard row when those are missing.
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

const sectionParam = z.enum(["meta", "team", "players", "league", "analytics", "trade", "trade-waiver"]);

async function handleSection(req: Request, sleeperUserId: string): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const parsed = sectionParam.safeParse(url.searchParams.get("section"));
  if (!parsed.success) {
    return badRequest("Invalid or missing `section` query param.", parsed.error.issues);
  }
  const section = parsed.data as DashboardCacheSection;

  const resolved = await sectionDashboardForViewer({
    sleeperUserId,
    ownerSleeperUserId: readOwnerSleeperUserId(),
    loadOwn: async (id) => {
      try {
        const hit = await readUserDashboardSection(id, section);
        if (!hit || !hit.fresh) {
          waitUntil(kickUserDashboardBuild(id));
        }
        return hit?.data ?? null;
      } catch {
        return null;
      }
    },
    loadOwnerSnapshot: async () => {
      const snapshot = await readGlobalDashboardSnapshot();
      if (!snapshot) return null;
      return projectDashboardSection(snapshot, section);
    },
  });
  if (!resolved.ok) return unauthorized(resolved.error);
  const data = resolved.dashboard;

  if (section === "meta") {
    return json({ section: "meta", data });
  }
  if (section === "team") {
    return json({ section: "team", data });
  }
  if (section === "players") {
    return json({ section: "players", data });
  }
  if (section === "league") {
    return json({ section: "league", data });
  }
  if (section === "analytics") {
    return json({ section: "analytics", data });
  }
  if (section === "trade") {
    return json({ section: "trade", data });
  }
  return json({ section: "trade-waiver", data });
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
