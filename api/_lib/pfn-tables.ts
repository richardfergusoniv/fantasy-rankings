import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import { badRequest, internalError, json } from "./api-utils.js";
import { encodeSourceCachePayload } from "./source-cache-payload.js";
import { fetchText } from "./sleeper.js";
import {
  readTeamSituationalSnapshot,
  type TeamSituationalSnapshot,
} from "./team-situational.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";
import { loadPropLineWeek, type PropLineWeekPayload } from "./prop-line-week.js";
import {
  TEAM_WEEK_STATS_STALE_MS,
  nflversePlayerWeekStatsUrl,
  nflverseSnapCountsUrl,
  parsePlayerWeekStatsCsv,
  parseTeamWeekSnapCountsCsv,
  type TeamWeekSnapRow,
  type TeamWeekStatRow,
} from "./nflverse-team-week-stats.js";

/**
 * GET /api/pfn-tables
 * (served via /api/data/pfn-tables; old URL rewritten in vercel.json)
 *
 * Replaces `getpfntables`. Pure read of `pfn:*` keys from `source_cache`,
 * plus the cached team-situational snapshot.
 *
 * Also serves current-week prop lines from `prop_line_snapshots` (one compact
 * season/week query, in-process cached) so Monitor Props stays inside the
 * existing function budget — no new Vercel route file.
 *
 * `?team-week-stats=1&season=<year>` serves parsed nflverse week-by-week
 * player stats + snap counts for the Monitor Team stats panel and the game
 * lines hit-history. The CSVs are fetched and parsed here, server-side:
 * GitHub release assets send no CORS headers, so the browser cannot fetch
 * them directly (both panels came up empty when they tried).
 *
 * Optional query: `season`, `week` (defaults to current NFL state).
 */

const pfnTableKeys = ["offensive-line", "offense", "defense", "team-overall"] as const;
const pfnTableKeySchema = z.enum(pfnTableKeys);

const pfnMetricValueSchema = z.union([z.number(), z.string(), z.null()]);
const pfnRowSchema = z
  .object({
    rank: z.number().int(),
    team: z.string(),
    team_name: z.string(),
  })
  .catchall(pfnMetricValueSchema);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only schema
const storedPfnTableSchema = z.object({
  fetched_at: z.string(),
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(pfnRowSchema),
});

const storedPfnTableEnvelopeSchema = z.object({
  fetched_at: z.string(),
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(z.unknown()),
});

const propWeekQuerySchema = z.object({
  season: z.number().int().min(2020).max(2100).optional(),
  week: z.number().int().min(1).max(25).optional(),
});

export type PfnTables = {
  tables: Record<(typeof pfnTableKeys)[number], z.infer<typeof storedPfnTableSchema> | null>;
  teamSituational: TeamSituationalSnapshot | null;
  propLines: PropLineWeekPayload;
};

export type TeamWeekStats = {
  season: number;
  stats: TeamWeekStatRow[];
  snaps: TeamWeekSnapRow[];
};

// Parsed once per function instance and reused for the panels' stale
// window; the upstream nflverse files update a few times a day at most.
// One entry per season. A payload missing one of the two CSVs is only
// cached briefly, so a transient upstream failure can't pin a partial
// dataset in place for the full window (CodeRabbit, PR #126).
const TEAM_WEEK_STATS_DEGRADED_TTL_MS = 5 * 60 * 1000;
const teamWeekStatsCache = new Map<number, { fetchedAtMs: number; ttlMs: number; payload: TeamWeekStats }>();
// Single-flight guard so concurrent requests on this instance share one
// upstream fetch + parse; the source_cache row below shares the parsed
// payload across instances (audit finding #9).
const teamWeekStatsInFlight = new Map<number, Promise<TeamWeekStats>>();

const storedTeamWeekStatsSchema = z.object({
  season: z.number().int(),
  stats: z.array(z.record(z.string(), z.unknown())),
  snaps: z.array(z.record(z.string(), z.unknown())),
});

function teamWeekStatsCacheKey(season: number): string {
  return `team-week-stats:${season}`;
}

