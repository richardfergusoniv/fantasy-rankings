import { describe, expect, it } from "vitest";
import { LIVE_DASHBOARD_CACHE_MS, USER_DASHBOARD_CACHE_MS } from "./dashboard-build.js";
import {
  createMemoryDashboardViewStore,
  dashboardDeniedHeaders,
  dashboardResponseTtlSeconds,
  dashboardViewCacheKey,
  dashboardViewLatestKey,
  dashboardViewResponseHeaders,
  decodeStoredEntry,
  DASHBOARD_VIEW_FRESH_TTL_SECONDS,
  DASHBOARD_VIEW_LIVE_TTL_SECONDS,
  encodeForRuntime,
  loadCachedDashboardView,
  normalizeRequestedSnapshotVersion,
  recallDashboardView,
  remainingDashboardTtlSeconds,
  rememberDashboardView,
  responseCacheFetchedAtMs,
  type DashboardViewStore,
} from "./dashboard-response-cache.js";

const V1 = "2026-10-12T00:00:00.000Z";
const V2 = "2026-10-12T00:10:00.000Z";

function countingStore(inner: DashboardViewStore): DashboardViewStore & { gets: number; sets: number } {
  const counts = { gets: 0, sets: 0 };
  return {
    get gets() {
      return counts.gets;
    },
    get sets() {
      return counts.sets;
    },
    async get(key) {
      counts.gets += 1;
      return inner.get(key);
    },
    async set(key, value, ttlSeconds) {
      counts.sets += 1;
      await inner.set(key, value, ttlSeconds);
    },
  };
}

describe("dashboard view cache keys", () => {
  it("changes with the user, the view, and the snapshot version", () => {
    const base = dashboardViewCacheKey("user-a", "players", V1);
    expect(base).toBe(dashboardViewCacheKey("user-a", "players", V1));
    expect(base).not.toBe(dashboardViewCacheKey("user-b", "players", V1));
    expect(base).not.toBe(dashboardViewCacheKey("user-a", "trade", V1));
    expect(base).not.toBe(dashboardViewCacheKey("user-a", "players", V2));
    expect(dashboardViewLatestKey("user-a", "players")).not.toBe(dashboardViewLatestKey("user-b", "players"));
    expect(dashboardViewLatestKey("user-a", "players")).not.toContain(V1);
  });

  it("ignores blank or oversized version hints", () => {
    expect(normalizeRequestedSnapshotVersion(null)).toBeNull();
    expect(normalizeRequestedSnapshotVersion("  ")).toBeNull();
    expect(normalizeRequestedSnapshotVersion(`  ${V1}  `)).toBe(V1);
    expect(normalizeRequestedSnapshotVersion("x".repeat(65))).toBeNull();
  });
});

describe("dashboard view TTL", () => {
  it("matches the dashboard row TTL and does not outlive the live refresh", () => {
    expect(DASHBOARD_VIEW_LIVE_TTL_SECONDS * 1000).toBe(LIVE_DASHBOARD_CACHE_MS);
    expect(DASHBOARD_VIEW_FRESH_TTL_SECONDS * 1000).toBe(USER_DASHBOARD_CACHE_MS);
    expect(dashboardResponseTtlSeconds(true)).toBe(150);
    expect(dashboardResponseTtlSeconds(true)).toBeLessThanOrEqual(LIVE_DASHBOARD_CACHE_MS / 1000);
    expect(dashboardResponseTtlSeconds(false)).toBe(600);
  });

  it("shrinks to the time left on the snapshot and never goes negative", () => {
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 100_000, live: true })).toBe(50);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 150_000, live: true })).toBe(0);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 0, nowMs: 200_000, live: true })).toBe(0);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: 1_000, nowMs: 1_000, live: false })).toBe(600);
  });

  it("does not cache a stale or owner-snapshot fallback as a fresh build", () => {
    const nowMs = 1_700_000_000_000;
    const builtAt = responseCacheFetchedAtMs("built", nowMs);
    const freshAt = responseCacheFetchedAtMs("fresh", nowMs, nowMs - 60_000);
    const fallbackAt = responseCacheFetchedAtMs("fallback", nowMs);
    expect(builtAt).toBe(nowMs);
    expect(freshAt).toBe(nowMs - 60_000);
    expect(fallbackAt).toBe(0);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: builtAt, nowMs, live: false })).toBe(600);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: freshAt, nowMs, live: false })).toBe(540);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: fallbackAt, nowMs, live: false })).toBe(0);
    expect(remainingDashboardTtlSeconds({ fetchedAtMs: fallbackAt, nowMs, live: true })).toBe(0);
  });
});

