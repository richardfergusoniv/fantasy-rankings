import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db.js";
import { splitCsvLine } from "./chart-metric-transforms.js";
import { SOURCE_TIMEOUT_MS } from "./sleeper.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";

/**
 * Free weekly player data that Sleeper does not show, stored as one compact
 * snapshot in `source_cache` (never the raw files):
 *
 * - Expected fantasy points (ffverse ffopportunity, PPR): what a player's
 *   usage was worth versus what he scored.
 * - Next Gen Stats season rows (nflverse): separation, cushion, YAC over
 *   expected, rush yards over expected, time to throw, aggressiveness.
 * - Depth charts (nflverse, ESPN-sourced): each player's rank at his
 *   position on the latest daily chart.
 *
 * Expected points and Next Gen rows are keyed by gsis id (the analytics
 * entity id); depth rows by Sleeper player id.
 */

export const FF_OPPORTUNITY_2026_URL =
  "https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_2026.csv";
export const NGS_URLS = {
  receiving: "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_receiving.csv.gz",
  rushing: "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.csv.gz",
  passing: "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_passing.csv.gz",
} as const;
export const DEPTH_CHARTS_2026_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_2026.csv";
export const PLAYER_IDS_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

export const PLAYER_INSIGHTS_CACHE_KEY = "player-insights-2026-v1";
export const PLAYER_INSIGHTS_CACHE_MS = 6 * 60 * 60 * 1000;
const SEASON = 2026;

const opportunitySchema = z.object({
  games: z.number().int(),
  /** Expected PPR points, season total. */
  expected: z.number(),
  /** Actual PPR points, season total. */
  actual: z.number(),
  /** [week, expected, actual], one per game. */
  weeks: z.array(z.tuple([z.number().int(), z.number(), z.number()])),
});

const depthSchema = z.object({
  position: z.string(),
  rank: z.number().int(),
});

export const playerInsightsSnapshotSchema = z.object({
  fetchedAt: z.string(),
  season: z.literal(SEASON),
  opportunity: z.record(z.string(), opportunitySchema),
  ngs: z.record(z.string(), z.record(z.string(), z.number())),
  depth: z.record(z.string(), depthSchema),
  depthAsOf: z.string().nullable(),
  /** The same ranks from the oldest chart in the past week, to show who moved. */
  depthPrevious: z.record(z.string(), depthSchema).default({}),
  /**
   * gsis_id → Sleeper id from dynastyprocess db_playerids; used to stamp analytics.playerId.
   * Optional (no default): pre-map snapshots omit the key so load/refresh can migrate
   * instead of treating an empty `{}` default as a fresh cache hit.
   */
  sleeperByGsis: z.record(z.string(), z.string()).optional(),
});

export type PlayerInsightsSnapshot = z.infer<typeof playerInsightsSnapshotSchema>;
export type PlayerOpportunity = z.infer<typeof opportunitySchema>;
export type PlayerDepth = z.infer<typeof depthSchema>;

// ---------------------------------------------------------------------------
// Parsing (pure)
// ---------------------------------------------------------------------------

