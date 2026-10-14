import { gunzipSync, gzipSync } from "node:zlib";
import { getCache } from "@vercel/functions";
import { SIGN_IN_REQUIRED } from "./dashboard-access.js";
import { SOURCE_CACHE_GZIP_PREFIX } from "./source-cache-payload.js";
import type { DashboardCacheSection } from "./dashboard-section-cache.js";

/**
 * Response cache for dashboard views.
 *
 * Successful dashboard bodies are per-user. Vercel's CDN will not store a
 * response whose request carries `Authorization` (the dashboard client always
 * sends the Supabase JWT), and a shared CDN entry is keyed only by URL — so
 * `s-maxage` would hand one viewer's roster to the next caller, including a
 * signed-out visitor once the function is skipped. These responses stay
 * `private` / CDN `no-store`.
 *
 * Repeat reads are served from Vercel Runtime Cache (regional, shared across
 * isolates) keyed by sleeper user + view + snapshot version (`asOf`). A new
 * snapshot writes a new version key and moves the `latest` pointer, so the
 * previous entry is simply no longer read. No purge. Live snapshots use the
 * same 150s budget as the live refresh; other snapshots use the 10 minute
 * dashboard TTL. Neither window is extended with stale-while-revalidate.
 *
 * The in-process map is only a fallback when Runtime Cache is unavailable
 * (local tests, or a runtime-cache rejection such as the 2 MB item cap).
 */

/** Same duration as `USER_DASHBOARD_CACHE_MS` in dashboard-build. */
export const DASHBOARD_VIEW_FRESH_TTL_SECONDS = 10 * 60;
/** Same duration as `LIVE_DASHBOARD_CACHE_MS`. Do not cache live views longer. */
export const DASHBOARD_VIEW_LIVE_TTL_SECONDS = 150;

/** Stay under the Runtime Cache 2 MB item limit. */
const RUNTIME_CACHE_MAX_BYTES = 1_800_000;
/** Cap a poisoned or corrupt gzip entry. A dashboard view is well under this. */
const RUNTIME_CACHE_MAX_JSON_BYTES = 8_000_000;
const CACHE_NAMESPACE = "fr-dashboard-v1";
const VERSION_MAX_LENGTH = 64;

export type DashboardResponseView = DashboardCacheSection | "full";

export type DashboardViewCacheEntry = {
  version: string;
  live: boolean;
  expiresAtMs: number;
  body: unknown;
};

type LatestPointer = {
  version: string;
  expiresAtMs: number;
};

export type DashboardViewStore = {
  get(key: string): Promise<unknown | null>;
  /**
   * Store `value`. Returns true when other instances can read it.
   * A memory-only store returns true. The shared tier returns false when
   * that write fails or the body does not fit; the local copy is still kept.
   */
  set(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
  /**
   * Write this instance only. Used so a shared `latest` pointer is not
   * published when the versioned body never reached the shared cache.
   */
  setLocal?(key: string, value: unknown, ttlSeconds: number): Promise<void>;
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
  version: string,
): string {
  return `v1:${sleeperUserId}:${view}:${version}`;
}

export function dashboardViewLatestKey(
  sleeperUserId: string,
  view: DashboardResponseView,
): string {
  return `v1:${sleeperUserId}:${view}:latest`;
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

export function encodeForRuntime(
  entry: DashboardViewCacheEntry,
  maxBytes: number = RUNTIME_CACHE_MAX_BYTES,
): unknown | null {
  const plain = JSON.stringify(entry);
  if (Buffer.byteLength(plain, "utf8") <= maxBytes) return entry;
  const gz = SOURCE_CACHE_GZIP_PREFIX + gzipSync(Buffer.from(JSON.stringify(entry.body))).toString("base64");
  const packed = {
    version: entry.version,
    live: entry.live,
    expiresAtMs: entry.expiresAtMs,
    bodyGz: gz,
  };
  if (Buffer.byteLength(JSON.stringify(packed), "utf8") > maxBytes) return null;
  return packed;
}

function ungzipJson(payload: string): unknown {
  if (!payload.startsWith(SOURCE_CACHE_GZIP_PREFIX)) {
    throw new Error("expected gz1 payload");
  }
  const json = gunzipSync(Buffer.from(payload.slice(SOURCE_CACHE_GZIP_PREFIX.length), "base64"), {
    maxOutputLength: RUNTIME_CACHE_MAX_JSON_BYTES,
  }).toString("utf8");
  return JSON.parse(json) as unknown;
}

export function decodeStoredEntry(value: unknown, nowMs: number): DashboardViewCacheEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || typeof record.expiresAtMs !== "number") return null;
  if (record.expiresAtMs <= nowMs) return null;
  if (typeof record.bodyGz === "string") {
    try {
      const body = ungzipJson(record.bodyGz);
      return {
        version: record.version,
        live: record.live === true,
        expiresAtMs: record.expiresAtMs,
        body,
      };
    } catch {
      return null;
    }
  }
  if (!("body" in record) || typeof record.live !== "boolean") return null;
  return {
    version: record.version,
    live: record.live,
    expiresAtMs: record.expiresAtMs,
    body: record.body,
  };
}

