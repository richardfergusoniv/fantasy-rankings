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

/** Sensible default when a league format cannot be mapped to a snapshot preset. */
export const DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY = "redraft-1qb-12t-0.5ppr";

/**
 * Inclusive lower bound for chart/API reads of `player_value_snapshots`.
 * Daily cron + backfill store history; the Monitor Value chart reads from here.
 */
export const VALUE_HISTORY_CHART_MIN_DATE = "2026-01-01";

const snapshotFormatKeyPattern = /^(dynasty|redraft)-(\d+)qb-(\d+)t-([\d.]+)ppr$/;

type SnapshotFormatIdentity = {
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
};

function parseSnapshotFormatKey(formatKey: string): SnapshotFormatIdentity | null {
  const match = snapshotFormatKeyPattern.exec(formatKey);
  if (!match) return null;
  const numQbs = Number(match[2]);
  const numTeams = Number(match[3]);
  const ppr = Number(match[4]);
  if (!Number.isFinite(numQbs) || !Number.isFinite(numTeams) || !Number.isFinite(ppr)) return null;
  return {
    isDynasty: match[1] === "dynasty",
    numQbs,
    numTeams,
    ppr,
  };
}

/**
 * Map a league's season-long format key onto a FantasyCalc preset that has
 * rows in `player_value_snapshots`. Exact preset keys pass through; otherwise
 * pick the nearest preset (same dynasty flag, prefer matching QB count, then
 * closest team count and PPR). Falls back to the default half-PPR 12-team
 * redraft preset.
 */
export function resolveFantasyCalcSnapshotFormatKey(formatKey: string): string {
  const presets = FANTASY_CALC_SNAPSHOT_PRESETS.map((preset) => preset.format);
  if (presets.some((preset) => preset.key === formatKey)) return formatKey;

  const target = parseSnapshotFormatKey(formatKey);
  if (!target) return DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY;

  const scored = presets
    .filter((preset) => preset.isDynasty === target.isDynasty)
    .map((preset) => ({
      key: preset.key,
      qbMismatch: preset.numQbs === target.numQbs ? 0 : 1,
      teamDistance: Math.abs(preset.numTeams - target.numTeams),
      pprDistance: Math.abs(preset.ppr - target.ppr),
    }))
    .sort((left, right) => (
      left.qbMismatch - right.qbMismatch
      || left.teamDistance - right.teamDistance
      || left.pprDistance - right.pprDistance
      || left.key.localeCompare(right.key)
    ));

  return scored[0]?.key ?? DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY;
}

/**
 * Rows per INSERT. 1000 × 8 columns = 8000 bind params, well under Postgres's
 * 65,535 limit. Backfill batches of ~20 players × ~285 days need several chunks.
 */
export const VALUE_HISTORY_UPSERT_CHUNK = 1000;
/** Default players×format work items per backfill invocation (fits Hobby 60s). */
export const VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT = 20;
export const VALUE_HISTORY_BACKFILL_MAX_LIMIT = 40;
/**
 * FantasyCalc `/trades/implied/{id}` scrambles dates / 500s under concurrency.
 * Backfill must stay sequential with a short gap between requests.
 */
export const VALUE_HISTORY_BACKFILL_CONCURRENCY = 1;
export const VALUE_HISTORY_BACKFILL_REQUEST_DELAY_MS = 150;
/** Attempts for 5xx / network / whole-response validation failures. */
export const VALUE_HISTORY_FETCH_MAX_ATTEMPTS = 3;
/** Backoff before attempt 2 / 3 / 4 (ms). Indexed by attempt-1. */
export const VALUE_HISTORY_FETCH_BACKOFF_MS = [500, 1000, 2000] as const;
/**
 * Inclusive lower bound for snapshot_date / captured_at.
 * FantasyCalc occasionally returns absurd years (e.g. 12600) that serialize as
 * `+012600-…` ISO strings; Postgres then rejects them as SQLSTATE 22009.
 */
export const VALUE_HISTORY_MIN_SNAPSHOT_DATE = "2015-01-01";
const DAY_MS = 86_400_000;

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

export type PlayerValueSnapshotBuildResult = {
  rows: PlayerValueSnapshotRow[];
  /** Points/rows dropped for invalid or out-of-range dates (or failed compact). */
  skipped: number;
};

