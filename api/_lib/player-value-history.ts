import { eq, notInArray, sql } from "drizzle-orm";
import { readOwnerSleeperUserId } from "./auth.js";
import { db, schema } from "./db.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";
import {
  FANTASY_CALC_HISTORY_URL,
  FANTASY_CALC_VALUES_URL,
  fetchJson,
  seasonLongFormatForLeague,
  type FantasyCalcHistoryResponse,
  type FantasyCalcRow,
  type SeasonLongFormat,
} from "./sleeper.js";
import { readUserLeagues } from "./user-leagues.js";

/**
 * FantasyCalc value-history snapshots: daily append during the
 * `refresh-fantasycalc` cron, plus a resumable history backfill.
 *
 * Kept formats are discovered dynamically from every linked Sleeper account
 * in `sleeper_connections` (plus OWNER_SLEEPER_USER_ID when set) — not a
 * hardcoded list. Rankings may still fetch a broader FantasyCalc preset set
 * for synthesis; snapshot append / prune / backfill use the discovered set.
 */

/** Sensible default when a league format cannot be mapped to a snapshot format. */
export const DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY = "redraft-1qb-12t-0.5ppr";

/** source_cache key for the last discovered kept format set (plain JSON). */
export const VALUE_HISTORY_KEPT_FORMATS_CACHE_KEY = "value-history:kept-formats";
/** Per-format backfill offsets so newly seen formats auto-resume. */
export const VALUE_HISTORY_BACKFILL_STATE_CACHE_KEY = "value-history:format-backfill";

/** Snapshot calendar dates follow FantasyCalc's Pacific publish day. */
export const VALUE_HISTORY_TIME_ZONE = "America/Los_Angeles";

/**
 * Keep consecutive daily points for this many Pacific calendar days (inclusive
 * of today). Older history is downsampled to one point per ISO week.
 */
export const VALUE_HISTORY_DAILY_RETENTION_DAYS = 90;

/**
 * Inclusive lower bound for chart/API reads of `player_value_snapshots`.
 * Daily cron + backfill store history; the Monitor Value chart reads from here.
 */
export const VALUE_HISTORY_CHART_MIN_DATE = "2026-01-01";

export type FantasyCalcSnapshotPreset = {
  format: SeasonLongFormat;
  url: string;
};

const snapshotFormatKeyPattern = /^(dynasty|redraft)-(\d+)qb-(\d+)t-([\d.]+)ppr$/;

type SnapshotFormatIdentity = {
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
};

