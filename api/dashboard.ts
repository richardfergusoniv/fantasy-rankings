import {
  badRequest,
  internalError,
  json,
  queryBool,
} from "./_lib/api-utils.js";
import { readOwnerSleeperUserId, readOwnerUserId, resolveViewer } from "./_lib/auth.js";
import { captureServerError } from "./_lib/posthog.js";
import { dashboardForViewer, sectionDashboardForViewer, SIGN_IN_REQUIRED } from "./_lib/dashboard-access.js";
import {
  kickUserDashboardBuild,
  loadOrBuildUserDashboard,
  readGlobalDashboardSnapshot,
  readUserDashboardCache,
  readUserDashboardSection,
} from "./_lib/dashboard-build.js";
import {
  dashboardSnapshotIsLive,
  projectDashboardSection,
  type DashboardCacheSection,
} from "./_lib/dashboard-section-cache.js";
import {
  dashboardDeniedHeaders,
  dashboardViewResponseHeaders,
  loadCachedDashboardView,
  remainingDashboardTtlSeconds,
  type DashboardViewLoad,
} from "./_lib/dashboard-response-cache.js";
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
 *   for that owner. Every signed-out read, including force=false, is 401
 *   with `Cache-Control: private, no-store`.
 *
 *   Fresh responses are reused from the runtime cache for the snapshot
 *   version (`asOf`) until that version's TTL (10 min, or 150s while live).
 *   A new snapshot moves the version pointer; nothing is purged by hand.
 *   The HTTP cache stays private — Vercel will not CDN-cache an
 *   Authorization request, and a shared entry would leak across users.
 *
 * GET /api/dashboard/section?section=meta|team|players|league|analytics|trade|trade-waiver
 *   Same sign-in rule. A cold per-user cache returns `data: null` and
 *   rebuilds in the background; the client polls. It does not fill that
 *   gap with the owner snapshot unless the caller is the scheduled owner.
 *   Section reads prefer slim per-section `source_cache` rows and fall back
 *   to the legacy full dashboard row when those are missing.
 */

function dashboardJson<T>(loaded: DashboardViewLoad<T>): Response {
  if (!loaded.ok) {
    return json({ ok: false, error: loaded.error }, loaded.status, dashboardDeniedHeaders());
  }
  return json(loaded.body, 200, dashboardViewResponseHeaders({
    cache: loaded.cache,
    cacheable: loaded.cacheable,
    version: loaded.version,
    live: loaded.live,
  }));
}

async function handleDashboard(
  req: Request,
  viewer: { userId: string; sleeperUserId: string },
): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const force = queryBool(url, "force", false);
  const loaded = await loadCachedDashboardView({
    sleeperUserId: viewer.sleeperUserId,
    view: "full",
    requestedVersion: url.searchParams.get("v"),
    force,
    loadOrigin: async () => {
      const result = await dashboardForViewer({
        sleeperUserId: viewer.sleeperUserId,
        viewerUserId: viewer.userId,
        ownerSleeperUserId: readOwnerSleeperUserId(),
        ownerUserId: readOwnerUserId(),
        force,
        loadFreshOwn: async (id) => {
          const cached = await readUserDashboardCache(id);
          if (!cached?.fresh) return null;
          return {
            dashboard: cached.dashboard,
            live: cached.live,
            fetchedAtMs: cached.fetchedAtMs,
          };
        },
        loadOwnerSnapshot: async () => {
          const snapshot = await readGlobalDashboardSnapshot();
          if (!snapshot) return null;
          return {
            dashboard: snapshot,
            live: dashboardSnapshotIsLive(snapshot),
            fetchedAtMs: 0,
          };
        },
        buildOwn: async (id) => {
          const loaded = await loadOrBuildUserDashboard(id, force, viewer.userId);
          return {
            dashboard: loaded.dashboard,
            live: dashboardSnapshotIsLive(loaded.dashboard),
            // 0 when the build fell back to a stale row or the owner snapshot.
            fetchedAtMs: loaded.fetchedAtMs,
          };
        },
      });
      if (!result.ok) return { kind: "deny" };
      const payload = result.dashboard;
      // The owner snapshot is a fallback for that owner only. Don't pin it
      // in front of a per-user row that may appear on the next read.
      const ttlSeconds = result.source === "owner-snapshot"
        ? 0
        : remainingDashboardTtlSeconds({
            fetchedAtMs: payload.fetchedAtMs,
            live: payload.live,
            nowMs: Date.now(),
          });
      return {
        kind: "value",
        body: { dashboard: payload.dashboard },
        version: payload.dashboard.asOf,
        live: payload.live,
        ttlSeconds,
      };
    },
  });
  return dashboardJson(loaded);
}

