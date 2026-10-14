import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  badRequest,
  internalError,
  json,
  unauthorized,
} from "./_lib/api-utils.js";
import { resolveSleeperUserId } from "./_lib/auth.js";
import {
  FANTASY_CALC_SNAPSHOT_PRESETS,
  fantasyCalcHistoryUrl,
  historySnapshotRowsFromPoints,
  isRedraftFormatKey,
  resolveFantasyCalcSnapshotFormatKey,
  startOfUtcDay,
  upsertPlayerValueSnapshots,
  utcDateKey,
  VALUE_HISTORY_CHART_MIN_DATE,
} from "./_lib/player-value-history.js";
import { isNflValueHistoryInSeason } from "./_lib/season-week.js";
import {
  fetchJson,
  type FantasyCalcHistoryResponse,
  type FantasyCalcRow,
} from "./_lib/sleeper.js";
import { readNflState } from "./_lib/user-leagues.js";

/**
 * GET /api/value-history?formatKey=&playerIds=a,b,c
 *
 * Replaces `getValueHistory`. Returns FantasyCalc value time series per
 * player from `VALUE_HISTORY_CHART_MIN_DATE` through today, backfilling from
 * the FantasyCalc API when the stored snapshots are stale. In-season (and
 * dynasty year-round) stale means latest snapshot older than yesterday; during
 * the NFL offseason redraft formats only require any prior snapshot because
 * the daily cron skips unchanged values.
 *
 * Requires a signed-in user with a linked Sleeper account. Responses are
 * cached in-process for the UTC day and sent with private HTTP cache headers
 * (values update once daily).
 *
 * Query params:
 * - formatKey (required): league season-long format key; mapped to the nearest
 *   FantasyCalc snapshot preset when it is not an exact preset key
 * - playerIds (required): comma-separated Sleeper player IDs, max 24
 */

const querySchema = z.object({
  formatKey: z.string().min(1),
  playerIds: z.array(z.string().min(1)).max(24).min(1),
});

const valueHistoryResponse = z.object({
  series: z.array(z.object({
    playerId: z.string(),
    name: z.string(),
    position: z.string(),
    points: z.array(z.object({ date: z.string(), value: z.number().int() })),
  })),
  formatKey: z.string(),
});

export type ValueHistory = z.infer<typeof valueHistoryResponse>;

type CacheEntry = {
  expiresAt: number;
  body: ValueHistory;
};

/** In-process cache; keyed per UTC day so daily value refreshes invalidate. */
const valueHistoryCache = new Map<string, CacheEntry>();
const VALUE_HISTORY_CACHE_MAX_ENTRIES = 500;

const VALUE_HISTORY_HTTP_CACHE_SECONDS = 60 * 60; // 1 hour

function endOfUtcDayMs(now: Date): number {
  const end = startOfUtcDay(now);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.getTime();
}

function cacheKeyFor(formatKey: string, playerIds: string[], dayKey: string): string {
  return `${dayKey}|${formatKey}|${[...playerIds].sort().join(",")}`;
}

function cachedResponse(body: ValueHistory): Response {
  return json(body, 200, {
    "Cache-Control": `private, max-age=${VALUE_HISTORY_HTTP_CACHE_SECONDS}`,
  });
}

/** Drop expired entries and enforce a hard size cap before inserting. */
function setValueHistoryCache(cacheKey: string, entry: CacheEntry): void {
  const nowMs = Date.now();
  for (const [key, cached] of valueHistoryCache) {
    if (cached.expiresAt <= nowMs) valueHistoryCache.delete(key);
  }
  if (valueHistoryCache.size >= VALUE_HISTORY_CACHE_MAX_ENTRIES) {
    const oldest = valueHistoryCache.keys().next().value;
    if (oldest !== undefined) valueHistoryCache.delete(oldest);
  }
  valueHistoryCache.set(cacheKey, entry);
}