describe("snapshot version cache", () => {
  it("serves a repeat read of the same version and switches when a new snapshot is published", async () => {
    const store = createMemoryDashboardViewStore(() => 1_000);
    await rememberDashboardView({
      sleeperUserId: "user-a",
      view: "trade",
      version: V1,
      live: false,
      body: { section: "trade", data: { leagues: ["old"] } },
      ttlSeconds: 600,
      nowMs: 1_000,
      store,
    });
    const first = await recallDashboardView({
      sleeperUserId: "user-a",
      view: "trade",
      requestedVersion: V1,
      nowMs: 1_000,
      store,
    });
    expect(first?.body).toEqual({ section: "trade", data: { leagues: ["old"] } });

    await rememberDashboardView({
      sleeperUserId: "user-a",
      view: "trade",
      version: V2,
      live: true,
      body: { section: "trade", data: { leagues: ["new"] } },
      ttlSeconds: 150,
      nowMs: 2_000,
      store,
    });
    const second = await recallDashboardView({
      sleeperUserId: "user-a",
      view: "trade",
      requestedVersion: null,
      nowMs: 2_000,
      store,
    });
    expect(second?.version).toBe(V2);
    expect(second?.live).toBe(true);
    expect(second?.body).toEqual({ section: "trade", data: { leagues: ["new"] } });
    // The previous version is no longer the latest pointer, so it is not served.
    const staleHint = await recallDashboardView({
      sleeperUserId: "user-a",
      view: "trade",
      requestedVersion: V1,
      nowMs: 2_000,
      store,
    });
    expect(staleHint).toBeNull();
  });

  it("does not let an older snapshot replace a newer one", async () => {
    const store = createMemoryDashboardViewStore();
    await rememberDashboardView({
      sleeperUserId: "user-a",
      view: "meta",
      version: V2,
      live: false,
      body: { section: "meta", data: "new" },
      ttlSeconds: 600,
      nowMs: 5_000,
      store,
    });
    await rememberDashboardView({
      sleeperUserId: "user-a",
      view: "meta",
      version: V1,
      live: false,
      body: { section: "meta", data: "old" },
      ttlSeconds: 600,
      nowMs: 6_000,
      store,
    });
    const hit = await recallDashboardView({
      sleeperUserId: "user-a",
      view: "meta",
      requestedVersion: null,
      nowMs: 6_000,
      store,
    });
    expect(hit?.version).toBe(V2);
    expect(hit?.body).toEqual({ section: "meta", data: "new" });
  });

  it("keeps two users on the same snapshot version apart", async () => {
    const store = createMemoryDashboardViewStore();
    await rememberDashboardView({
      sleeperUserId: "user-a",
      view: "players",
      version: V1,
      live: false,
      body: { secret: "a" },
      ttlSeconds: 600,
      nowMs: 1_000,
      store,
    });
    await rememberDashboardView({
      sleeperUserId: "user-b",
      view: "players",
      version: V1,
      live: false,
      body: { secret: "b" },
      ttlSeconds: 600,
      nowMs: 1_000,
      store,
    });
    const a = await recallDashboardView({
      sleeperUserId: "user-a",
      view: "players",
      requestedVersion: null,
      nowMs: 1_000,
      store,
    });
    const b = await recallDashboardView({
      sleeperUserId: "user-b",
      view: "players",
      requestedVersion: null,
      nowMs: 1_000,
      store,
    });
    expect(a?.body).toEqual({ secret: "a" });
    expect(b?.body).toEqual({ secret: "b" });
  });

  it("expires a live entry at the live refresh interval", async () => {
    let now = 10_000;
    const store = createMemoryDashboardViewStore(() => now);
    await rememberDashboardView({
      sleeperUserId: "user-a",
      view: "team",
      version: V1,
      live: true,
      body: { section: "team", data: { score: 1 } },
      ttlSeconds: dashboardResponseTtlSeconds(true),
      nowMs: now,
      store,
    });
    now += 149_000;
    expect(await recallDashboardView({
      sleeperUserId: "user-a",
      view: "team",
      requestedVersion: null,
      nowMs: now,
      store,
    })).not.toBeNull();
    now += 1_000;
    expect(await recallDashboardView({
      sleeperUserId: "user-a",
      view: "team",
      requestedVersion: null,
      nowMs: now,
      store,
    })).toBeNull();
  });
});

