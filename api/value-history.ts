import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
  startOfUtcDay,
  upsertPlayerValueSnapshots,
} from "./_lib/player-value-history.js";
import {
  fetchJson,
  type FantasyCalcHistoryResponse,
  type FantasyCalcRow,
} from "./_lib/sleeper.js";

/**
 * GET /api/value-history?formatKey=&playerIds=a,b,c
 *
 * Replaces `getValueHistory`. Returns FantasyCalc value time series per
 * player, backfilling from the FantasyCalc API when the stored snapshots
 * are stale (> 1 day old).
 *
 * Query params:
 * - formatKey (required): e.g. "redraft-1qb-12t-0.5ppr"
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
});

export type ValueHistory = z.infer<typeof valueHistoryResponse>;

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
    const { formatKey, playerIds } = parsed.data;

    const yesterdayDate = startOfUtcDay(new Date());
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    const latestSnapshotRows = await db
      .select({ playerId: schema.playerValueSnapshots.playerId, snapshotDate: schema.playerValueSnapshots.snapshotDate })
      .from(schema.playerValueSnapshots)
      .where(and(eq(schema.playerValueSnapshots.formatKey, formatKey), inArray(schema.playerValueSnapshots.playerId, playerIds)))
      .orderBy(desc(schema.playerValueSnapshots.snapshotDate));
    const latestSnapshotByPlayer = new Map<string, string>();
    for (const row of latestSnapshotRows) {
      if (!latestSnapshotByPlayer.has(row.playerId)) latestSnapshotByPlayer.set(row.playerId, row.snapshotDate);
    }
    const hasFreshSnapshots = playerIds.every((playerId) => (latestSnapshotByPlayer.get(playerId) ?? "") >= yesterday);
    const preset = FANTASY_CALC_SNAPSHOT_PRESETS.find(({ format }) => format.key === formatKey);
    if (preset && !hasFreshSnapshots) {
      try {
        const currentRows = await fetchJson<FantasyCalcRow[]>(preset.url);
        const selected = currentRows.filter((row) => row.player?.sleeperId && playerIds.includes(row.player.sleeperId) && typeof row.player.id === "number");
        const cutoff = startOfUtcDay(new Date());
        cutoff.setUTCDate(cutoff.getUTCDate() - 29);
        const minSnapshotDate = cutoff.toISOString().slice(0, 10);
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
        const backfillRows = historyResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
        await upsertPlayerValueSnapshots(backfillRows);
      } catch {
        // Stored daily snapshots still provide an honest partial history.
      }
    }
    const rows = await db
      .select()
      .from(schema.playerValueSnapshots)
      .where(and(eq(schema.playerValueSnapshots.formatKey, formatKey), inArray(schema.playerValueSnapshots.playerId, playerIds)))
      .orderBy(asc(schema.playerValueSnapshots.snapshotDate));
    const cutoffDate = startOfUtcDay(new Date());
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 29);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.snapshotDate < cutoff) continue;
      const group = grouped.get(row.playerId) ?? [];
      group.push(row);
      grouped.set(row.playerId, group);
    }
    return json(valueHistoryResponse.parse({
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
    }));
  } catch (err) {
    return internalError(err);
  }
}
