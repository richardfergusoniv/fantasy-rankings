import { sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import {
  FANTASY_CALC_HISTORY_URL,
  FANTASY_CALC_VALUES_URL,
  fetchJson,
  type FantasyCalcHistoryResponse,
  type FantasyCalcRow,
  type SeasonLongFormat,
} from "./sleeper.js";

/**
 * FantasyCalc value-history snapshots: daily append during the
 * `refresh-fantasycalc` cron, plus a resumable one-time history backfill.
 *
 * Rows stay compact — one PK row per (date, format, player) with rounded
 * market value and the name/position needed by the chart API. Writes are
 * idempotent upserts; callers should avoid large snapshot reads.
 */

export const FANTASY_CALC_SNAPSHOT_PRESETS: Array<{ format: SeasonLongFormat; url: string }> = [
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

/**
 * Rows per INSERT. 1000 × 8 columns = 8000 bind params, well under Postgres's
 * 65,535 limit. Backfill batches of ~20 players × ~285 days need several chunks.
 */
export const VALUE_HISTORY_UPSERT_CHUNK = 1000;
/** Default players×format work items per backfill invocation (fits Hobby 60s). */
export const VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT = 20;
export const VALUE_HISTORY_BACKFILL_MAX_LIMIT = 40;

export type PlayerValueSnapshotRow = {
  id: string;
  snapshotDate: string;
  formatKey: string;
  playerId: string;
  playerName: string;
  position: string;
  value: number;
  capturedAt: Date;
};

export type RankedFantasyCalcPlayer = {
  fantasyCalcId: number;
  playerId: string;
  playerName: string;
  position: string;
};

export function startOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function utcDateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/** FantasyCalc history dates are `M/D/YYYY` (US). */
export function parseFantasyCalcHistoryDate(value: string): Date | null {
  const [month = 0, day = 0, year = 0] = value.split("/").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function playerValueSnapshotId(snapshotDate: string, formatKey: string, playerId: string): string {
  return `${snapshotDate}:${formatKey}:${playerId}`;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Coerce FantasyCalc numeric payloads (number or numeric string) to a finite number. */
export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compactPlayerValueSnapshot(input: {
  snapshotDate: string;
  formatKey: string;
  playerId: string;
  playerName?: string | null;
  position?: string | null;
  value: unknown;
  capturedAt: Date;
}): PlayerValueSnapshotRow | null {
  const playerId = asTrimmedString(input.playerId);
  if (!playerId) return null;
  const position = asTrimmedString(input.position);
  if (position === "PICK") return null;
  const rawValue = coerceFiniteNumber(input.value);
  if (rawValue == null) return null;
  const value = Math.round(rawValue);
  if (!Number.isFinite(value)) return null;
  const capturedAt =
    input.capturedAt instanceof Date && !Number.isNaN(input.capturedAt.getTime())
      ? input.capturedAt
      : new Date(`${input.snapshotDate}T00:00:00.000Z`);
  if (Number.isNaN(capturedAt.getTime())) return null;
  return {
    id: playerValueSnapshotId(input.snapshotDate, input.formatKey, playerId),
    snapshotDate: input.snapshotDate,
    formatKey: input.formatKey,
    playerId,
    // Prefer the current FantasyCalc name/position; never write SQL NULL.
    playerName: asTrimmedString(input.playerName),
    position,
    value,
    capturedAt,
  };
}

export function rankedPlayersFromFantasyCalcRows(rows: FantasyCalcRow[]): RankedFantasyCalcPlayer[] {
  const seen = new Set<string>();
  const ranked: RankedFantasyCalcPlayer[] = [];
  for (const row of rows) {
    const playerId = asTrimmedString(row.player?.sleeperId);
    const fantasyCalcId = row.player?.id;
    const position = asTrimmedString(row.player?.position);
    if (!playerId || typeof fantasyCalcId !== "number" || position === "PICK") continue;
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    ranked.push({
      fantasyCalcId,
      playerId,
      playerName: asTrimmedString(row.player?.name),
      position,
    });
  }
  return ranked;
}

export function dailySnapshotRowsFromPreset(
  formatKey: string,
  rows: FantasyCalcRow[],
  asOf: Date,
): PlayerValueSnapshotRow[] {
  const snapshotDate = utcDateKey(asOf);
  const out: PlayerValueSnapshotRow[] = [];
  for (const row of rows) {
    const compact = compactPlayerValueSnapshot({
      snapshotDate,
      formatKey,
      playerId: row.player?.sleeperId ?? "",
      playerName: row.player?.name ?? "",
      position: row.player?.position ?? "",
      value: row.value,
      capturedAt: asOf,
    });
    if (compact) out.push(compact);
  }
  return out;
}

export function historySnapshotRowsFromPoints(input: {
  formatKey: string;
  playerId: string;
  playerName: string;
  position: string;
  points: Array<{ date?: string; value?: unknown }>;
  /** Inclusive lower bound on snapshot_date (YYYY-MM-DD), or null for all history. */
  minSnapshotDate?: string | null;
}): PlayerValueSnapshotRow[] {
  const out: PlayerValueSnapshotRow[] = [];
  for (const point of input.points) {
    if (typeof point.date !== "string") continue;
    const date = parseFantasyCalcHistoryDate(point.date);
    if (!date) continue;
    const snapshotDate = utcDateKey(date);
    if (input.minSnapshotDate && snapshotDate < input.minSnapshotDate) continue;
    const compact = compactPlayerValueSnapshot({
      snapshotDate,
      formatKey: input.formatKey,
      playerId: input.playerId,
      playerName: input.playerName,
      position: input.position,
      value: point.value,
      capturedAt: date,
    });
    if (compact) out.push(compact);
  }
  return out;
}

export function fantasyCalcHistoryUrl(format: SeasonLongFormat, fantasyCalcId: number): string {
  const query = new URLSearchParams({
    isDynasty: String(format.isDynasty),
    numQbs: String(format.numQbs),
    numTeams: String(format.numTeams),
    ppr: String(format.ppr),
  });
  return `${FANTASY_CALC_HISTORY_URL}/${fantasyCalcId}?${query.toString()}`;
}

/** Last row wins for a given PK — required before INSERT … ON CONFLICT. */
export function dedupePlayerValueSnapshotsById(rows: PlayerValueSnapshotRow[]): PlayerValueSnapshotRow[] {
  const byId = new Map<string, PlayerValueSnapshotRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

export function chunkPlayerValueSnapshots(
  rows: PlayerValueSnapshotRow[],
  chunkSize: number = VALUE_HISTORY_UPSERT_CHUNK,
): PlayerValueSnapshotRow[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: PlayerValueSnapshotRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    if (chunk.length) chunks.push(chunk);
  }
  return chunks;
}

/**
 * Log-safe DB error text: only `cause.message` / `cause.code`.
 * Never include drizzle's "Failed query: <sql>" wrapper (it truncates logs).
 */
export function formatDbError(err: unknown): string {
  const cause =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause: unknown }).cause
      : undefined;
  if (!cause || typeof cause !== "object") return "unknown database error";
  const node = cause as { message?: unknown; code?: unknown };
  const code = node.code != null && String(node.code).trim() !== "" ? `code=${String(node.code)}` : "";
  const message = typeof node.message === "string" ? node.message.trim() : "";
  // Guard against a nested wrapper that still embeds SQL.
  const safeMessage = message.startsWith("Failed query:") ? "" : message;
  return [code, safeMessage].filter(Boolean).join(" | ") || "unknown database error";
}

export async function upsertPlayerValueSnapshots(rows: PlayerValueSnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  // Sanitize again at the write boundary (decimals → int, nullish names → "").
  const sanitized = rows.flatMap((row) => {
    const compact = compactPlayerValueSnapshot(row);
    return compact ? [compact] : [];
  });
  const deduped = dedupePlayerValueSnapshotsById(sanitized);
  const chunks = chunkPlayerValueSnapshots(deduped, VALUE_HISTORY_UPSERT_CHUNK);
  let written = 0;
  for (const chunk of chunks) {
    try {
      await db
        .insert(schema.playerValueSnapshots)
        .values(chunk)
        .onConflictDoUpdate({
          target: schema.playerValueSnapshots.id,
          set: {
            playerName: sql`excluded.player_name`,
            position: sql`excluded.position`,
            value: sql`excluded.value`,
            capturedAt: sql`excluded.captured_at`,
          },
        });
      written += chunk.length;
    } catch (err) {
      console.error(
        `[player-value-history] upsert failed chunkSize=${chunk.length} written=${written}: ${formatDbError(err)}`,
      );
      throw err;
    }
  }
  return written;
}

/** Small concurrency so FantasyCalc history endpoints are less likely to 500. */
const VALUE_HISTORY_BACKFILL_CONCURRENCY = 3;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      try {
        results[index] = { status: "fulfilled", value: await worker(item, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  const pool = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run());
  await Promise.all(pool);
  return results;
}

/**
 * Write today's compact market rows for every successfully fetched preset.
 * Idempotent for the same UTC date via PK upsert.
 */
export async function appendDailyValueSnapshots(
  presets: Record<string, FantasyCalcRow[]>,
  asOf: Date = new Date(),
): Promise<{ formats: number; rows: number }> {
  const rows = Object.entries(presets).flatMap(([formatKey, presetRows]) =>
    dailySnapshotRowsFromPreset(formatKey, presetRows, asOf),
  );
  const written = await upsertPlayerValueSnapshots(rows);
  return { formats: Object.keys(presets).length, rows: written };
}

function clampBackfillLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT;
  return Math.max(1, Math.min(VALUE_HISTORY_BACKFILL_MAX_LIMIT, Math.floor(raw)));
}

export type ValueHistoryBackfillResult = {
  job: "backfill-value-history";
  offset: number;
  limit: number;
  nextOffset: number;
  processed: number;
  failed: number;
  upserted: number;
  totalWorkItems: number;
  batchCount: number;
  done: boolean;
};

/**
 * One resumable backfill batch: walk FantasyCalc-ranked players across all
 * presets (PICK rows skipped), fetch full history for `limit` work items
 * starting at `offset`, and upsert compact snapshot rows.
 *
 * Avoids reading `player_value_snapshots` — upserts alone are enough for
 * idempotency. `totalWorkItems` is discovered while walking presets so the
 * caller can compute remaining batches.
 */
export async function backfillValueHistoryBatch(options: {
  offset?: number;
  limit?: number;
}): Promise<ValueHistoryBackfillResult> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = clampBackfillLimit(options.limit);
  let skip = offset;
  let remaining = limit;
  let totalWorkItems = 0;
  let processed = 0;
  let failed = 0;
  let upserted = 0;
  const work: Array<{
    format: SeasonLongFormat;
    player: RankedFantasyCalcPlayer;
  }> = [];

  for (const preset of FANTASY_CALC_SNAPSHOT_PRESETS) {
    const currentRows = await fetchJson<FantasyCalcRow[]>(preset.url);
    const ranked = rankedPlayersFromFantasyCalcRows(currentRows);
    totalWorkItems += ranked.length;
    if (remaining <= 0) continue;
    if (skip >= ranked.length) {
      skip -= ranked.length;
      continue;
    }
    const slice = ranked.slice(skip, skip + remaining);
    skip = 0;
    remaining -= slice.length;
    for (const player of slice) work.push({ format: preset.format, player });
  }

  // Per work item: fetch → sanitize → upsert. One bad player/history must not
  // 500 the whole cron invocation or poison sibling upserts.
  const historyResults = await mapPool(work, VALUE_HISTORY_BACKFILL_CONCURRENCY, async ({ format, player }) => {
    const history = await fetchJson<FantasyCalcHistoryResponse>(
      fantasyCalcHistoryUrl(format, player.fantasyCalcId),
    );
    const rows = historySnapshotRowsFromPoints({
      formatKey: format.key,
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      points: history.historicalValues ?? [],
      minSnapshotDate: null,
    });
    return upsertPlayerValueSnapshots(rows);
  });

  for (const [index, result] of historyResults.entries()) {
    if (result.status === "fulfilled") {
      processed += 1;
      upserted += result.value;
      continue;
    }
    failed += 1;
    const item = work[index];
    const dbText = formatDbError(result.reason);
    const fetchText =
      result.reason instanceof Error && !result.reason.message.startsWith("Failed query:")
        ? result.reason.message
        : "";
    console.error(
      `[player-value-history] backfill item failed format=${item?.format.key ?? "?"} player=${item?.player.playerId ?? "?"} ${dbText !== "unknown database error" ? dbText : fetchText || dbText}`,
    );
  }

  const nextOffset = offset + work.length;
  const done = nextOffset >= totalWorkItems;
  const batchCount = totalWorkItems === 0 ? 0 : Math.ceil(totalWorkItems / limit);

  return {
    job: "backfill-value-history",
    offset,
    limit,
    nextOffset: done ? totalWorkItems : nextOffset,
    processed,
    failed,
    upserted,
    totalWorkItems,
    batchCount,
    done,
  };
}
