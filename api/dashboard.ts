import {
  badRequest,
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
  userDashboardBuildStatus,
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
  type DashboardOriginResult,
  type DashboardViewLoad,
} from "./_lib/dashboard-response-cache.js";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { flushCacheMetrics } from "./_lib/cache-metrics.js";

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
 *   Fresh responses are served from a bounded instance-local L1 over the
 *   canonical per-user `source_cache` snapshot rows (600s normal, 150s while
 *   live). Personalized data never enters Runtime Cache — a new snapshot is
 *   just a new Postgres row version; nothing is purged by hand.
 *   The HTTP cache stays private — Vercel will not CDN-cache an
 *   Authorization request, and a shared entry would leak across users.
 *
 * GET /api/dashboard/section?section=meta|team|players|league|analytics|trade|trade-waiver
 *   Same sign-in rule. A cold per-user cache returns `data: null` and
 *   rebuilds in the background; the client polls. It does not fill that
 *   gap with the owner snapshot unless the caller is the scheduled owner.
 *   Section reads prefer slim per-section `source_cache` rows and fall back
 *   to the legacy full dashboard row when those are missing.
 *
 * GET /api/dashboard/section?sections=meta,team,players,league
 *   Same as the single-section read but returns all requested sections in
 *   one `{sections, snapshotVersion}` response — the client bootstrap call.
 *   `snapshotVersion` is the shared `asOf` when every section came from the
 *   same snapshot, else null. A 401 on any section fails the batch.
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
            resyncFailed: false,
          };
        },
        loadOwnerSnapshot: async () => {
          const snapshot = await readGlobalDashboardSnapshot();
          if (!snapshot) return null;
          return {
            dashboard: snapshot,
            live: dashboardSnapshotIsLive(snapshot),
            fetchedAtMs: 0,
            resyncFailed: false,
          };
        },
        buildOwn: async (id) => {
          const loaded = await loadOrBuildUserDashboard(id, force, viewer.userId);
          return {
            dashboard: loaded.dashboard,
            live: dashboardSnapshotIsLive(loaded.dashboard),
            // 0 when the build fell back to a stale row or the owner snapshot.
            fetchedAtMs: loaded.fetchedAtMs,
            resyncFailed: loaded.fellBack,
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
        // A forced load whose build fell back says so in the body: the
        // response is a 200 with the stale dashboard, and without this flag
        // the client cannot tell a failed resync from a successful one.
        // ttlSeconds is 0 for fallbacks, so this body is never view-cached.
        body: { dashboard: payload.dashboard, ...(payload.resyncFailed ? { resync: "failed" } : {}) },
        version: payload.dashboard.asOf,
        live: payload.live,
        ttlSeconds,
      };
    },
  });
  return dashboardJson(loaded);
}

const sectionParam = z.enum(["meta", "team", "players", "league", "analytics", "trade", "trade-waiver"]);