export function csvObjects(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0] ? splitCsvLine(lines[0]) : [];
  const rows: Record<string, string>[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((key, column) => {
      row[key] = cells[column] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "" || value === "NA") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Season totals and per-week values from ffopportunity `ep_weekly_<season>.csv`. */
export function parseOpportunity(csv: string, season = SEASON): Record<string, PlayerOpportunity> {
  const output: Record<string, PlayerOpportunity> = {};
  for (const row of csvObjects(csv)) {
    if (num(row.season) !== season) continue;
    const week = num(row.week);
    const id = row.player_id;
    const expected = num(row.total_fantasy_points_exp);
    const actual = num(row.total_fantasy_points);
    if (!id || id === "NA" || week === null || week > 18 || expected === null || actual === null) continue;
    const entry = output[id] ?? { games: 0, expected: 0, actual: 0, weeks: [] };
    entry.games += 1;
    entry.expected += expected;
    entry.actual += actual;
    entry.weeks.push([week, round1(expected), round1(actual)]);
    output[id] = entry;
  }
  for (const entry of Object.values(output)) {
    entry.expected = round1(entry.expected);
    entry.actual = round1(entry.actual);
    entry.weeks.sort((a, b) => a[0] - b[0]);
  }
  return output;
}

/** NGS file column → analytics metric key. */
const NGS_COLUMNS: Record<keyof typeof NGS_URLS, Array<[string, string]>> = {
  receiving: [
    ["avg_separation", "separation"],
    ["avg_cushion", "cushion"],
    ["avg_yac_above_expectation", "yac_over_expected"],
    ["percent_share_of_intended_air_yards", "intended_air_share"],
  ],
  rushing: [
    ["rush_yards_over_expected_per_att", "rush_yards_over_expected"],
    ["percent_attempts_gte_eight_defenders", "stacked_box_rate"],
    ["efficiency", "rush_efficiency"],
  ],
  passing: [
    ["avg_time_to_throw", "time_to_throw"],
    ["aggressiveness", "aggressiveness"],
    ["avg_air_yards_differential", "air_yards_differential"],
  ],
};

/** Season rows (week 0) for one NGS file, merged into `into` by gsis id. */
/**
 * One map of Next Gen Stats by gsis id, or empty when any file had no season
 * rows, so the refresh keeps the previous set instead of a partial one.
 */
export function mergeNgsSources(sources: Array<Record<string, Record<string, number>>>): Record<string, Record<string, number>> {
  if (sources.some((source) => Object.keys(source).length === 0)) return {};
  const merged: Record<string, Record<string, number>> = {};
  for (const source of sources) {
    for (const [id, metrics] of Object.entries(source)) Object.assign((merged[id] ??= {}), metrics);
  }
  return merged;
}

export function parseNgs(
  csv: string,
  kind: keyof typeof NGS_URLS,
  into: Record<string, Record<string, number>> = {},
  season = SEASON,
): Record<string, Record<string, number>> {
  for (const row of csvObjects(csv)) {
    if (num(row.season) !== season || row.season_type !== "REG" || num(row.week) !== 0) continue;
    const id = row.player_gsis_id;
    if (!id) continue;
    const values = into[id] ?? {};
    for (const [column, key] of NGS_COLUMNS[kind]) {
      const value = num(row[column]);
      if (value !== null) values[key] = round2(value);
    }
    into[id] = values;
  }
  return into;
}

export type PlayerIdMaps = {
  sleeperByGsis: Map<string, string>;
};

export function parsePlayerIds(csv: string): PlayerIdMaps {
  const sleeperByGsis = new Map<string, string>();
  for (const row of csvObjects(csv)) {
    const sleeper = row.sleeper_id;
    if (!sleeper || sleeper === "NA") continue;
    if (row.gsis_id && row.gsis_id !== "NA") sleeperByGsis.set(row.gsis_id, sleeper);
  }
  return { sleeperByGsis };
}

const DEPTH_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/**
 * Offensive skill-position ranks from the latest chart in depth-chart rows.
 * A player listed in several slots keeps his best rank.
 */
export function depthFromRows(
  rows: Iterable<Record<string, string>>,
  sleeperByGsis: Map<string, string>,
): { depth: Record<string, PlayerDepth>; asOf: string | null } {
  const list = [...rows];
  const asOf = list.reduce<string | null>((latest, row) => (row.dt && (!latest || row.dt > latest) ? row.dt : latest), null);
  const depth: Record<string, PlayerDepth> = {};
  for (const row of list) {
    if (row.dt !== asOf || !DEPTH_POSITIONS.has(row.pos_abb)) continue;
    const sleeperId = sleeperByGsis.get(row.gsis_id);
    const rank = num(row.pos_rank);
    if (!sleeperId || rank === null || rank < 1) continue;
    const previous = depth[sleeperId];
    if (!previous || rank < previous.rank) depth[sleeperId] = { position: row.pos_abb, rank };
  }
  return { depth, asOf };
}

/**
 * The ranks from the oldest chart in the rows that came before the newest one,
 * so a player's move over the past week shows against the latest ranks.
 */
export function previousDepthFromRows(
  rows: Iterable<Record<string, string>>,
  sleeperByGsis: Map<string, string>,
): Record<string, PlayerDepth> {
  const list = [...rows];
  const dates = [...new Set(list.map((row) => row.dt).filter(Boolean))].sort();
  const previousDt = dates.length > 1 ? dates[0] : null;
  if (!previousDt) return {};
  return depthFromRows(list.filter((row) => row.dt === previousDt), sleeperByGsis).depth;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** The timeout covers the whole download, not only the response headers. */
async function fetchCsv(url: string, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "user-agent": "fantasy-rankings-player-insights/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    if (!url.endsWith(".gz")) return await response.text();
    return gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

const DEPTH_COMPARE_DAYS = 7;

/**
 * The 2026 depth-chart file holds every daily chart (tens of MB), newest
 * first. Read the charts from the newest back a week, then stop the download.
 */
async function fetchRecentDepthRows(url: string): Promise<Record<string, string>[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(SOURCE_TIMEOUT_MS, 30_000));
  const rows: Record<string, string>[] = [];
  try {
    const response = await fetch(url, { headers: { "user-agent": "fantasy-rankings-player-insights/1.0" }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`depth charts HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let header: string[] | null = null;
    let firstDt: string | null = null;
    let cutoff = Number.NEGATIVE_INFINITY;
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const cells = splitCsvLine(line);
        if (!header) {
          header = cells;
          continue;
        }
        const row: Record<string, string> = {};
        header.forEach((key, column) => {
          row[key] = cells[column] ?? "";
        });
        if (firstDt === null) {
          firstDt = row.dt ?? "";
          const newest = Date.parse(firstDt);
          if (Number.isFinite(newest)) cutoff = newest - DEPTH_COMPARE_DAYS * 24 * 60 * 60 * 1000;
        }
        const rowTime = Date.parse(row.dt ?? "");
        if (Number.isFinite(rowTime) && rowTime < cutoff) {
          await reader.cancel();
          return rows;
        }
        rows.push(row);
      }
      if (done) return rows;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function fetchPlayerInsightsSnapshot(): Promise<PlayerInsightsSnapshot> {
  const [opportunityCsv, receivingCsv, rushingCsv, passingCsv, idsCsv, depthRows] = await Promise.all([
    fetchCsv(FF_OPPORTUNITY_2026_URL),
    fetchCsv(NGS_URLS.receiving),
    fetchCsv(NGS_URLS.rushing),
    fetchCsv(NGS_URLS.passing),
    fetchCsv(PLAYER_IDS_URL),
    fetchRecentDepthRows(DEPTH_CHARTS_2026_URL).catch(() => []),
  ]);
  const ids = parsePlayerIds(idsCsv);
  const ngs = mergeNgsSources([
    parseNgs(receivingCsv, "receiving"),
    parseNgs(rushingCsv, "rushing"),
    parseNgs(passingCsv, "passing"),
  ]);
  const { depth, asOf: depthAsOf } = depthFromRows(depthRows, ids.sleeperByGsis);
  const depthPrevious = previousDepthFromRows(depthRows, ids.sleeperByGsis);
  return {
    fetchedAt: new Date().toISOString(),
    season: SEASON,
    opportunity: parseOpportunity(opportunityCsv),
    ngs,
    depth,
    depthAsOf,
    depthPrevious,
    sleeperByGsis: Object.fromEntries(ids.sleeperByGsis),
  };
}

/** A fetch that came back mostly empty keeps the previous snapshot. */
function looksComplete(snapshot: PlayerInsightsSnapshot): boolean {
  return Object.keys(snapshot.opportunity).length >= 100;
}

/** Pre-map caches lack sleeperByGsis (or parsed empty); force refresh rather than stamp null playerIds. */
export function playerInsightsNeedsSleeperIdMigration(snapshot: PlayerInsightsSnapshot): boolean {
  const map = snapshot.sleeperByGsis;
  return map === undefined || Object.keys(map).length === 0;
}

function snapshotIsFresh(snapshot: PlayerInsightsSnapshot): boolean {
  return Date.now() - Date.parse(snapshot.fetchedAt) < PLAYER_INSIGHTS_CACHE_MS
    && !playerInsightsNeedsSleeperIdMigration(snapshot);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export async function readPlayerInsightsSnapshot(): Promise<PlayerInsightsSnapshot | null> {
  const [cached] = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, PLAYER_INSIGHTS_CACHE_KEY))
    .limit(1);
  if (!cached) return null;
  try {
    const parsed = playerInsightsSnapshotSchema.safeParse(decodeSourceCachePayload(cached.payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writePlayerInsightsSnapshot(snapshot: PlayerInsightsSnapshot): Promise<void> {
  const payload = encodeSourceCachePayload(snapshot);
  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_INSIGHTS_CACHE_KEY,
    payload,
    fetchedAt: new Date(snapshot.fetchedAt),
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload, fetchedAt: new Date(snapshot.fetchedAt) },
  });
}

/** Cached snapshot when fresh; otherwise refetch and store (keeping the old one on failure). */
export async function loadPlayerInsightsSnapshot(options?: { force?: boolean }): Promise<PlayerInsightsSnapshot | null> {
  const previous = await readPlayerInsightsSnapshot().catch(() => null);
  if (!options?.force && previous && snapshotIsFresh(previous)) {
    return previous;
  }
  try {
    const snapshot = await fetchPlayerInsightsSnapshot();
    if (!looksComplete(snapshot)) return previous;
    // A Next Gen Stats or depth source that failed this run keeps its last good rows.
    if (Object.keys(snapshot.ngs).length === 0 && previous) snapshot.ngs = previous.ngs;
    if (Object.keys(snapshot.depth).length === 0 && previous) {
      snapshot.depth = previous.depth;
      snapshot.depthAsOf = previous.depthAsOf;
      snapshot.depthPrevious = previous.depthPrevious;
    }
    await writePlayerInsightsSnapshot(snapshot);
    return snapshot;
  } catch {
    return previous;
  }
}

export type PlayerInsightsRefreshResult = {
  ok: boolean;
  status: "committed" | "kept-previous" | "fresh-cache" | "empty";
  opportunity: number;
  ngs: number;
  depth: number;
  fetchedAt: string | null;
};

function refreshResult(status: PlayerInsightsRefreshResult["status"], snapshot: PlayerInsightsSnapshot | null): PlayerInsightsRefreshResult {
  return {
    // "empty": nothing could be fetched and nothing is stored, so report a failure.
    ok: status !== "empty",
    status,
    opportunity: snapshot ? Object.keys(snapshot.opportunity).length : 0,
    ngs: snapshot ? Object.keys(snapshot.ngs).length : 0,
    depth: snapshot ? Object.keys(snapshot.depth).length : 0,
    fetchedAt: snapshot?.fetchedAt ?? null,
  };
}

export async function refreshPlayerInsightsSnapshot(): Promise<PlayerInsightsRefreshResult> {
  const previous = await readPlayerInsightsSnapshot().catch(() => null);
  if (previous && snapshotIsFresh(previous)) {
    return refreshResult("fresh-cache", previous);
  }
  const snapshot = await loadPlayerInsightsSnapshot({ force: true });
  if (!snapshot) return refreshResult(previous ? "kept-previous" : "empty", previous);
  const committed = !previous || snapshot.fetchedAt !== previous.fetchedAt;
  return refreshResult(committed ? "committed" : "kept-previous", snapshot);
}