function decodeLatest(value: unknown, nowMs: number): LatestPointer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || typeof record.expiresAtMs !== "number") return null;
  if (record.expiresAtMs <= nowMs) return null;
  // A full entry also has `body`. Latest pointers do not.
  if ("body" in record || "bodyGz" in record) return null;
  return { version: record.version, expiresAtMs: record.expiresAtMs };
}

export function createMemoryDashboardViewStore(now: () => number = Date.now): DashboardViewStore {
  const rows = new Map<string, { value: unknown; expiresAtMs: number }>();
  return {
    async get(key) {
      const row = rows.get(key);
      if (!row) return null;
      if (row.expiresAtMs <= now()) {
        rows.delete(key);
        return null;
      }
      return row.value;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0) {
        rows.delete(key);
        return true;
      }
      rows.set(key, { value, expiresAtMs: now() + ttlSeconds * 1000 });
      return true;
    },
  };
}

function unpackRuntimeValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("bodyGz" in value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.bodyGz !== "string" || typeof record.version !== "string") return null;
  if (typeof record.expiresAtMs !== "number") return null;
  try {
    return {
      version: record.version,
      live: record.live === true,
      expiresAtMs: record.expiresAtMs,
      body: ungzipJson(record.bodyGz),
    };
  } catch {
    return null;
  }
}

function peekLatestVersion(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || typeof record.expiresAtMs !== "number") return null;
  if ("body" in record || "bodyGz" in record) return null;
  return record.version;
}

/**
 * A publish writes this isolate's memory first, then Runtime Cache. If the
 * runtime write fails, memory is newer and must win. If this isolate has no
 * copy, the runtime value is what other isolates published.
 */
function preferCachedValue(local: unknown, remote: unknown): unknown {
  const localVersion = peekLatestVersion(local);
  const remoteVersion = peekLatestVersion(remote);
  if (localVersion && remoteVersion) {
    return localVersion >= remoteVersion ? local : remote;
  }
  return local ?? remote;
}

type RuntimeViewCache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ttl: number; name: string }): Promise<unknown>;
};

function defaultRuntimeViewCache(): RuntimeViewCache {
  return {
    async get(key) {
      return getCache({ namespace: CACHE_NAMESPACE }).get(key);
    },
    async set(key, value, options) {
      await getCache({ namespace: CACHE_NAMESPACE }).set(key, value, options);
    },
  };
}

