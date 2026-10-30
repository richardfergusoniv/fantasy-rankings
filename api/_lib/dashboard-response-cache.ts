import { SIGN_IN_REQUIRED } from "./dashboard-access.js";
import { countCacheMetric, sampleCacheBytes } from "./cache-metrics.js";
import type { DashboardCacheSection } from "./dashboard-section-cache.js";

/**
 * Response cache for dashboard views — per-user, instance-local only (L1).
 *
 * Personalized dashboard bodies used to be mirrored into Vercel Runtime
 * Cache behind a pointer/lane layer. Runtime Cache is byte-metered at
 * 8 KB/write-unit and roughly 1.5 GB/month of personalized writes exhausted
 * the Hobby allowance, so that layer is gone: Postgres `source_cache` rows
 * are the canonical snapshot store and every cross-instance read loads
 * from Postgres. What remains is a bounded, byte-capped LRU inside this
 * isolate that absorbs repeat reads on a warm instance — plus a
 * scope-level single-flight so concurrent requests on one instance share
 * a single Postgres load.
 *
 * `DASHBOARD_L1_BYPASS=1` turns the L1 into a pass-through (no reads or
 * writes) without restoring any shared-cache lane protocol. There is no
 * code path back to Runtime Cache for personalized views.
 *
 * Successful dashboard bodies are per-user. Vercel's CDN will not store a
 * response whose request carries `Authorization` (the dashboard client
 * always sends the Supabase JWT), and a shared CDN entry is keyed only by
 * URL — so `s-maxage` would hand one viewer's roster to the next caller,
 * including a signed-out visitor once the function is skipped. These
 * responses stay `private` / CDN `no-store`.
 */

/** Same duration as `USER_DASHBOARD_CACHE_MS` in dashboard-build. */
export const DASHBOARD_VIEW_FRESH_TTL_SECONDS = 10 * 60;
/** Same duration as `LIVE_DASHBOARD_CACHE_MS`. Do not cache live views longer. */
export const DASHBOARD_VIEW_LIVE_TTL_SECONDS = 150;

/**
 * L1 byte budget per isolate. A dashboard view body is typically
 * 100–500 KB; 8 MiB bounds a handful of users' views without risking
 * the function's memory headroom.
 */
export const DASHBOARD_L1_DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const VERSION_MAX_LENGTH = 64;

export type DashboardResponseView = DashboardCacheSection | "full";

export type DashboardViewCacheEntry = {
  version: string;
  live: boolean;
  expiresAtMs: number;
  body: unknown;
};

export type DashboardViewStore = {
  get(key: string): Promise<unknown | null>;
  /**
   * Store `value` until `ttlSeconds` from now. Returns false when the store
   * is bypassed or the value could not be admitted; the read path must not
   * depend on `set` succeeding.
   */
  set(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
};

export function dashboardResponseTtlSeconds(live: boolean): number {
  return live ? DASHBOARD_VIEW_LIVE_TTL_SECONDS : DASHBOARD_VIEW_FRESH_TTL_SECONDS;
}

/**
 * Seconds the response may be reused. Never longer than the view's TTL, and
 * never past the snapshot row's own freshness (`fetchedAt` + TTL).
 */
export function remainingDashboardTtlSeconds(args: {
  fetchedAtMs: number;
  nowMs: number;
  live: boolean;
}): number {
  const ttlMs = dashboardResponseTtlSeconds(args.live) * 1000;
  const remainingMs = ttlMs - (args.nowMs - args.fetchedAtMs);
  if (remainingMs <= 0) return 0;
  return Math.floor(remainingMs / 1000);
}

/**
 * Timestamp stored with a load-or-build result. A finished build uses `nowMs`.
 * A fresh per-user row keeps its own `fetchedAt`. A stale row or the owner
 * snapshot is a fallback: `0` makes `remainingDashboardTtlSeconds` return 0
 * on a real clock, so the response cache does not store it.
 */
export function responseCacheFetchedAtMs(
  outcome: "built" | "fresh" | "fallback",
  nowMs: number,
  freshFetchedAtMs = 0,
): number {
  switch (outcome) {
    case "built":
      return nowMs;
    case "fresh":
      return freshFetchedAtMs;
    case "fallback":
      return 0;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export function dashboardViewCacheKey(
  sleeperUserId: string,
  view: DashboardResponseView,
): string {
  return `v1:${sleeperUserId}:${view}`;
}

/** Drop blank or oversized caller-supplied versions. They are a hint, not auth. */
export function normalizeRequestedSnapshotVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const trimmed = version.trim();
  if (!trimmed || trimmed.length > VERSION_MAX_LENGTH) return null;
  return trimmed;
}

/** ISO snapshot ids only — never echo an arbitrary string into a header. */
function snapshotHeaderValue(version: string): string | null {
  if (!/^[\w.:+-]+$/.test(version) || version.length > VERSION_MAX_LENGTH) return null;
  return version;
}

export function dashboardDeniedHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
}

/**
 * Fresh views revalidate on every browser request (`max-age=0`) so a new
 * snapshot version is picked up on the next load. The shared CDN is told
 * `no-store` as well: these bodies are per-user.
 */
export function dashboardViewResponseHeaders(args: {
  cache: "HIT" | "MISS";
  cacheable: boolean;
  version: string | null;
  live: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    Vary: "Authorization",
    "X-Dashboard-Cache": args.cache,
  };
  const snapshot = args.version ? snapshotHeaderValue(args.version) : null;
  if (!args.cacheable || !snapshot) {
    headers["Cache-Control"] = "private, no-store";
    return headers;
  }
  headers["Cache-Control"] = "private, max-age=0, must-revalidate";
  headers.ETag = `"${snapshot}"`;
  headers["X-Dashboard-Snapshot"] = snapshot;
  headers["X-Dashboard-Cache-Ttl"] = String(dashboardResponseTtlSeconds(args.live));
  return headers;
}

/** True while `expiresAtMs` is strictly in the future (deadline is absolute). */
function entryIsLive(entry: DashboardViewCacheEntry, nowMs: number): boolean {
  return entry.expiresAtMs > nowMs;
}

function isCacheEntry(value: unknown): value is DashboardViewCacheEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === "string"
    && typeof record.live === "boolean"
    && typeof record.expiresAtMs === "number"
    && "body" in record;
}