const sectionParam = z.enum(["meta", "team", "players", "league", "analytics", "trade", "trade-waiver"]);

async function handleSection(
  req: Request,
  viewer: { userId: string; sleeperUserId: string },
): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const parsed = sectionParam.safeParse(url.searchParams.get("section"));
  if (!parsed.success) {
    return badRequest("Invalid or missing `section` query param.", parsed.error.issues);
  }
  const section = parsed.data as DashboardCacheSection;

  const loaded = await loadCachedDashboardView<{ section: DashboardCacheSection; data: unknown }>({
    sleeperUserId: viewer.sleeperUserId,
    view: section,
    requestedVersion: url.searchParams.get("v"),
    loadOrigin: async () => {
      const resolved = await sectionDashboardForViewer({
        sleeperUserId: viewer.sleeperUserId,
        viewerUserId: viewer.userId,
        ownerSleeperUserId: readOwnerSleeperUserId(),
        ownerUserId: readOwnerUserId(),
        loadOwn: async (id) => {
          try {
            const hit = await readUserDashboardSection(id, section);
            if (!hit || !hit.fresh) {
              waitUntil(kickUserDashboardBuild(id));
            }
            if (!hit) return null;
            return {
              data: hit.data,
              version: hit.version,
              live: hit.live,
              fetchedAtMs: hit.fetchedAtMs,
              fresh: hit.fresh,
            };
          } catch {
            return null;
          }
        },
        loadOwnerSnapshot: async () => {
          const snapshot = await readGlobalDashboardSnapshot();
          if (!snapshot) return null;
          return {
            data: projectDashboardSection(snapshot, section),
            version: snapshot.asOf,
            live: dashboardSnapshotIsLive(snapshot),
            fetchedAtMs: 0,
            fresh: false,
          };
        },
      });
      if (!resolved.ok) return { kind: "deny" };
      const payload = resolved.dashboard;
      if (!payload) {
        return {
          kind: "value",
          body: { section, data: null },
          version: "",
          live: false,
          ttlSeconds: 0,
        };
      }
      // Stale rows and the owner-snapshot fallback stay uncached so the next
      // read can see a rebuild or the viewer's own row.
      const ttlSeconds = resolved.source === "own" && payload.fresh
        ? remainingDashboardTtlSeconds({
            fetchedAtMs: payload.fetchedAtMs,
            live: payload.live,
            nowMs: Date.now(),
          })
        : 0;
      return {
        kind: "value",
        body: { section, data: payload.data },
        version: payload.version,
        live: payload.live,
        ttlSeconds,
      };
    },
  });
  return dashboardJson(loaded);
}

export async function GET(req: Request): Promise<Response> {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) return json({ ok: false, error: SIGN_IN_REQUIRED }, 401, dashboardDeniedHeaders());
    const url = new URL(req.url, "https://localhost");
    // /api/dashboard/section is rewritten to /api/dashboard?__section=1
    // (see vercel.json) so both paths share this one function.
    if (url.searchParams.has("__section")) {
      return await handleSection(req, viewer);
    }
    return await handleDashboard(req, viewer);
  } catch (err) {
    await captureServerError(err, { route: "dashboard" });
    return internalError(err);
  }
}

// Hobby plan caps maxDuration at 60s. vercel.json is the source of truth.
export const config = { maxDuration: 60 };