export async function GET(req: Request): Promise<Response> {
  try {
    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");

    const url = new URL(req.url, "https://localhost");
    const rawPlayerIds = url.searchParams.get("playerIds") ?? "";
    const parsed = querySchema.safeParse({
      formatKey: url.searchParams.get("formatKey") ?? undefined,
      playerIds: rawPlayerIds.split(",").map((id) => id.trim()).filter(Boolean),
    });
    if (!parsed.success) return badRequest("Invalid query params", parsed.error.issues);
    const playerIds = parsed.data.playerIds;
    const formatKey = resolveFantasyCalcSnapshotFormatKey(parsed.data.formatKey);

    const now = new Date();
    const dayKey = utcDateKey(startOfUtcDay(now));
    const cacheKey = cacheKeyFor(formatKey, playerIds, dayKey);
    const cached = valueHistoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cachedResponse(cached.body);
    }

    const yesterdayDate = startOfUtcDay(now);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = utcDateKey(yesterdayDate);
    const latestSnapshotRows = await db
      .select({
        playerId: schema.playerValueSnapshots.playerId,
        snapshotDate: schema.playerValueSnapshots.snapshotDate,
      })
      .from(schema.playerValueSnapshots)
      .where(and(
        eq(schema.playerValueSnapshots.formatKey, formatKey),
        inArray(schema.playerValueSnapshots.playerId, playerIds),
      ))
      .orderBy(desc(schema.playerValueSnapshots.snapshotDate));
    const latestSnapshotByPlayer = new Map<string, string>();
    for (const row of latestSnapshotRows) {
      if (!latestSnapshotByPlayer.has(row.playerId)) {
        latestSnapshotByPlayer.set(row.playerId, row.snapshotDate);
      }
    }
    // Offseason redraft cron skips unchanged values, so a multi-day-old
    // latest row can still be fresh. Dynasty and in-season still need ≥ yesterday.
    let requireRecentDaily = true;
    if (isRedraftFormatKey(formatKey)) {
      try {
        const state = await readNflState();
        requireRecentDaily = isNflValueHistoryInSeason(state.seasonType);
      } catch {
        // Fail closed: keep the yesterday freshness bar if NFL state is down.
        requireRecentDaily = true;
      }
    }
    const hasFreshSnapshots = playerIds.every((playerId) => {
      const latest = latestSnapshotByPlayer.get(playerId);
      if (!latest) return false;
      if (!requireRecentDaily) return true;
      return latest >= yesterday;
    });
    const preset = FANTASY_CALC_SNAPSHOT_PRESETS.find(({ format }) => format.key === formatKey);
    if (preset && !hasFreshSnapshots) {
      try {
        const currentRows = await fetchJson<FantasyCalcRow[]>(preset.url);
        const selected = currentRows.filter(
          (row) => row.player?.sleeperId
            && playerIds.includes(row.player.sleeperId)
            && typeof row.player.id === "number",
        );
        const cutoff = startOfUtcDay(now);
        cutoff.setUTCDate(cutoff.getUTCDate() - 29);
        const minSnapshotDate = utcDateKey(cutoff);
        const historyResults = await Promise.allSettled(selected.map(async (row) => {
          const playerId = row.player?.sleeperId;
          const fantasyCalcId = row.player?.id;
          if (!playerId || typeof fantasyCalcId !== "number") return [];
          const history = await fetchJson<FantasyCalcHistoryResponse>(
            fantasyCalcHistoryUrl(preset.format, fantasyCalcId),
          );
          return historySnapshotRowsFromPoints({
            formatKey,
            playerId,
            playerName: row.player?.name ?? playerId,
            position: row.player?.position ?? "",
            points: history.historicalValues ?? [],
            minSnapshotDate,
          }).rows;
        }));
        const backfillRows = historyResults.flatMap(
          (result) => (result.status === "fulfilled" ? result.value : []),
        );
        await upsertPlayerValueSnapshots(backfillRows);
      } catch {
        // Stored daily snapshots still provide an honest partial history.
      }
    }

    const today = dayKey;
    const rows = await db
      .select({
        snapshotDate: schema.playerValueSnapshots.snapshotDate,
        playerId: schema.playerValueSnapshots.playerId,
        playerName: schema.playerValueSnapshots.playerName,
        position: schema.playerValueSnapshots.position,
        value: schema.playerValueSnapshots.value,
      })
      .from(schema.playerValueSnapshots)
      .where(and(
        eq(schema.playerValueSnapshots.formatKey, formatKey),
        inArray(schema.playerValueSnapshots.playerId, playerIds),
        gte(schema.playerValueSnapshots.snapshotDate, VALUE_HISTORY_CHART_MIN_DATE),
        lte(schema.playerValueSnapshots.snapshotDate, today),
      ))
      .orderBy(asc(schema.playerValueSnapshots.snapshotDate));

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = grouped.get(row.playerId) ?? [];
      group.push(row);
      grouped.set(row.playerId, group);
    }

    const body = valueHistoryResponse.parse({
      formatKey,
      series: playerIds.flatMap((playerId) => {
        const history = grouped.get(playerId);
        if (!history?.length) return [];
        const latest = history[history.length - 1];
        if (!latest) return [];
        return [{
          playerId,
          name: latest.playerName,
          position: latest.position,
          points: history.map((row) => ({ date: row.snapshotDate, value: row.value })),
        }];
      }),
    });

    setValueHistoryCache(cacheKey, { body, expiresAt: endOfUtcDayMs(now) });
    return cachedResponse(body);
  } catch (err) {
    return internalError(err);
  }
}