function approxEntryBytes(entry: DashboardViewCacheEntry): number {
  try {
    return Buffer.byteLength(JSON.stringify(entry.body), "utf8") + 256;
  } catch {
    return 64 * 1024; // unstringifiable bodies count against a fixed share
  }
}

/**
 * Bounded, byte-capped LRU kept in this isolate. Insertion-ordered Map gives
 * LRU by refreshing recency on hit; eviction walks from oldest. Never serves
 * an expired entry, and a set never rewrites an existing entry's deadline
 * (a near-expiry refresh stores the new value under its own expiry, it does
 * not extend the old one — expiry is stamped at write time from the
 * caller's remaining-TTL computation).
 */
export function createL1DashboardViewStore(options: {
  maxBytes?: number;
  bypass?: boolean;
  now?: () => number;
} = {}): DashboardViewStore {
  const maxBytes = options.maxBytes ?? DASHBOARD_L1_DEFAULT_MAX_BYTES;
  const bypass = options.bypass ?? false;
  const now = options.now ?? Date.now;
  const rows = new Map<string, { entry: DashboardViewCacheEntry; bytes: number }>();
  let totalBytes = 0;

  function evict(): void {
    for (const [key, row] of rows) {
      if (totalBytes <= maxBytes) break;
      rows.delete(key);
      totalBytes -= row.bytes;
      countCacheMetric("dashboard.l1.evicted");
    }
  }

  return {
    async get(key) {
      if (bypass) {
        countCacheMetric("dashboard.l1.bypassed");
        return null;
      }
      const row = rows.get(key);
      if (!row) {
        countCacheMetric("dashboard.l1.miss");
        return null;
      }
      if (!entryIsLive(row.entry, now())) {
        rows.delete(key);
        totalBytes -= row.bytes;
        countCacheMetric("dashboard.l1.miss");
        return null;
      }
      // Refresh recency.
      rows.delete(key);
      rows.set(key, row);
      countCacheMetric("dashboard.l1.hit");
      return row.entry;
    },
    async set(key, value, ttlSeconds) {
      if (bypass) {
        countCacheMetric("dashboard.l1.bypassed");
        return false;
      }
      if (ttlSeconds <= 0 || !isCacheEntry(value)) return false;
      const existing = rows.get(key);
      if (existing) {
        rows.delete(key);
        totalBytes -= existing.bytes;
      }
      const bytes = approxEntryBytes(value);
      if (bytes > maxBytes) {
        countCacheMetric("dashboard.l1.miss"); // never admit oversized bodies
        return false;
      }
      // The store stamps the deadline itself from the caller's remaining TTL
      // — a stored expiry is absolute for this isolate and is never extended
      // by a later set (a new value simply carries its own deadline).
      rows.set(key, { entry: { ...value, expiresAtMs: now() + ttlSeconds * 1000 }, bytes });
      totalBytes += bytes;
      evict();
      countCacheMetric("dashboard.l1.write");
      sampleCacheBytes("dashboard.l1.entry.bytes", bytes);
      return true;
    },
  };
}

let productionStore: DashboardViewStore | null = null;

export function getDashboardViewStore(): DashboardViewStore {
  productionStore ??= createL1DashboardViewStore({
    maxBytes: process.env.DASHBOARD_L1_MAX_BYTES
      ? Number(process.env.DASHBOARD_L1_MAX_BYTES)
      : undefined,
    bypass: process.env.DASHBOARD_L1_BYPASS === "1",
  });
  return productionStore;
}

export function resetDashboardViewCacheForTests(): void {
  productionStore = null;
}

function resolveStore(store: DashboardViewStore | undefined): DashboardViewStore {
  return store ?? getDashboardViewStore();
}