export function parseSnapshotFormatKey(formatKey: string): SnapshotFormatIdentity | null {
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

export function defaultSnapshotFormat(): SeasonLongFormat {
  return {
    key: DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY,
    isDynasty: false,
    numQbs: 1,
    numTeams: 12,
    ppr: 0.5,
    label: "Redraft · 12-team · 1QB · Half PPR",
  };
}

export function seasonLongFormatFromKey(formatKey: string): SeasonLongFormat | null {
  const parsed = parseSnapshotFormatKey(formatKey);
  if (!parsed) return null;
  const scoring = parsed.ppr === 1 ? "PPR" : parsed.ppr === 0.5 ? "Half PPR" : "Standard";
  return {
    key: formatKey,
    isDynasty: parsed.isDynasty,
    numQbs: parsed.numQbs,
    numTeams: parsed.numTeams,
    ppr: parsed.ppr,
    label: `${parsed.isDynasty ? "Dynasty" : "Redraft"} · ${parsed.numTeams}-team · ${parsed.numQbs === 2 ? "Superflex / 2QB" : "1QB"} · ${scoring}`,
  };
}

export function fantasyCalcValuesUrl(
  format: Pick<SeasonLongFormat, "isDynasty" | "numQbs" | "numTeams" | "ppr">,
): string {
  const query = new URLSearchParams({
    isDynasty: String(format.isDynasty),
    numQbs: String(format.numQbs),
    numTeams: String(format.numTeams),
    ppr: String(format.ppr),
  });
  return `${FANTASY_CALC_VALUES_URL}?${query.toString()}`;
}

export function fantasyCalcPresetForFormat(format: SeasonLongFormat): FantasyCalcSnapshotPreset {
  return { format, url: fantasyCalcValuesUrl(format) };
}

/**
 * Map a league's season-long format key onto a snapshot format key.
 * Exact parseable keys pass through (we snapshot each linked league's exact
 * key). When `keptFormats` is provided and the key is not in that set, pick
 * the nearest kept format. Falls back to the default half-PPR 12-team redraft.
 */
export function resolveFantasyCalcSnapshotFormatKey(
  formatKey: string,
  keptFormats: readonly SeasonLongFormat[] = [],
): string {
  if (keptFormats.some((format) => format.key === formatKey)) return formatKey;

  const target = parseSnapshotFormatKey(formatKey);
  if (!target) return DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY;
  // Exact league keys are the source of truth once discovered/snapshotted.
  if (keptFormats.length === 0) return formatKey;

  const scored = keptFormats
    .filter((format) => format.isDynasty === target.isDynasty)
    .map((format) => ({
      key: format.key,
      qbMismatch: format.numQbs === target.numQbs ? 0 : 1,
      teamDistance: Math.abs(format.numTeams - target.numTeams),
      pprDistance: Math.abs(format.ppr - target.ppr),
    }))
    .sort((left, right) => (
      left.qbMismatch - right.qbMismatch
      || left.teamDistance - right.teamDistance
      || left.pprDistance - right.pprDistance
      || left.key.localeCompare(right.key)
    ));

  return scored[0]?.key ?? formatKey;
}

/** Every linked Sleeper account, plus the scheduled owner id when set. */
export async function listSnapshotSleeperUserIds(): Promise<string[]> {
  const rows = await db
    .select({ sleeperUserId: schema.sleeperConnections.sleeperUserId })
    .from(schema.sleeperConnections);
  const ids = new Set(rows.map((row) => row.sleeperUserId).filter(Boolean));
  const ownerId = readOwnerSleeperUserId();
  if (ownerId) ids.add(ownerId);
  return [...ids].sort();
}

/**
 * Unique FantasyCalc snapshot presets used by any linked user's Sleeper
 * leagues (exact `seasonLongFormatForLeague` keys). Always includes the
 * default format so prune/append have a safe floor when nobody is linked.
 */
export async function discoverKeptSnapshotFormats(): Promise<FantasyCalcSnapshotPreset[]> {
  const byKey = new Map<string, SeasonLongFormat>();
  byKey.set(DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY, defaultSnapshotFormat());

  const sleeperUserIds = await listSnapshotSleeperUserIds();
  const leagueResults = await Promise.allSettled(
    sleeperUserIds.map((sleeperUserId) => readUserLeagues(sleeperUserId, false)),
  );
  for (const result of leagueResults) {
    if (result.status !== "fulfilled") {
      console.error(
        `[player-value-history] kept-format league fetch failed: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
      );
      continue;
    }
    for (const league of result.value.leagues) {
      const format = seasonLongFormatForLeague(league);
      byKey.set(format.key, format);
    }
  }

  return [...byKey.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((format) => fantasyCalcPresetForFormat(format));
}

export type KeptSnapshotFormatsCache = {
  formatKeys: string[];
  formats: SeasonLongFormat[];
  asOf: string;
};

export async function writeKeptSnapshotFormatsCache(
  presets: FantasyCalcSnapshotPreset[],
  asOf: Date = new Date(),
): Promise<KeptSnapshotFormatsCache> {
  const payload: KeptSnapshotFormatsCache = {
    formatKeys: presets.map((preset) => preset.format.key),
    formats: presets.map((preset) => preset.format),
    asOf: asOf.toISOString(),
  };
  const body = encodeSourceCachePayload(payload);
  const fetchedAt = asOf;
  await db
    .insert(schema.sourceCache)
    .values({
      cacheKey: VALUE_HISTORY_KEPT_FORMATS_CACHE_KEY,
      payload: body,
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: body, fetchedAt },
    });
  return payload;
}

export async function readCachedKeptSnapshotFormats(): Promise<FantasyCalcSnapshotPreset[]> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, VALUE_HISTORY_KEPT_FORMATS_CACHE_KEY))
    .limit(1);
  const row = rows[0];
  if (!row) return [];
  try {
    const payload = decodeSourceCachePayload(row.payload) as Partial<KeptSnapshotFormatsCache>;
    const formats = Array.isArray(payload.formats) ? payload.formats : [];
    return formats
      .filter((format): format is SeasonLongFormat => (
        Boolean(format)
        && typeof format === "object"
        && typeof format.key === "string"
        && typeof format.isDynasty === "boolean"
        && typeof format.numQbs === "number"
        && typeof format.numTeams === "number"
        && typeof format.ppr === "number"
      ))
      .map((format) => fantasyCalcPresetForFormat(format));
  } catch {
    return [];
  }
}

/** Prefer a fresh discovery; fall back to the last cached kept set. */
export async function loadKeptSnapshotFormats(): Promise<FantasyCalcSnapshotPreset[]> {
  try {
    return await discoverKeptSnapshotFormats();
  } catch (err) {
    console.error(
      `[player-value-history] discover kept formats failed: ${err instanceof Error ? err.message : err}`,
    );
    const cached = await readCachedKeptSnapshotFormats();
    if (cached.length > 0) return cached;
    return [fantasyCalcPresetForFormat(defaultSnapshotFormat())];
  }
}

type FormatBackfillStateFile = {
  formats: Record<string, { nextOffset: number; done: boolean }>;
};

async function readFormatBackfillState(): Promise<FormatBackfillStateFile> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, VALUE_HISTORY_BACKFILL_STATE_CACHE_KEY))
    .limit(1);
  const row = rows[0];
  if (!row) return { formats: {} };
  try {
    const payload = decodeSourceCachePayload(row.payload) as Partial<FormatBackfillStateFile>;
    if (!payload.formats || typeof payload.formats !== "object") return { formats: {} };
    return { formats: payload.formats };
  } catch {
    return { formats: {} };
  }
}

async function writeFormatBackfillState(state: FormatBackfillStateFile): Promise<void> {
  const body = encodeSourceCachePayload(state);
  const fetchedAt = new Date();
  await db
    .insert(schema.sourceCache)
    .values({
      cacheKey: VALUE_HISTORY_BACKFILL_STATE_CACHE_KEY,
      payload: body,
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: body, fetchedAt },
    });
}

/**
 * Ensure every kept format has a backfill cursor. Newly seen formats start at
 * offset 0 / not done so the next refresh batch backfills them automatically.
 */
export async function syncFormatBackfillState(
  kept: FantasyCalcSnapshotPreset[],
): Promise<{ state: FormatBackfillStateFile; newFormatKeys: string[] }> {
  const state = await readFormatBackfillState();
  const keptKeys = new Set(kept.map((preset) => preset.format.key));
  const newFormatKeys: string[] = [];
  for (const preset of kept) {
    if (!state.formats[preset.format.key]) {
      state.formats[preset.format.key] = { nextOffset: 0, done: false };
      newFormatKeys.push(preset.format.key);
    }
  }
  // Drop cursors for formats no longer kept (pruned from the live set).
  for (const key of Object.keys(state.formats)) {
    if (!keptKeys.has(key)) delete state.formats[key];
  }
  await writeFormatBackfillState(state);
  return { state, newFormatKeys };
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
 * Calendar YYYY-MM-DD in `timeZone` (default America/Los_Angeles).
 * Daily FantasyCalc snapshots must use Pacific date, not UTC — evening PT
 * writes would otherwise land on the next UTC day ("tomorrow").
 */
export function zonedDateKey(
  date: Date,
  timeZone: string = VALUE_HISTORY_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Failed to format zoned date for timeZone=${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

/** Add `days` to a YYYY-MM-DD calendar date key (timezone-agnostic arithmetic). */
export function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
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

/**
 * True when snapshot_date is a real YYYY-MM-DD on/after the min date and not
 * after today's Pacific calendar date (rejects UTC-"tomorrow" rows).
 */
export function isAcceptableSnapshotDateKey(snapshotDate: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return false;
  const date = new Date(`${snapshotDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || utcDateKey(date) !== snapshotDate) return false;
  if (snapshotDate < VALUE_HISTORY_MIN_SNAPSHOT_DATE) return false;
  if (snapshotDate > zonedDateKey(now)) return false;
  return true;
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

/**
 * True when FantasyCalc has no history for this player×format (absent from
 * that market). Callers should skip these — not count them as hard failures.
 */
export function isAbsentPlayerHistoryError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const match = /^Source returned (\d+)$/.exec(err.message);
  if (!match) return false;
  const status = Number(match[1]);
  return status === 404 || status === 204;
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
  if (position === "PICK") return null;
  if (!isAcceptableSnapshotDateKey(input.snapshotDate, now)) return null;
  const rawValue = coerceFiniteNumber(input.value);
  if (rawValue == null) return null;
  const value = Math.round(rawValue);
  if (!Number.isFinite(value)) return null;
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

export function dailySnapshotRowsFromPreset(
  formatKey: string,
  rows: FantasyCalcRow[],
  asOf: Date,
  now: Date = asOf,
): PlayerValueSnapshotBuildResult {
  const out: PlayerValueSnapshotRow[] = [];
  // Pacific calendar day — not UTC — so evening PT refreshes do not write "tomorrow".
  const snapshotDate = zonedDateKey(asOf);
  // Date-window rejection only — PICK / missing id / non-finite value are not "skipped".
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
 * Write today's compact market rows for every kept format present in
 * `presets`. Idempotent for the same Pacific date via PK upsert. Keys outside
 * `keptFormatKeys` are ignored so rankings can still cache a broader set.
 */
export async function appendDailyValueSnapshots(
  presets: Record<string, FantasyCalcRow[]>,
  asOf: Date = new Date(),
  keptFormatKeys?: ReadonlySet<string> | readonly string[],
): Promise<{ formats: number; rows: number; skipped: number }> {
  const kept = keptFormatKeys
    ? (keptFormatKeys instanceof Set ? keptFormatKeys : new Set(keptFormatKeys))
    : null;
  let skipped = 0;
  let formats = 0;
  const rows: PlayerValueSnapshotRow[] = [];
  for (const [formatKey, presetRows] of Object.entries(presets)) {
    if (kept && !kept.has(formatKey)) continue;
    formats += 1;
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
  return { formats, rows: written, skipped };
}

export type PrunePlayerValueSnapshotsResult = {
  deletedFuture: number;
  deletedUnusedFormats: number;
  deletedDownsampled: number;
  deleted: number;
  today: string;
  dailyCutoff: string;
};

/**
 * Bound `player_value_snapshots` growth:
 * - drop rows dated after Pacific "today"
 * - drop formats outside the dynamic kept set (never deletes a kept key)
 * - keep daily points newer than `VALUE_HISTORY_DAILY_RETENTION_DAYS`
 * - older points: one row per (format, player, ISO week) — last day kept
 */
export async function prunePlayerValueSnapshots(
  asOf: Date = new Date(),
  keptFormatKeys?: readonly string[],
): Promise<PrunePlayerValueSnapshotsResult> {
  const today = zonedDateKey(asOf);
  const dailyCutoff = addDateKeyDays(today, -VALUE_HISTORY_DAILY_RETENTION_DAYS);

  let keptKeys = keptFormatKeys ? [...keptFormatKeys] : [];
  if (keptKeys.length === 0) {
    const cached = await readCachedKeptSnapshotFormats();
    keptKeys = cached.map((preset) => preset.format.key);
  }
  if (keptKeys.length === 0) {
    keptKeys = [DEFAULT_FANTASY_CALC_SNAPSHOT_FORMAT_KEY];
  }

  const futureRows = await db.execute(sql`
    DELETE FROM player_value_snapshots
    WHERE snapshot_date > ${today}
    RETURNING 1
  `);
  const deletedFuture = Array.isArray(futureRows) ? futureRows.length : 0;

  const unused = await db
    .delete(schema.playerValueSnapshots)
    .where(notInArray(schema.playerValueSnapshots.formatKey, keptKeys))
    .returning({ id: schema.playerValueSnapshots.id });
  const deletedUnusedFormats = unused.length;

  const downsampledRows = await db.execute(sql`
    DELETE FROM player_value_snapshots AS p
    WHERE p.snapshot_date <= ${dailyCutoff}
      AND NOT EXISTS (
        SELECT 1
        FROM (
          SELECT DISTINCT ON (format_key, player_id, date_trunc('week', snapshot_date::date))
            id
          FROM player_value_snapshots
          WHERE snapshot_date <= ${dailyCutoff}
          ORDER BY
            format_key,
            player_id,
            date_trunc('week', snapshot_date::date),
            snapshot_date DESC
        ) AS keep_weekly
        WHERE keep_weekly.id = p.id
      )
    RETURNING 1
  `);
  const deletedDownsampled = Array.isArray(downsampledRows) ? downsampledRows.length : 0;
  const deleted = deletedFuture + deletedUnusedFormats + deletedDownsampled;

  if (deleted > 0) {
    console.info(
      `[player-value-history] prune deleted=${deleted} future=${deletedFuture} unusedFormats=${deletedUnusedFormats} downsampled=${deletedDownsampled} today=${today} dailyCutoff=${dailyCutoff}`,
    );
  }

  return {
    deletedFuture,
    deletedUnusedFormats,
    deletedDownsampled,
    deleted,
    today,
    dailyCutoff,
  };
}

function clampBackfillLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return VALUE_HISTORY_BACKFILL_DEFAULT_LIMIT;
  return Math.max(1, Math.min(VALUE_HISTORY_BACKFILL_MAX_LIMIT, Math.floor(raw)));
}

export type ValueHistoryBackfillFailedItem = {
  formatKey: string;
  playerId: string;
};

export type ValueHistoryBackfillResult = {
  job: "backfill-value-history";
  offset: number;
  limit: number;
  nextOffset: number;
  processed: number;
  failed: number;
  failedItems: ValueHistoryBackfillFailedItem[];
  /** Players FantasyCalc returned 404/204 for — absent from that format's market. */
  skippedAbsent: number;
  upserted: number;
  skipped: number;
  totalWorkItems: number;
  batchCount: number;
  done: boolean;
};

/**
 * One resumable backfill batch: walk FantasyCalc-ranked players across kept
 * formats (PICK rows skipped), fetch full history for `limit` work items
 * starting at `offset`, and upsert compact snapshot rows.
 *
 * `presets` defaults to the dynamically discovered kept set (every linked
 * user's leagues). Fetches are sequential with retries; 404/204 count as
 * skippedAbsent rather than failed.
 */
export async function backfillValueHistoryBatch(options: {
  offset?: number;
  limit?: number;
  presets?: FantasyCalcSnapshotPreset[];
}): Promise<ValueHistoryBackfillResult> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = clampBackfillLimit(options.limit);
  const presets = options.presets ?? await loadKeptSnapshotFormats();
  let skip = offset;
  let remaining = limit;
  let totalWorkItems = 0;
  let processed = 0;
  let failed = 0;
  let skippedAbsent = 0;
  let upserted = 0;
  let skipped = 0;
  const failedItems: ValueHistoryBackfillFailedItem[] = [];
  const work: Array<{
    format: SeasonLongFormat;
    player: RankedFantasyCalcPlayer;
  }> = [];
  const keptKeys = presets.map((preset) => preset.format.key);

  for (const preset of presets) {
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
        minSnapshotDate: null,
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
    const item = work[index];
    const formatKey = item?.format.key ?? "?";
    const playerId = item?.player.playerId ?? "?";
    if (isAbsentPlayerHistoryError(result.reason)) {
      // Player listed transiently / no implied-trade history for this format.
      skippedAbsent += 1;
      console.info(
        `[player-value-history] backfill skipped absent format=${formatKey} player=${playerId}`,
      );
      continue;
    }
    failed += 1;
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
  // Full-history upserts can restore >90d daily rows; prune after any write so
  // retention holds even when backfill runs without a separate refresh.
  if (upserted > 0) await prunePlayerValueSnapshots(new Date(), keptKeys);
  const done = nextOffset >= totalWorkItems;
  const batchCount = totalWorkItems === 0 ? 0 : Math.ceil(totalWorkItems / limit);

  return {
    job: "backfill-value-history",
    offset,
    limit,
    nextOffset: done ? totalWorkItems : nextOffset,
    processed,
    failed,
    failedItems,
    skippedAbsent,
    upserted,
    skipped,
    totalWorkItems,
    batchCount,
    done,
  };
}

/**
 * Advance backfill for the first incomplete kept format (prefer newly seen).
 * Called from the FantasyCalc refresh so new friend-league formats get history
 * without a separate workflow. No-ops when every kept format is done.
 */
export type AutoBackfillResult = ValueHistoryBackfillResult & {
  formatKey: string;
  newFormatKeys: string[];
};

export async function backfillNextIncompleteKeptFormat(options: {
  kept: FantasyCalcSnapshotPreset[];
  limit?: number;
}): Promise<AutoBackfillResult | null> {
  const { state, newFormatKeys } = await syncFormatBackfillState(options.kept);
  const preferred = [
    ...options.kept.filter((preset) => newFormatKeys.includes(preset.format.key)),
    ...options.kept.filter((preset) => !newFormatKeys.includes(preset.format.key)),
  ];
  const target = preferred.find((preset) => state.formats[preset.format.key]?.done !== true);
  if (!target) return null;

  const cursor = state.formats[target.format.key] ?? { nextOffset: 0, done: false };
  const result = await backfillValueHistoryBatch({
    offset: cursor.nextOffset,
    limit: options.limit,
    presets: [target],
  });
  state.formats[target.format.key] = {
    nextOffset: result.nextOffset,
    done: result.done,
  };
  await writeFormatBackfillState(state);
  return { ...result, formatKey: target.format.key, newFormatKeys };
}