export function startOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/**
 * Format YYYY-MM-DD without Date#toISOString — extended years produce
 * `+012600-…` which `.slice(0, 10)` corrupts and Postgres misreads as a TZ.
 */
export function utcDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

/**
 * YYYY-MM-DD for the America/Los_Angeles calendar day of `date`.
 * Daily cron appends use this so late-evening PT runs are not dated "tomorrow"
 * via UTC (`getUTC*` / `toISOString`).
 */
export function pacificDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

/**
 * Accept finite instants on/after 2015-01-01 UTC and at most 1 day ahead of `now`.
 * Rejects NaN dates and absurd far-future years from FantasyCalc history.
 */
export function isAcceptableValueHistoryInstant(date: Date, now: Date = new Date()): boolean {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const year = date.getUTCFullYear();
  // Keep years in the normal 4-digit ISO range so timestamptz never sees +YYYYYY.
  if (year < 2015 || year > 9999) return false;
  if (utcDateKey(date) < VALUE_HISTORY_MIN_SNAPSHOT_DATE) return false;
  if (date.getTime() > now.getTime() + DAY_MS) return false;
  return true;
}

/** True when snapshot_date is a real YYYY-MM-DD inside the accepted window. */
export function isAcceptableSnapshotDateKey(snapshotDate: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return false;
  const date = new Date(`${snapshotDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || utcDateKey(date) !== snapshotDate) return false;
  return isAcceptableValueHistoryInstant(date, now);
}

/**
 * FantasyCalc history dates are `M/D/YYYY` (US, 4-digit year).
 * Rejects malformed strings and dates outside the accepted history window.
 */
export function parseFantasyCalcHistoryDate(value: string, now: Date = new Date()): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  if (!isAcceptableValueHistoryInstant(date, now)) return null;
  return date;
}

export type FantasyCalcHistoryPoint = { date?: string; value?: unknown };

/**
 * Whole-response check for FantasyCalc history payloads.
 * Every point must parse inside the accepted window, and dates must be
 * strictly increasing consecutive UTC days with no gaps or repeats.
 * A single scrambled / absurd date invalidates the entire response.
 */
export function isValidFantasyCalcHistorySequence(
  points: FantasyCalcHistoryPoint[],
  now: Date = new Date(),
): boolean {
  if (!Array.isArray(points)) return false;
  let prevTime: number | null = null;
  for (const point of points) {
    if (typeof point.date !== "string") return false;
    const date = parseFantasyCalcHistoryDate(point.date, now);
    if (!date) return false;
    const time = date.getTime();
    if (prevTime != null && time !== prevTime + DAY_MS) return false;
    prevTime = time;
  }
  return true;
}

/** True for HTTP 5xx from `fetchJson` and network / abort failures (not 4xx). */
export function isRetryableHistoryFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const match = /^Source returned (\d+)$/.exec(err.message);
  if (match) {
    const status = Number(match[1]);
    return status >= 500 && status <= 599;
  }
  return true;
}

export class CorruptFantasyCalcHistoryError extends Error {
  constructor(message = "FantasyCalc history response failed validation") {
    super(message);
    this.name = "CorruptFantasyCalcHistoryError";
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch FantasyCalc history and require a valid consecutive-day sequence.
 * Retries 5xx / network / corrupt bodies up to `VALUE_HISTORY_FETCH_MAX_ATTEMPTS`
 * with backoff (~0.5s, 1s, 2s). Inject `sleepFn` / `fetchFn` in unit tests.
 */
export async function fetchValidatedFantasyCalcHistory(
  url: string,
  options: {
    now?: Date;
    maxAttempts?: number;
    backoffMs?: readonly number[];
    sleepFn?: (ms: number) => Promise<void>;
    fetchFn?: <T>(url: string) => Promise<T>;
  } = {},
): Promise<FantasyCalcHistoryResponse> {
  const now = options.now ?? new Date();
  const maxAttempts = Math.max(1, options.maxAttempts ?? VALUE_HISTORY_FETCH_MAX_ATTEMPTS);
  const backoffMs = options.backoffMs ?? VALUE_HISTORY_FETCH_BACKOFF_MS;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const fetchFn = options.fetchFn ?? fetchJson;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 2000;
      await sleepFn(delay);
    }
    try {
      const history = await fetchFn<FantasyCalcHistoryResponse>(url);
      const points = history.historicalValues ?? [];
      if (!isValidFantasyCalcHistorySequence(points, now)) {
        throw new CorruptFantasyCalcHistoryError(
          `FantasyCalc history response failed validation (points=${points.length})`,
        );
      }
      return history;
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof CorruptFantasyCalcHistoryError || isRetryableHistoryFetchError(err);
      if (!retryable || attempt >= maxAttempts - 1) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("FantasyCalc history fetch failed");
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

/**
 * True when `formatKey` is a dynasty FantasyCalc preset/league key.
 * Draft-pick market rows (`position === "PICK"`, sleeper ids like `FP_2027_mid_0`)
 * are only stored for dynasty formats.
 */
export function isDynastyFormatKey(formatKey: string): boolean {
  return formatKey.startsWith("dynasty");
}

export function compactPlayerValueSnapshot(input: {
  snapshotDate: string;
  formatKey: string;
  playerId: string;
  playerName?: string | null;
  position?: string | null;
  value: unknown;
  capturedAt: Date;
  now?: Date;
}): PlayerValueSnapshotRow | null {
  const now = input.now ?? new Date();
  const playerId = asTrimmedString(input.playerId);
  if (!playerId) return null;
  const position = asTrimmedString(input.position);
  // Picks are dynasty-only market assets (stable FantasyCalc `FP_*` sleeper ids).
  if (position === "PICK" && (!isDynastyFormatKey(input.formatKey) || !playerId.startsWith("FP_"))) {
    return null;
  }
  if (!isAcceptableSnapshotDateKey(input.snapshotDate, now)) return null;
  const rawValue = coerceFiniteNumber(input.value);
  if (rawValue == null) return null;
  const value = Math.round(rawValue);
  // FantasyCalc redraft history is often 0 before market open; never store ≤0.
  if (!Number.isFinite(value) || value <= 0) return null;
  const capturedAt =
    input.capturedAt instanceof Date && !Number.isNaN(input.capturedAt.getTime())
      ? input.capturedAt
      : new Date(`${input.snapshotDate}T00:00:00.000Z`);
  if (!isAcceptableValueHistoryInstant(capturedAt, now)) return null;
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

/**
 * Dynasty draft-pick rows from a FantasyCalc current-values payload.
 * Uses FantasyCalc's stable `FP_*` sleeper ids (same ids season-long rankings use).
 */
export function rankedPicksFromFantasyCalcRows(rows: FantasyCalcRow[]): RankedFantasyCalcPlayer[] {
  const seen = new Set<string>();
  const ranked: RankedFantasyCalcPlayer[] = [];
  for (const row of rows) {
    const playerId = asTrimmedString(row.player?.sleeperId);
    const fantasyCalcId = row.player?.id;
    const position = asTrimmedString(row.player?.position);
    if (!playerId.startsWith("FP_") || typeof fantasyCalcId !== "number" || position !== "PICK") continue;
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    ranked.push({
      fantasyCalcId,
      playerId,
      playerName: asTrimmedString(row.player?.name),
      position: "PICK",
    });
  }
  return ranked;
}

export function dailySnapshotRowsFromPreset(
  formatKey: string,
  rows: FantasyCalcRow[],
  asOf: Date,
  now: Date = asOf,
): PlayerValueSnapshotBuildResult {
  const out: PlayerValueSnapshotRow[] = [];
  // Date-window rejection only — missing id / non-finite / ≤0 / non-dynasty PICK
  // are dropped by compact without counting as "skipped".
  const snapshotDate = pacificDateKey(asOf);
  if (!isAcceptableValueHistoryInstant(asOf, now) || !isAcceptableSnapshotDateKey(snapshotDate, now)) {
    return { rows: out, skipped: rows.length };
  }
  for (const row of rows) {
    const compact = compactPlayerValueSnapshot({
      snapshotDate,
      formatKey,
      playerId: row.player?.sleeperId ?? "",
      playerName: row.player?.name ?? "",
      position: row.player?.position ?? "",
      value: row.value,
      capturedAt: asOf,
      now,
    });
    if (compact) out.push(compact);
  }
  return { rows: out, skipped: 0 };
}

export function historySnapshotRowsFromPoints(input: {
  formatKey: string;
  playerId: string;
  playerName: string;
  position: string;
  points: Array<{ date?: string; value?: unknown }>;
  /** Inclusive lower bound on snapshot_date (YYYY-MM-DD), or null for all history. */
  minSnapshotDate?: string | null;
  now?: Date;
}): PlayerValueSnapshotBuildResult {
  const now = input.now ?? new Date();
  const out: PlayerValueSnapshotRow[] = [];
  let skipped = 0;
  for (const point of input.points) {
    if (typeof point.date !== "string") {
      skipped += 1;
      continue;
    }
    const date = parseFantasyCalcHistoryDate(point.date, now);
    if (!date) {
      // Invalid calendar / absurd year / before 2015 / >1 day ahead.
      skipped += 1;
      continue;
    }
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
      now,
    });
    if (compact) out.push(compact);
  }
  return { rows: out, skipped };
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
 * Idempotent for the same America/Los_Angeles calendar date via PK upsert.
 */
export async function appendDailyValueSnapshots(
  presets: Record<string, FantasyCalcRow[]>,
  asOf: Date = new Date(),
): Promise<{ formats: number; rows: number; skipped: number }> {
  let skipped = 0;
  const rows: PlayerValueSnapshotRow[] = [];
  for (const [formatKey, presetRows] of Object.entries(presets)) {
    const built = dailySnapshotRowsFromPreset(formatKey, presetRows, asOf, asOf);
    rows.push(...built.rows);
    skipped += built.skipped;
    if (built.skipped > 0) {
      console.info(
        `[player-value-history] daily append skipped=${built.skipped} format=${formatKey} (invalid or out-of-range dates)`,
      );
    }
  }
  const written = await upsertPlayerValueSnapshots(rows);
  return { formats: Object.keys(presets).length, rows: written, skipped };
}

function clampBackfillLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT;
  return Math.max(1, Math.min(VALUE_HISTORY_BACKFILL_MAX_LIMIT, Math.floor(raw)));
}

export type ValueHistoryBackfillFailedItem = {
  formatKey: string;
  playerId: string;
};

export type ValueHistoryBackfillResultBase = {
  offset: number;
  limit: number;
  nextOffset: number;
  processed: number;
  failed: number;
  failedItems: ValueHistoryBackfillFailedItem[];
  upserted: number;
  skipped: number;
  totalWorkItems: number;
  batchCount: number;
  done: boolean;
};

export type ValueHistoryBackfillResult = ValueHistoryBackfillResultBase & {
  job: "backfill-value-history";
};

export type PickValueHistoryBackfillResult = ValueHistoryBackfillResultBase & {
  job: "backfill-pick-value-history";
};

async function runValueHistoryBackfillBatch<Job extends string>(options: {
  job: Job;
  offset?: number;
  limit?: number;
  presets: Array<{ format: SeasonLongFormat; url: string }>;
  rankRows: (rows: FantasyCalcRow[]) => RankedFantasyCalcPlayer[];
  /** Inclusive lower bound on snapshot_date, or null for full FantasyCalc history. */
  minSnapshotDate: string | null;
}): Promise<ValueHistoryBackfillResultBase & { job: Job }> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = clampBackfillLimit(options.limit);
  let skip = offset;
  let remaining = limit;
  let totalWorkItems = 0;
  let processed = 0;
  let failed = 0;
  let upserted = 0;
  let skipped = 0;
  const failedItems: ValueHistoryBackfillFailedItem[] = [];
  const work: Array<{
    format: SeasonLongFormat;
    player: RankedFantasyCalcPlayer;
  }> = [];

  for (const preset of options.presets) {
    const currentRows = await fetchJson<FantasyCalcRow[]>(preset.url);
    const ranked = options.rankRows(currentRows);
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

  // Per work item: validated fetch → sanitize → upsert. One bad player/history
  // must not 500 the whole cron or write a scrambled date sequence.
  const historyResults = await mapPool(
    work,
    VALUE_HISTORY_BACKFILL_CONCURRENCY,
    async ({ format, player }, index) => {
      if (index > 0 && VALUE_HISTORY_BACKFILL_REQUEST_DELAY_MS > 0) {
        await defaultSleep(VALUE_HISTORY_BACKFILL_REQUEST_DELAY_MS);
      }
      const history = await fetchValidatedFantasyCalcHistory(
        fantasyCalcHistoryUrl(format, player.fantasyCalcId),
      );
      const built = historySnapshotRowsFromPoints({
        formatKey: format.key,
        playerId: player.playerId,
        playerName: player.playerName,
        position: player.position,
        points: history.historicalValues ?? [],
        minSnapshotDate: options.minSnapshotDate,
      });
      if (built.skipped > 0) {
        console.info(
          `[player-value-history] backfill skipped=${built.skipped} format=${format.key} player=${player.playerId} (non-finite values after validation)`,
        );
      }
      const written = await upsertPlayerValueSnapshots(built.rows);
      return { upserted: written, skipped: built.skipped };
    },
  );

  for (const [index, result] of historyResults.entries()) {
    if (result.status === "fulfilled") {
      processed += 1;
      upserted += result.value.upserted;
      skipped += result.value.skipped;
      continue;
    }
    failed += 1;
    const item = work[index];
    const formatKey = item?.format.key ?? "?";
    const playerId = item?.player.playerId ?? "?";
    failedItems.push({ formatKey, playerId });
    const dbText = formatDbError(result.reason);
    const fetchText =
      result.reason instanceof Error && !result.reason.message.startsWith("Failed query:")
        ? result.reason.message
        : "";
    console.error(
      `[player-value-history] backfill item failed format=${formatKey} player=${playerId} ${dbText !== "unknown database error" ? dbText : fetchText || dbText}`,
    );
  }

  const nextOffset = offset + work.length;
  const done = nextOffset >= totalWorkItems;
  const batchCount = totalWorkItems === 0 ? 0 : Math.ceil(totalWorkItems / limit);

  return {
    job: options.job,
    offset,
    limit,
    nextOffset: done ? totalWorkItems : nextOffset,
    processed,
    failed,
    failedItems,
    upserted,
    skipped,
    totalWorkItems,
    batchCount,
    done,
  };
}

/**
 * One resumable backfill batch: walk FantasyCalc-ranked players across all
 * presets (PICK rows skipped), fetch full history for `limit` work items
 * starting at `offset`, and upsert compact snapshot rows.
 *
 * Fetches are sequential (`VALUE_HISTORY_BACKFILL_CONCURRENCY = 1`) with a
 * short delay between requests. Each history response must pass whole-sequence
 * validation; corrupt or 5xx responses are retried, then counted as failed
 * with nothing written for that player×format.
 *
 * Avoids reading `player_value_snapshots` — upserts alone are enough for
 * idempotency. `totalWorkItems` is discovered while walking presets so the
 * caller can compute remaining batches.
 */
export async function backfillValueHistoryBatch(options: {
  offset?: number;
  limit?: number;
}): Promise<ValueHistoryBackfillResult> {
  return runValueHistoryBackfillBatch({
    job: "backfill-value-history",
    offset: options.offset,
    limit: options.limit,
    presets: FANTASY_CALC_SNAPSHOT_PRESETS,
    rankRows: rankedPlayersFromFantasyCalcRows,
    minSnapshotDate: null,
  });
}

/**
 * One resumable dynasty draft-pick history backfill batch.
 *
 * Walks only dynasty FantasyCalc presets, ranks `position === "PICK"` rows
 * (stable `FP_*` sleeper ids), fetches implied-trade history, and upserts
 * compact rows from `VALUE_HISTORY_CHART_MIN_DATE` forward. Same pacing /
 * retry / no-full-table-read contract as `backfillValueHistoryBatch`.
 */
export async function backfillPickValueHistoryBatch(options: {
  offset?: number;
  limit?: number;
}): Promise<PickValueHistoryBackfillResult> {
  const dynastyPresets = FANTASY_CALC_SNAPSHOT_PRESETS.filter((preset) => preset.format.isDynasty);
  return runValueHistoryBackfillBatch({
    job: "backfill-pick-value-history",
    offset: options.offset,
    limit: options.limit,
    presets: dynastyPresets,
    rankRows: rankedPicksFromFantasyCalcRows,
    minSnapshotDate: VALUE_HISTORY_CHART_MIN_DATE,
  });
}
