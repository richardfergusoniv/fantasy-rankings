import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import { badRequest, internalError, json } from "./api-utils.js";
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

async function fetchNflverseCsv(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`nflverse team-week stats HTTP ${response.status}`);
  return response.text();
}

async function loadTeamWeekStats(season: number): Promise<TeamWeekStats> {
  const now = Date.now();
  const cached = teamWeekStatsCache.get(season);
  if (cached && now - cached.fetchedAtMs < cached.ttlMs) {
    return cached.payload;
  }
  const [statsResult, snapsResult] = await Promise.allSettled([
    fetchNflverseCsv(nflversePlayerWeekStatsUrl(season)),
    fetchNflverseCsv(nflverseSnapCountsUrl(season)),
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
  const payload: TeamWeekStats = { season, stats, snaps };
  const complete = stats.length > 0 && snaps.length > 0;
  teamWeekStatsCache.set(season, {
    fetchedAtMs: now,
    ttlMs: complete ? TEAM_WEEK_STATS_STALE_MS : TEAM_WEEK_STATS_DEGRADED_TTL_MS,
    payload,
  });
  return payload;
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