/** Serve the L1 entry for this user+view, honoring a requested version. */
async function recallDashboardView(args: {
  sleeperUserId: string;
  view: DashboardResponseView;
  requestedVersion: string | null;
  nowMs: number;
  store: DashboardViewStore;
}): Promise<DashboardViewCacheEntry | null> {
  const requestedVersion = normalizeRequestedSnapshotVersion(args.requestedVersion);
  const stored = await args.store.get(dashboardViewCacheKey(args.sleeperUserId, args.view));
  if (!isCacheEntry(stored)) return null;
  if (!entryIsLive(stored, args.nowMs)) return null;
  if (requestedVersion && requestedVersion !== stored.version) return null;
  return stored;
}

/** Write this user+view's latest snapshot body into L1. */
async function rememberDashboardView(args: {
  sleeperUserId: string;
  view: DashboardResponseView;
  version: string;
  live: boolean;
  body: unknown;
  ttlSeconds: number;
  nowMs: number;
  store: DashboardViewStore;
}): Promise<void> {
  if (args.ttlSeconds <= 0) return;
  const version = normalizeRequestedSnapshotVersion(args.version);
  if (!version) return;
  const entry: DashboardViewCacheEntry = {
    version,
    live: args.live,
    expiresAtMs: args.nowMs + args.ttlSeconds * 1000,
    body: args.body,
  };
  await args.store.set(dashboardViewCacheKey(args.sleeperUserId, args.view), entry, args.ttlSeconds);
}

export type DashboardOriginResult<T> =
  | { kind: "deny" }
  | { kind: "value"; body: T; version: string; live: boolean; ttlSeconds: number };

export type DashboardViewLoad<T> =
  | { ok: false; status: 401; error: typeof SIGN_IN_REQUIRED }
  | {
      ok: true;
      body: T;
      cache: "HIT" | "MISS";
      version: string | null;
      live: boolean;
      cacheable: boolean;
    };

/**
 * Scope-level single-flight: concurrent requests on this isolate for the
 * same user+view share one origin load. The entry is always deleted on
 * settle — a rejection is never cached and a resolved load is only "in
 * flight" dedupe, not a second cache tier (the L1 store is populated from
 * the load's result inside the shared path below).
 */
const inFlightViewLoads = new Map<string, Promise<unknown>>();

/**
 * Signed-out callers get 401 before any cache or origin read. A hit is the
 * latest snapshot for this sleeper user only, from the isolate-local L1.
 * `force`, expiry, and a caller-supplied version that doesn't match all
 * miss so a new snapshot is read from the Postgres rows (canonical store)
 * and then stored in L1.
 */
export async function loadCachedDashboardView<T>(args: {
  sleeperUserId: string | null;
  view: DashboardResponseView;
  requestedVersion: string | null;
  force?: boolean;
  nowMs?: number;
  store?: DashboardViewStore;
  loadOrigin: () => Promise<DashboardOriginResult<T>>;
}): Promise<DashboardViewLoad<T>> {
  if (!args.sleeperUserId) {
    return { ok: false, status: 401, error: SIGN_IN_REQUIRED };
  }
  const sleeperUserId = args.sleeperUserId;
  const nowMs = args.nowMs ?? Date.now();
  const store = resolveStore(args.store);
  if (!args.force) {
    try {
      const hit = await recallDashboardView({
        sleeperUserId,
        view: args.view,
        requestedVersion: args.requestedVersion,
        nowMs,
        store,
      });
      if (hit) {
        return {
          ok: true,
          body: hit.body as T,
          cache: "HIT",
          version: hit.version,
          live: hit.live,
          cacheable: true,
        };
      }
    } catch (error) {
      console.error("[dashboard-cache] recall failed", error);
    }
  }

  const flightKey = `${sleeperUserId}:${args.view}`;
  const existing = inFlightViewLoads.get(flightKey);
  if (existing) {
    countCacheMetric("dashboard.singleflight.joined");
    return existing as Promise<DashboardViewLoad<T>>;
  }

  const work = (async (): Promise<DashboardViewLoad<T>> => {
    const origin = await args.loadOrigin();
    if (origin.kind === "deny") {
      return { ok: false, status: 401, error: SIGN_IN_REQUIRED };
    }
    const cacheable = origin.ttlSeconds > 0 && normalizeRequestedSnapshotVersion(origin.version) != null;
    if (cacheable) {
      try {
        await rememberDashboardView({
          sleeperUserId,
          view: args.view,
          version: origin.version,
          live: origin.live,
          body: origin.body,
          ttlSeconds: origin.ttlSeconds,
          nowMs,
          store,
        });
      } catch (error) {
        console.error("[dashboard-cache] remember failed", error);
      }
    }
    return {
      ok: true,
      body: origin.body,
      cache: "MISS",
      version: normalizeRequestedSnapshotVersion(origin.version),
      live: origin.live,
      cacheable,
    };
  })();
  inFlightViewLoads.set(flightKey, work);
  try {
    return await work;
  } finally {
    inFlightViewLoads.delete(flightKey);
  }
}