/** Origin loader for one section — shared by the single and batched reads. */
function makeSectionLoadOrigin(
  viewer: { userId: string; sleeperUserId: string },
  section: DashboardCacheSection,
  retryBuild: boolean,
) {
  return async (): Promise<DashboardOriginResult<{
    section: DashboardCacheSection;
    data: unknown;
    build?: unknown;
  }>> => {
      const resolved = await sectionDashboardForViewer({
        sleeperUserId: viewer.sleeperUserId,
        viewerUserId: viewer.userId,
        ownerSleeperUserId: readOwnerSleeperUserId(),
        ownerUserId: readOwnerUserId(),
        loadOwn: async (id) => {
          // A read failure propagates to a 500 — returning null would make a
          // transport failure look like "no data yet".
          const hit = await readUserDashboardSection(id, section);
          if (!hit || !hit.fresh) {
            waitUntil(kickUserDashboardBuild(id, { retryFailed: retryBuild }));
          }
          if (!hit) return null;
          return {
            data: hit.data,
            version: hit.version,
            live: hit.live,
            fetchedAtMs: hit.fetchedAtMs,
            fresh: hit.fresh,
          };
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
        // Attach the background build's status so the client can tell
        // "still building" from "build failed".
        const build = userDashboardBuildStatus(viewer.sleeperUserId);
        return {
          kind: "value",
          body: { section, data: null, ...(build ? { build } : {}) },
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
  };
}

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
  // Set by the client's Retry on a failed build; plain polls never restart one.
  const retryBuild = queryBool(url, "retryBuild", false);

  const loaded = await loadCachedDashboardView<{ section: DashboardCacheSection; data: unknown }>({
    sleeperUserId: viewer.sleeperUserId,
    view: section,
    requestedVersion: url.searchParams.get("v"),
    // A Retry must reach its own origin load (which restarts the build), not
    // join a plain poll's or be answered from L1.
    force: retryBuild,
    loadOrigin: makeSectionLoadOrigin(viewer, section, retryBuild),
  });
  return dashboardJson(loaded);
}

/**
 * `?sections=meta,team,players` — one call returning every requested
 * section body, so the client's bootstrap is a single request instead of a
 * per-section fan-out. Each section goes through the same
 * `loadCachedDashboardView` path as the single-section route (L1 +
 * Postgres + lease join), in parallel. `snapshotVersion` is the common
 * `asOf` when all returned sections agree on one snapshot.
 */
async function handleSections(
  req: Request,
  viewer: { userId: string; sleeperUserId: string },
): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const parsed = z.array(sectionParam).min(1).max(10).safeParse(
    (url.searchParams.get("sections") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (!parsed.success) {
    return badRequest("Invalid or missing `sections` query param.", parsed.error.issues);
  }
  const retryBuild = queryBool(url, "retryBuild", false);
  const requestedVersion = url.searchParams.get("v");
  const unique = [...new Set(parsed.data)] as DashboardCacheSection[];

  const loaded = await Promise.all(unique.map(async (section) => ({
    section,
    result: await loadCachedDashboardView<{
      section: DashboardCacheSection;
      data: unknown;
      build?: unknown;
    }>({
      sleeperUserId: viewer.sleeperUserId,
      view: section,
      requestedVersion,
      force: retryBuild,
      loadOrigin: makeSectionLoadOrigin(viewer, section, retryBuild),
    }),
  })));

  // A 401 on any section means the caller's access changed mid-request.
  const denied = loaded.find(({ result }) => !result.ok);
  if (denied) {
    return json(
      { ok: false, error: SIGN_IN_REQUIRED },
      401,
      dashboardDeniedHeaders(),
    );
  }

  const sections: Record<string, unknown> = {};
  const versions = new Set<string>();
  for (const { section, result } of loaded) {
    if (!result.ok) continue; // narrowed by `denied` above
    sections[section] = result.body;
    if (result.version) versions.add(result.version);
  }
  // Mixed-version or uncacheable responses stay private,no-store: there is
  // no single ETag that could describe the batch.
  return json(
    { sections, snapshotVersion: versions.size === 1 ? [...versions][0] : null },
    200,
    dashboardViewResponseHeaders({
      cache: loaded.every(({ result }) => result.ok && result.cache === "HIT") ? "HIT" : "MISS",
      cacheable: false,
      version: null,
      live: false,
    }),
  );
}

export async function GET(req: Request): Promise<Response> {
  // Correlation id for this request: honored when the client sends one so a
  // user-reported failure can be matched to server telemetry, generated
  // otherwise and returned on the error body.
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) return json({ ok: false, error: SIGN_IN_REQUIRED }, 401, dashboardDeniedHeaders());
    const url = new URL(req.url, "https://localhost");
    // /api/dashboard/section is rewritten to /api/dashboard?__section=1
    // (see vercel.json) so both paths share this one function.
    const response = url.searchParams.has("__section")
      ? url.searchParams.has("sections")
        ? await handleSections(req, viewer)
        : await handleSection(req, viewer)
      : await handleDashboard(req, viewer);
    flushCacheMetrics();
    return response;
  } catch (err) {
    await captureServerError(err, { route: "dashboard", requestId });
    console.error("[dashboard] request failed", { requestId, error: err });
    return json({ ok: false, error: "Internal server error", requestId }, 500);
  }
}

// Hobby plan caps maxDuration at 60s. vercel.json is the source of truth.
export const config = { maxDuration: 60 };
