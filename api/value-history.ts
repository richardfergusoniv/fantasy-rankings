import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../lib/db";
import {
  badRequest,
  internalError,
  json,
  methodNotAllowed,
} from "../lib/api-utils";
import {
  FANTASY_CALC_HISTORY_URL,
  FANTASY_CALC_VALUES_URL,
  fetchJson,
  type FantasyCalcHistoryResponse,
  type FantasyCalcRow,
  type SeasonLongFormat,
} from "../lib/sleeper";

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

const FANTASY_CALC_PRESETS: Array<{ format: SeasonLongFormat; url: string }> = [
  { format: { key: "redraft-1qb-12t-0.5ppr", isDynasty: false, numQbs: 1, numTeams: 12, ppr: 0.5, label: "Redraft · 12-team · 1QB · Half PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5` },
  { format: { key: "redraft-1qb-10t-0.5ppr", isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, label: "Redraft · 10-team · 1QB · Half PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=10&ppr=0.5` },
  { format: { key: "redraft-1qb-12t-1ppr", isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, label: "Redraft · 12-team · 1QB · PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=12&ppr=1` },
  { format: { key: "redraft-2qb-14t-1ppr", isDynasty: false, numQbs: 2, numTeams: 14, ppr: 1, label: "Redraft · 14-team · Superflex / 2QB · PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=14&ppr=1` },
  { format: { key: "redraft-2qb-12t-0.5ppr", isDynasty: false, numQbs: 2, numTeams: 12, ppr: 0.5, label: "Redraft · 12-team · Superflex / 2QB · Half PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=12&ppr=0.5` },
  { format: { key: "redraft-2qb-12t-1ppr", isDynasty: false, numQbs: 2, numTeams: 12, ppr: 1, label: "Redraft · 12-team · Superflex / 2QB · PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=12&ppr=1` },
  { format: { key: "dynasty-1qb-10t-0.5ppr", isDynasty: true, numQbs: 1, numTeams: 10, ppr: 0.5, label: "Dynasty · 10-team · 1QB · Half PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=1&numTeams=10&ppr=0.5` },
  { format: { key: "dynasty-1qb-12t-1ppr", isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1, label: "Dynasty · 12-team · 1QB · PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=1&numTeams=12&ppr=1` },
  { format: { key: "dynasty-2qb-14t-1ppr", isDynasty: true, numQbs: 2, numTeams: 14, ppr: 1, label: "Dynasty · 14-team · Superflex / 2QB · PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=14&ppr=1` },
  { format: { key: "dynasty-2qb-12t-0.5ppr", isDynasty: true, numQbs: 2, numTeams: 12, ppr: 0.5, label: "Dynasty · 12-team · Superflex / 2QB · Half PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5` },
  { format: { key: "dynasty-2qb-12t-1ppr", isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, label: "Dynasty · 12-team · Superflex / 2QB · PPR" }, url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=12&ppr=1` },
];

function startOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  try {
    const url = new URL(req.url);
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
    const preset = FANTASY_CALC_PRESETS.find(({ format }) => format.key === formatKey);
    if (preset && !hasFreshSnapshots) {
      try {
        const currentRows = await fetchJson<FantasyCalcRow[]>(preset.url);
        const selected = currentRows.filter((row) => row.player?.sleeperId && playerIds.includes(row.player.sleeperId) && typeof row.player.id === "number");
        const historyResults = await Promise.allSettled(selected.map(async (row) => {
          const playerId = row.player?.sleeperId;
          const fantasyCalcId = row.player?.id;
          if (!playerId || typeof fantasyCalcId !== "number") return [];
          const query = new URLSearchParams({
            isDynasty: String(preset.format.isDynasty),
            numQbs: String(preset.format.numQbs),
            numTeams: String(preset.format.numTeams),
            ppr: String(preset.format.ppr),
          });
          const history = await fetchJson<FantasyCalcHistoryResponse>(`${FANTASY_CALC_HISTORY_URL}/${fantasyCalcId}?${query.toString()}`);
          const cutoff = startOfUtcDay(new Date());
          cutoff.setUTCDate(cutoff.getUTCDate() - 29);
          return (history.historicalValues ?? []).flatMap((point) => {
            if (typeof point.date !== "string" || typeof point.value !== "number") return [];
            const [month = 0, day = 0, year = 0] = point.date.split("/").map(Number);
            const date = new Date(Date.UTC(year, month - 1, day));
            if (!year || !month || !day || Number.isNaN(date.getTime()) || date < cutoff) return [];
            const snapshotDate = date.toISOString().slice(0, 10);
            return [{
              id: `${snapshotDate}:${formatKey}:${playerId}`,
              snapshotDate,
              formatKey,
              playerId,
              playerName: row.player?.name ?? playerId,
              position: row.player?.position ?? "",
              value: Math.round(point.value),
              capturedAt: date,
            }];
          });
        }));
        const backfillRows = historyResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
        for (let index = 0; index < backfillRows.length; index += 250) {
          const chunk = backfillRows.slice(index, index + 250);
          if (chunk.length) await db.insert(schema.playerValueSnapshots).values(chunk).onConflictDoNothing();
        }
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