export function createTieredDashboardViewStore(
  runtime: RuntimeViewCache = defaultRuntimeViewCache(),
  maxBytes: number = RUNTIME_CACHE_MAX_BYTES,
): DashboardViewStore {
  const memory = createMemoryDashboardViewStore();
  return {
    async get(key) {
      const local = await memory.get(key);
      let remote: unknown = null;
      try {
        const cached = await runtime.get(key);
        if (cached != null) remote = unpackRuntimeValue(cached);
      } catch (error) {
        console.error("[dashboard-cache] runtime get failed", error);
      }
      return preferCachedValue(local, remote);
    },
    async set(key, value, ttlSeconds) {
      await memory.set(key, value, ttlSeconds);
      if (ttlSeconds <= 0) return true;
      try {
        const payload = isCacheEntry(value) ? encodeForRuntime(value, maxBytes) : value;
        if (payload == null) return false;
        await runtime.set(key, payload, { ttl: ttlSeconds, name: "dashboard-view" });
        return true;
      } catch (error) {
        console.error("[dashboard-cache] runtime set failed", error);
        return false;
      }
    },
    async setLocal(key, value, ttlSeconds) {
      await memory.set(key, value, ttlSeconds);
    },
  };
}

function isCacheEntry(value: unknown): value is DashboardViewCacheEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === "string"
    && typeof record.live === "boolean"
    && typeof record.expiresAtMs === "number"
    && "body" in record
    && !("bodyGz" in record);
}

let productionStore: DashboardViewStore | null = null;

export function getDashboardViewStore(): DashboardViewStore {
  productionStore ??= createTieredDashboardViewStore();
  return productionStore;
}

export function resetDashboardViewCacheForTests(): void {
  productionStore = null;
}

function resolveStore(store: DashboardViewStore | undefined): DashboardViewStore {
  return store ?? getDashboardViewStore();
}

export async function recallDashboardView(args: {
  sleeperUserId: string;
  view: DashboardResponseView;
  requestedVersion: string | null;
  nowMs?: number;
  store?: DashboardViewStore;
}): Promise<DashboardViewCacheEntry | null> {
  const nowMs = args.nowMs ?? Date.now();
  const store = resolveStore(args.store);
  const requestedVersion = normalizeRequestedSnapshotVersion(args.requestedVersion);
  const latest = decodeLatest(
    await store.get(dashboardViewLatestKey(args.sleeperUserId, args.view)),
    nowMs,
  );
  if (!latest) return null;
  if (requestedVersion && requestedVersion !== latest.version) return null;
  return decodeStoredEntry(
    await store.get(dashboardViewCacheKey(args.sleeperUserId, args.view, latest.version)),
    nowMs,
  );
}

export async function rememberDashboardView(args: {
  sleeperUserId: string;
  view: DashboardResponseView;
  version: string;
  live: boolean;
  body: unknown;
  ttlSeconds: number;
  nowMs?: number;
  store?: DashboardViewStore;
}): Promise<void> {
  if (args.ttlSeconds <= 0) return;
  const version = normalizeRequestedSnapshotVersion(args.version);
  if (!version) return;
  const nowMs = args.nowMs ?? Date.now();
  const store = resolveStore(args.store);
  const latestKey = dashboardViewLatestKey(args.sleeperUserId, args.view);
  const current = decodeLatest(await store.get(latestKey), nowMs);
  // A slower read of an older snapshot must not clobber a newer publish.
  if (current && current.version > version) return;
  const expiresAtMs = nowMs + args.ttlSeconds * 1000;
  const entry: DashboardViewCacheEntry = {
    version,
    live: args.live,
    expiresAtMs,
    body: args.body,
  };
  const entryStored = await store.set(
    dashboardViewCacheKey(args.sleeperUserId, args.view, version),
    entry,
    args.ttlSeconds,
  );
  const pointer = { version, expiresAtMs } satisfies LatestPointer;
  // Other instances must not see `latest` unless they can also read the body.
  // This instance still keeps the pointer so its own next read is a hit.
  if (entryStored === false && store.setLocal) {
    await store.setLocal(latestKey, pointer, args.ttlSeconds);
    return;
  }
  await store.set(latestKey, pointer, args.ttlSeconds);
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
 * Signed-out callers get 401 before any cache or origin read. A hit is the
 * latest snapshot for this sleeper user only. `force`, expiry, and a
 * caller-supplied version that doesn't match `latest` all miss so a new
 * snapshot is read from origin and then stored under its own version.
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
}