/** Parsed payload shared by every instance via source_cache. */
async function readStoredTeamWeekStats(season: number): Promise<{ payload: TeamWeekStats; fetchedAtMs: number } | null> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, teamWeekStatsCacheKey(season)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const parsed = storedTeamWeekStatsSchema.safeParse(decodeSourceCachePayload(row.payload));
  if (!parsed.success || parsed.data.season !== season) return null;
  return {
    payload: parsed.data as unknown as TeamWeekStats,
    fetchedAtMs: row.fetchedAt.getTime(),
  };
}

async function writeStoredTeamWeekStats(payload: TeamWeekStats): Promise<void> {
  await db
    .insert(schema.sourceCache)
    .values({
      cacheKey: teamWeekStatsCacheKey(payload.season),
      payload: encodeSourceCachePayload(payload),
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: encodeSourceCachePayload(payload), fetchedAt: new Date() },
    });
}

// fetchText bounds the upstream request (SOURCE_TIMEOUT_MS abort) so a hung
// nflverse download cannot hold the route open.
async function fetchAndParseTeamWeekStats(season: number): Promise<TeamWeekStats> {
  const [statsResult, snapsResult] = await Promise.allSettled([
    fetchText(nflversePlayerWeekStatsUrl(season)),
    fetchText(nflverseSnapCountsUrl(season)),
  ]);
  const stats = statsResult.status === "fulfilled"
    ? parsePlayerWeekStatsCsv(statsResult.value)
    : [];
  const snaps = snapsResult.status === "fulfilled"
    ? parseTeamWeekSnapCountsCsv(snapsResult.value)
    : [];
  if (stats.length === 0 && snaps.length === 0) {
    throw new Error("nflverse team-week stats unavailable");
  }
  return { season, stats, snaps };
}

/** Test helper: clear in-memory caches and in-flight guards. */
export function resetTeamWeekStatsCaches(): void {
  teamWeekStatsCache.clear();
  teamWeekStatsInFlight.clear();
}

export async function loadTeamWeekStats(season: number): Promise<TeamWeekStats> {
  const now = Date.now();
  const cached = teamWeekStatsCache.get(season);
  if (cached && now - cached.fetchedAtMs < cached.ttlMs) {
    return cached.payload;
  }
  // Shared cache: a payload another instance parsed recently wins without
  // touching the upstream at all.
  let staleStored: TeamWeekStats | null = null;
  try {
    const stored = await readStoredTeamWeekStats(season);
    if (stored) {
      if (now - stored.fetchedAtMs < TEAM_WEEK_STATS_STALE_MS) {
        teamWeekStatsCache.set(season, {
          fetchedAtMs: stored.fetchedAtMs,
          ttlMs: TEAM_WEEK_STATS_STALE_MS,
          payload: stored.payload,
        });
        return stored.payload;
      }
      staleStored = stored.payload;
    }
  } catch (error) {
    console.error("[pfn-tables] team-week stats cache read failed", error instanceof Error ? error.message : error);
  }

  const inFlight = teamWeekStatsInFlight.get(season);
  if (inFlight) return inFlight;

  // Upstream degraded: serve the last complete stored payload for the short
  // degraded TTL instead of hitting the upstream again on every request.
  const serveStale = (stale: TeamWeekStats): TeamWeekStats => {
    teamWeekStatsCache.set(season, { fetchedAtMs: Date.now(), ttlMs: TEAM_WEEK_STATS_DEGRADED_TTL_MS, payload: stale });
    return stale;
  };

  const load = (async () => {
    try {
      const payload = await fetchAndParseTeamWeekStats(season);
      const complete = payload.stats.length > 0 && payload.snaps.length > 0;
      // One CSV failed: a complete stored payload beats a fresh partial one.
      if (!complete && staleStored) return serveStale(staleStored);
      teamWeekStatsCache.set(season, {
        fetchedAtMs: Date.now(),
        ttlMs: complete ? TEAM_WEEK_STATS_STALE_MS : TEAM_WEEK_STATS_DEGRADED_TTL_MS,
        payload,
      });
      // Persist only complete payloads so a transient upstream failure can't
      // pin a partial dataset in place for the full window.
      // Awaited: a serverless instance can freeze once the response is
      // sent, dropping an unawaited write.
      if (complete) {
        try {
          await writeStoredTeamWeekStats(payload);
        } catch (error) {
          console.error("[pfn-tables] team-week stats cache write failed", error instanceof Error ? error.message : error);
        }
      }
      return payload;
    } catch (error) {
      // Controlled response on upstream failure: serve the last good stored
      // payload when one exists, however stale.
      if (staleStored) return serveStale(staleStored);
      throw error;
    } finally {
      teamWeekStatsInFlight.delete(season);
    }
  })();
  teamWeekStatsInFlight.set(season, load);
  return load;
}

