/**
 * Sleeper's per-week player projections for any NFL week, including future
 * weeks. Third-party data we present, not something the app forecasts.
 *
 * The raw response is ~5.8 MB per week, so only players with a projection are
 * kept, and only the stat keys needed to rescore them in a league's rules.
 * A player on bye (or with no projection) has no row. Cached per week in
 * `source_cache`, served stale if Sleeper is down.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";
import { fetchJson, SLEEPER_PROJECTIONS_BASE } from "./sleeper.js";

export type WeekProjection = { opponent: string | null; stats: Record<string, number> };
export type WeekProjections = { season: number; week: number; asOf: string; players: Map<string, WeekProjection> };

type RawRow = {
  player_id?: string;
  opponent?: string | null;
  stats?: Record<string, number>;
};

/** Everything `scoreProjectedPlayerStats` reads, plus Sleeper's own point totals (used for DEF). */
const KEPT_STAT_KEYS = new Set([
  "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
  "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt",
  "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
  "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td",
  "fgm", "fgmiss", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p", "fgm_50p",
  "fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_60p",
  "fgm_yds", "xpm", "xpmiss",
  "pts_ppr", "pts_half_ppr", "pts_std",
]);

export const WEEK_PROJECTIONS_CACHE_MS = 12 * 60 * 60 * 1000;

type Stored = { asOf: string; rows: Record<string, [string | null, Record<string, number>]> };

export function compactWeekProjections(raw: unknown, asOf: string): Stored {
  const rows: Stored["rows"] = {};
  for (const row of Array.isArray(raw) ? (raw as RawRow[]) : []) {
    const id = row.player_id;
    const stats = row.stats;
    if (!id || !stats || !(Number(stats.pts_ppr) > 0)) continue;
    const kept: Record<string, number> = {};
    for (const [key, value] of Object.entries(stats)) {
      if (KEPT_STAT_KEYS.has(key) && typeof value === "number" && Number.isFinite(value) && value !== 0) kept[key] = value;
    }
    rows[id] = [row.opponent ?? null, kept];
  }
  return { asOf, rows };
}

function hydrate(season: number, week: number, stored: Stored): WeekProjections {
  return {
    season,
    week,
    asOf: stored.asOf,
    players: new Map(Object.entries(stored.rows).map(([id, [opponent, stats]]) => [id, { opponent, stats }])),
  };
}

const inFlight = new Map<string, Promise<WeekProjections>>();

export async function loadWeekProjections(season: number, week: number): Promise<WeekProjections> {
  const cacheKey = `sleeper-week-projections-v1:${season}:${week}`;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const run = (async () => {
    const cachedRows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, cacheKey)).limit(1);
    const cached = cachedRows[0];
    const readCached = () => hydrate(season, week, decodeSourceCachePayload(cached!.payload) as Stored);
    if (cached && Date.now() - cached.fetchedAt.getTime() < WEEK_PROJECTIONS_CACHE_MS) return readCached();
    try {
      const raw = await fetchJson<unknown>(
        `${SLEEPER_PROJECTIONS_BASE}/projections/nfl/${season}/${week}?season_type=regular&order_by=pts_ppr`,
      );
      const stored = compactWeekProjections(raw, new Date().toISOString());
      if (Object.keys(stored.rows).length === 0) throw new Error("Sleeper returned no projections for this week");
      const payload = encodeSourceCachePayload(stored);
      await db.insert(schema.sourceCache).values({ cacheKey, payload, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload, fetchedAt: new Date() } });
      return hydrate(season, week, stored);
    } catch (error) {
      if (cached) return readCached();
      throw error;
    }
  })().finally(() => { inFlight.delete(cacheKey); });
  inFlight.set(cacheKey, run);
  return run;
}
