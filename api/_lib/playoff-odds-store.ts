/**
 * Precomputed projected standings + playoff odds, produced by the GitHub
 * Actions "Playoff odds precompute" workflow (scripts/compute-playoff-odds.ts)
 * so the 20,000-trial Monte Carlo runs on Actions minutes instead of inside
 * Vercel functions, where Fluid Active CPU is the tightest Hobby meter.
 *
 * Rows live in source_cache, one per Sleeper user per league: the projected
 * table and the odds' user sections are built around that viewer's team, so
 * the pair cannot be shared across users. Readers serve a stored row only
 * while it is fresh (see the TTL) and otherwise compute live exactly as
 * before, so a missing or stale row costs CPU, never correctness.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";
import type { ProjectedPlayoffOdds } from "./projected-playoff-odds.js";
import type { ProjectedStandings } from "./projected-standings.js";

/** How long a precomputed row may be served before readers compute live again. */
export const PLAYOFF_ODDS_STORE_TTL_MS = 3 * 60 * 60 * 1000;

export type StoredPlayoffOdds = {
  season: number;
  week: number;
  computedAt: string;
  projected: ProjectedStandings;
  odds: ProjectedPlayoffOdds;
};

export function playoffOddsCacheKey(sleeperUserId: string, leagueId: string): string {
  return `playoff-odds-v1:${sleeperUserId}:${leagueId}`;
}

/**
 * A stored row is servable only for the exact season and week it was computed
 * from, inside the TTL, and with both halves present. Anything else is a miss.
 */
export function parseStoredPlayoffOdds(value: unknown, season: number, week: number, nowMs: number): StoredPlayoffOdds | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<StoredPlayoffOdds>;
  if (entry.season !== season || entry.week !== week) return null;
  if (typeof entry.computedAt !== "string") return null;
  const computedMs = Date.parse(entry.computedAt);
  if (!Number.isFinite(computedMs) || computedMs > nowMs || nowMs - computedMs > PLAYOFF_ODDS_STORE_TTL_MS) return null;
  if (!entry.projected || typeof entry.projected !== "object") return null;
  if (!entry.odds || typeof entry.odds !== "object") return null;
  return entry as StoredPlayoffOdds;
}

export async function loadStoredPlayoffOdds(
  sleeperUserId: string,
  leagueId: string,
  season: number,
  week: number,
): Promise<StoredPlayoffOdds | null> {
  try {
    const rows = await db.select().from(schema.sourceCache)
      .where(eq(schema.sourceCache.cacheKey, playoffOddsCacheKey(sleeperUserId, leagueId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return parseStoredPlayoffOdds(decodeSourceCachePayload(row.payload), season, week, Date.now());
  } catch {
    // The store is an optimization only; any failure just computes live.
    return null;
  }
}

export async function storePlayoffOdds(sleeperUserId: string, leagueId: string, entry: StoredPlayoffOdds): Promise<void> {
  const cacheKey = playoffOddsCacheKey(sleeperUserId, leagueId);
  const payload = encodeSourceCachePayload(entry);
  await db.insert(schema.sourceCache)
    .values({ cacheKey, payload, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload, fetchedAt: new Date() } });
}