const teamWeekStatsSeasonSchema = z.number().int().min(2020).max(2100);

const PROP_LINES_HTTP_CACHE_SECONDS = 15 * 60;

async function loadPfnTables(): Promise<PfnTables["tables"]> {
  const keys = pfnTableKeys.map((tableKey) => `pfn:${tableKey}`);
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(inArray(schema.sourceCache.cacheKey, keys));

  const tables: Record<(typeof pfnTableKeys)[number], z.infer<typeof storedPfnTableSchema> | null> = {
    "offensive-line": null,
    offense: null,
    defense: null,
    "team-overall": null,
  };

  for (const row of rows) {
    const tableKey = row.cacheKey.slice(4);
    const parsedKey = pfnTableKeySchema.safeParse(tableKey);
    if (!parsedKey.success) continue;
    try {
      const envelope = storedPfnTableEnvelopeSchema.safeParse(decodeSourceCachePayload(row.payload));
      if (!envelope.success) continue;
      const validRows = envelope.data.rows
        .flatMap((candidate) => {
          const parsedRow = pfnRowSchema.safeParse(candidate);
          return parsedRow.success ? [parsedRow.data] : [];
        })
        .sort((a, b) => a.rank - b.rank);
      tables[parsedKey.data] = {
        fetched_at: envelope.data.fetched_at,
        label: envelope.data.label,
        columns: envelope.data.columns,
        column_labels: envelope.data.column_labels,
        rows: validRows,
      };
    } catch {
      // Skip malformed cached tables.
    }
  }

  return tables;
}

export async function handlePfnTables(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    if (url.searchParams.has("team-week-stats")) {
      const seasonRaw = url.searchParams.get("season");
      const parsedSeason = teamWeekStatsSeasonSchema.safeParse(
        seasonRaw == null || seasonRaw === "" ? Number.NaN : Number(seasonRaw),
      );
      if (!parsedSeason.success) {
        return badRequest("Invalid or missing `season` query param.", parsedSeason.error.issues);
      }
      const payload = await loadTeamWeekStats(parsedSeason.data);
      return json(payload, 200, {
        "Cache-Control": `private, max-age=${PROP_LINES_HTTP_CACHE_SECONDS}`,
      });
    }
    const seasonRaw = url.searchParams.get("season");
    const weekRaw = url.searchParams.get("week");
    const parsedQuery = propWeekQuerySchema.safeParse({
      season: seasonRaw == null || seasonRaw === "" ? undefined : Number(seasonRaw),
      week: weekRaw == null || weekRaw === "" ? undefined : Number(weekRaw),
    });
    if (!parsedQuery.success) {
      return badRequest("Invalid season/week query params.", parsedQuery.error.issues);
    }

    let propLinesDegraded = false;
    const [tables, teamSituational, propLines] = await Promise.all([
      loadPfnTables(),
      readTeamSituationalSnapshot(),
      loadPropLineWeek(parsedQuery.data).catch((err): PropLineWeekPayload => {
        propLinesDegraded = true;
        console.error("[pfn-tables] prop lines unavailable", err instanceof Error ? err.message : err);
        return {
          season: parsedQuery.data.season ?? 0,
          week: parsedQuery.data.week ?? 0,
          pulledAt: null,
          sleeperPulledAt: null,
          degraded: true,
          lines: [],
          weeklyLines: [],
        };
      }),
    ]);

    return json(
      { tables, teamSituational, propLines },
      200,
      {
        "Cache-Control": propLinesDegraded
          ? "private, no-store"
          : `private, max-age=${PROP_LINES_HTTP_CACHE_SECONDS}`,
      },
    );
  } catch (err) {
    return internalError(err);
  }
}