describe("dashboard view auth path", () => {
  it("returns 401 for a signed-out caller and does not touch the cache or origin", async () => {
    const store = countingStore(createMemoryDashboardViewStore());
    let originReads = 0;
    const result = await loadCachedDashboardView({
      sleeperUserId: null,
      view: "full",
      requestedVersion: V1,
      store,
      loadOrigin: async () => {
        originReads += 1;
        return { kind: "value", body: { dashboard: "nope" }, version: V1, live: false, ttlSeconds: 600 };
      },
    });
    expect(result).toEqual({ ok: false, status: 401, error: "Sign in required." });
    expect(store.gets).toBe(0);
    expect(store.sets).toBe(0);
    expect(originReads).toBe(0);
  });

  it("does not cache an origin denial", async () => {
    const store = countingStore(createMemoryDashboardViewStore());
    const result = await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "meta",
      requestedVersion: null,
      store,
      loadOrigin: async () => ({ kind: "deny" }),
    });
    expect(result).toEqual({ ok: false, status: 401, error: "Sign in required." });
    expect(store.sets).toBe(0);
  });

  it("serves a second load from cache and skips origin", async () => {
    const store = countingStore(createMemoryDashboardViewStore());
    let originReads = 0;
    const loadOrigin = async () => {
      originReads += 1;
      return {
        kind: "value" as const,
        body: { section: "league", data: { leagues: [1] } },
        version: V1,
        live: false,
        ttlSeconds: 600,
      };
    };
    const first = await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "league",
      requestedVersion: null,
      nowMs: 1_000,
      store,
      loadOrigin,
    });
    const second = await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "league",
      requestedVersion: V1,
      nowMs: 2_000,
      store,
      loadOrigin,
    });
    expect(first).toMatchObject({ ok: true, cache: "MISS" });
    expect(second).toMatchObject({
      ok: true,
      cache: "HIT",
      version: V1,
      body: { section: "league", data: { leagues: [1] } },
    });
    expect(originReads).toBe(1);
  });

  it("bypasses the cache on force and when the caller names a newer snapshot", async () => {
    const store = createMemoryDashboardViewStore();
    let originReads = 0;
    const loadOrigin = async () => {
      originReads += 1;
      return {
        kind: "value" as const,
        body: { dashboard: originReads },
        version: originReads === 1 ? V1 : V2,
        live: false,
        ttlSeconds: 600,
      };
    };
    await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "full",
      requestedVersion: null,
      nowMs: 1_000,
      store,
      loadOrigin,
    });
    const forced = await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "full",
      requestedVersion: null,
      force: true,
      nowMs: 2_000,
      store,
      loadOrigin,
    });
    expect(forced).toMatchObject({ ok: true, cache: "MISS", version: V2 });
    expect(originReads).toBe(2);
    const hinted = await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "full",
      requestedVersion: V1,
      nowMs: 3_000,
      store,
      loadOrigin,
    });
    expect(hinted).toMatchObject({ ok: true, cache: "MISS" });
    expect(originReads).toBe(3);
  });

  it("does not store an uncacheable origin result", async () => {
    const store = countingStore(createMemoryDashboardViewStore());
    await loadCachedDashboardView({
      sleeperUserId: "user-a",
      view: "team",
      requestedVersion: null,
      nowMs: 1_000,
      store,
      loadOrigin: async () => ({
        kind: "value",
        body: { section: "team", data: null },
        version: "",
        live: true,
        ttlSeconds: 0,
      }),
    });
    expect(store.sets).toBe(0);
  });
});

describe("dashboard response headers", () => {
  it("keeps fresh views private and out of the shared CDN", () => {
    const live = dashboardViewResponseHeaders({
      cache: "HIT",
      cacheable: true,
      version: V1,
      live: true,
    });
    expect(live["Cache-Control"]).toBe("private, max-age=0, must-revalidate");
    expect(live["Cache-Control"]).not.toContain("s-maxage");
    expect(live["Cache-Control"]).not.toContain("stale-while-revalidate");
    expect(live["CDN-Cache-Control"]).toBe("no-store");
    expect(live["Vercel-CDN-Cache-Control"]).toBe("no-store");
    expect(live.Vary).toBe("Authorization");
    expect(live["X-Dashboard-Cache"]).toBe("HIT");
    expect(live["X-Dashboard-Snapshot"]).toBe(V1);
    expect(live["X-Dashboard-Cache-Ttl"]).toBe("150");
    expect(live.ETag).toBe(`"${V1}"`);

    const fresh = dashboardViewResponseHeaders({
      cache: "MISS",
      cacheable: true,
      version: V2,
      live: false,
    });
    expect(fresh["X-Dashboard-Cache-Ttl"]).toBe("600");
    expect(fresh["Cache-Control"]).not.toContain("s-maxage");
  });

  it("does not store denials or uncacheable bodies", () => {
    expect(dashboardDeniedHeaders()["Cache-Control"]).toBe("private, no-store");
    expect(dashboardDeniedHeaders()["CDN-Cache-Control"]).toBe("no-store");
    const cold = dashboardViewResponseHeaders({
      cache: "MISS",
      cacheable: false,
      version: null,
      live: true,
    });
    expect(cold["Cache-Control"]).toBe("private, no-store");
    expect(cold["X-Dashboard-Snapshot"]).toBeUndefined();
    const injected = dashboardViewResponseHeaders({
      cache: "HIT",
      cacheable: true,
      version: "bad\r\nX-Injected: 1",
      live: false,
    });
    expect(injected["Cache-Control"]).toBe("private, no-store");
    expect(JSON.stringify(injected)).not.toContain("X-Injected");
  });
});

describe("runtime cache packing", () => {
  it("round-trips a body that does not fit the plain item", () => {
    const entry = {
      version: V1,
      live: false,
      expiresAtMs: 5_000,
      body: { rankings: "x".repeat(400) },
    };
    const packed = encodeForRuntime(entry, 200);
    expect(packed).not.toBe(entry);
    expect(packed).toMatchObject({ version: V1, bodyGz: expect.stringContaining("gz1:") });
    expect(decodeStoredEntry(packed, 4_000)?.body).toEqual(entry.body);
    expect(decodeStoredEntry(packed, 5_000)).toBeNull();
  });

  it("returns null when even the gzip form exceeds the cap", () => {
    const entry = {
      version: V1,
      live: true,
      expiresAtMs: 5_000,
      body: { blob: "y".repeat(2_000) },
    };
    expect(encodeForRuntime(entry, 32)).toBeNull();
  });
});
