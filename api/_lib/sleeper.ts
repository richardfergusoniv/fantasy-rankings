import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";

/**
 * Shared Sleeper API helpers and fantasy-stat scoring functions.
 *
 * Extracted verbatim from `app/server/src/actions.ts` (read-only copies;
 * `app/` sources are not modified). Used by the draft-center, boom/bust,
 * box-score, and player-news cron routes.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLEEPER_BASE = "https://api.sleeper.app/v1";
export const SLEEPER_PROJECTIONS_BASE = "https://api.sleeper.com";
export const SOURCE_TIMEOUT_MS = 15_000;
// Hobby plan caps a function at 60s. Finish timed work early enough to
// return a partial result or a clear error before the platform kills it.
export const REFRESH_TIMEOUT_MS = 45_000;

export const DRAFT_MARKET_CACHE_KEY = "draft-market-signals-v1";
export const DRAFT_MARKET_CACHE_MS = 24 * 60 * 60 * 1000;
export const FFC_BASE_URL = "https://fantasyfootballcalculator.com/api/v1/adp";

export const FANTASY_CALC_VALUES_URL = "https://api.fantasycalc.com/values/current";
export const FANTASY_CALC_HISTORY_URL = "https://api.fantasycalc.com/trades/implied";

export const DYNASTICAL_CUCKS_LEAGUE_ID = "1306489414548979712";

export const PLAYER_NEWS_SNAPSHOT_KEY = "player-news-injury-snapshot-v1";

export function mflAdpUrl(season: number): string {
  return `https://api.myfantasyleague.com/${season}/export?TYPE=adp&JSON=1`;
}

export function mflPlayersUrl(season: number): string {
  return `https://api.myfantasyleague.com/${season}/export?TYPE=players&JSON=1`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SleeperLeague = {
  league_id: string;
  name: string;
  season?: string;
  previous_league_id?: string | null;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: {
    type?: number;
    reserve_slots?: number;
    taxi_slots?: number;
    draft_rounds?: number;
    divisions?: number;
    playoff_teams?: number;
    playoff_week_start?: number;
    /** 0 rolling, 1 reverse standings, 2 FAAB. */
    waiver_type?: number;
    waiver_budget?: number;
  };
  total_rosters?: number;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id?: string;
  players?: string[];
  starters?: string[];
  reserve?: string[];
  taxi?: string[];
  settings?: {
    division?: number;
    wins?: number;
    losses?: number;
    ties?: number;
    /** Points for/against: whole points plus hundredths in the `_decimal` field. */
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
  };
  metadata?: { team_name?: string };
};

export type SleeperPlayer = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
  injury_status?: string | null;
  injury_notes?: string | null;
  /** Sleeper news stamp — epoch seconds/ms or ISO string when present. */
  news_updated?: string | number | null;
  status?: string | null;
  years_exp?: number | null;
  /** Sleeper search relevance rank (lower = more searched / relevant). */
  search_rank?: number | null;
};

export type SleeperDraft = {
  draft_id?: string;
  league_id?: string | null;
  season?: string;
  status?: string;
  type?: string;
  start_time?: number | null;
  last_picked?: number | null;
  settings?: { rounds?: number; teams?: number };
  draft_order?: Record<string, number>;
  slot_to_roster_id?: Record<string, number | null>;
  metadata?: { name?: string };
};

export type SleeperDraftPick = {
  pick_no?: number;
  round?: number;
  draft_slot?: number;
  roster_id?: number | null;
  picked_by?: string | number | null;
  player_id?: string;
  metadata?: { first_name?: string; last_name?: string; team?: string; position?: string; player_id?: string };
};

export type SleeperTrend = { player_id?: string; count?: number };

export type FfcPlayer = {
  name?: string;
  team?: string;
  position?: string;
  adp?: number;
  high?: number;
  low?: number;
  times_drafted?: number;
};
export type FfcResponse = { players?: FfcPlayer[] };
export type MflAdpResponse = { adp?: { player?: Array<{ id?: string; averagePick?: string | number }> } };
export type MflPlayersResponse = { players?: { player?: Array<{ id?: string; name?: string; position?: string; team?: string }> } };

export type FantasyCalcRow = {
  player?: {
    id?: number;
    sleeperId?: string | null;
    name?: string;
    position?: string;
    maybeTeam?: string | null;
  };
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number | null;
};

export type FantasyCalcHistoryResponse = {
  historicalValues?: Array<{ date?: string; value?: number }>;
};

export type SeasonLongFormat = {
  key: string;
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
  label: string;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function withDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error("Source request timed out"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  return await withDeadline((async () => {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return (await response.json()) as T;
  })(), SOURCE_TIMEOUT_MS, () => controller.abort());
}

/**
 * Whether a failed source fetch is worth retrying: rate limits (429) and
 * server errors (5xx) are transient, and anything that is not an HTTP status
 * error at all (network failure, timeout abort) may clear on a second try.
 * Other 4xx responses are deterministic, so retrying them only adds latency.
 * Mirrors `isRetryableHistoryFetchError` in player-value-history.ts, plus 429.
 */
export function isRetryableSourceFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const match = /^Source returned (\d+)$/.exec(err.message);
  if (match) {
    const status = Number(match[1]);
    return status === 429 || (status >= 500 && status <= 599);
  }
  return true;
}

export const SOURCE_FETCH_RETRY_BACKOFF_MS = [400, 1_200] as const;

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetchJson` with bounded retries for transient failures (see
 * `isRetryableSourceFetchError`). Used on the dashboard build's Sleeper
 * reads, where a single blip otherwise fails the whole resync and the
 * caller silently serves the previous snapshot. Sleeper is effectively
 * always reachable, so a resync should not fail on one bad attempt.
 * Inject `sleepFn` in unit tests.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  options: {
    maxAttempts?: number;
    backoffMs?: readonly number[];
    sleepFn?: (ms: number) => Promise<void>;
    /**
     * Absolute deadline for STARTING further attempts. Callers inside a
     * bounded invocation (a dashboard build, a 60s function) pass theirs
     * so a chain of slow retries can never outlive the caller's budget:
     * once the deadline passes, the last error throws immediately and the
     * caller's fallback runs instead. An attempt already in flight keeps
     * its own per-attempt timeout.
     */
    deadlineAtMs?: number;
  } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoffMs = options.backoffMs ?? SOURCE_FETCH_RETRY_BACKOFF_MS;
  const sleepFn = options.sleepFn ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fetchJson<T>(url);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts - 1 || !isRetryableSourceFetchError(err)) throw err;
      if (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) throw err;
      await sleepFn(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0);
      // Recheck after the backoff: the sleep itself can cross the
      // deadline, and starting another full attempt past it would hand
      // the caller back its budget already spent.
      if (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) throw err;
    }
  }
  throw lastError;
}

export async function fetchText(url: string, timeoutMs = SOURCE_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  return await withDeadline((async () => {
    const response = await fetch(url, { headers: { Accept: "text/html" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.text();
  })(), timeoutMs, () => controller.abort());
}

// ---------------------------------------------------------------------------
// String / number helpers
// ---------------------------------------------------------------------------

export function parseNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePosition(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "DST") return "DEF";
  return value;
}

export function normalizedPlayerName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/jr$|sr$|ii$|iii$|iv$/g, "");
  const aliases: Record<string, string> = {
    joshpalmer: "joshuapalmer",
    joshuapalmer: "joshuapalmer",
  };
  return aliases[normalized] ?? normalized;
}

export function canonicalTeam(team: string): string {
  if (team === "JAC") return "JAX";
  if (team === "LA") return "LAR";
  if (team === "LVR") return "LV";
  if (team === "OAK") return "LV";
  if (team === "WSH") return "WAS";
  return team;
}

// Fantasy scoring lives in fantasy-scoring.ts (pure, browser-safe);
// re-exported here so existing server callers keep their import.
export { scoreProjectedPlayerStats, settingValue } from "./fantasy-scoring.js";

// ---------------------------------------------------------------------------
// Sleeper weekly stats (boom/bust)
// ---------------------------------------------------------------------------

export const BOOM_BUST_SEASONS = [2024, 2025, 2026] as const;
const SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS = 30 * 60 * 1000;
const SLEEPER_WEEKLY_STATS_ARCHIVE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

export type SleeperWeeklyStatRow = Record<string, unknown>;

export async function loadSleeperPlayerWeeklySeason(
  playerId: string,
  season: number,
  opts: { fresh?: boolean } = {},
): Promise<SleeperWeeklyStatRow[]> {
  const cacheKey = `sleeper-player-weekly-stats-v1:${playerId}:${season}`;
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  // Tuesday finalize bypasses the 30-minute cache so post-correction stats win.
  const maxAge = opts.fresh
    ? 0
    : season === 2026
      ? SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS
      : SLEEPER_WEEKLY_STATS_ARCHIVE_CACHE_MS;
  if (cached && Date.now() - cached.fetchedAt.getTime() < maxAge) {
    const parsed: unknown = decodeSourceCachePayload(cached.payload);
    return normalizeSleeperWeeklyRows(parsed);
  }
  try {
    const payload = await fetchJson<unknown>(
      `${SLEEPER_PROJECTIONS_BASE}/stats/nfl/player/${encodeURIComponent(playerId)}?season_type=regular&season=${season}&grouping=week`,
    );
    const rows = normalizeSleeperWeeklyRows(payload);
    const encoded = encodeSourceCachePayload(payload);
    await db.insert(schema.sourceCache).values({ cacheKey, payload: encoded, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: encoded, fetchedAt: new Date() } });
    return rows;
  } catch (error) {
    if (cached) {
      const parsed: unknown = decodeSourceCachePayload(cached.payload);
      return normalizeSleeperWeeklyRows(parsed);
    }
    throw error;
  }
}

/**
 * Sleeper's projection for each week of a player's season, same row shape and
 * caching as loadSleeperPlayerWeeklySeason. Past weeks' projections don't change;
 * the current week's refreshes on the same 30-minute window.
 */
export async function loadSleeperPlayerWeeklyProjections(playerId: string, season: number): Promise<SleeperWeeklyStatRow[]> {
  const cacheKey = `sleeper-player-weekly-projections-v1:${playerId}:${season}`;
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && Date.now() - cached.fetchedAt.getTime() < SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS) {
    return normalizeSleeperWeeklyRows(decodeSourceCachePayload(cached.payload));
  }
  try {
    const payload = await fetchJson<unknown>(
      `${SLEEPER_PROJECTIONS_BASE}/projections/nfl/player/${encodeURIComponent(playerId)}?season_type=regular&season=${season}&grouping=week`,
    );
    const encoded = encodeSourceCachePayload(payload);
    await db.insert(schema.sourceCache).values({ cacheKey, payload: encoded, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: encoded, fetchedAt: new Date() } });
    return normalizeSleeperWeeklyRows(payload);
  } catch (error) {
    if (cached) return normalizeSleeperWeeklyRows(decodeSourceCachePayload(cached.payload));
    throw error;
  }
}

function flattenSleeperWeeklyRow(row: SleeperWeeklyStatRow, week?: number): SleeperWeeklyStatRow {
  const nestedStats = typeof row.stats === "object" && row.stats !== null && !Array.isArray(row.stats)
    ? (row.stats as SleeperWeeklyStatRow)
    : {};
  return { ...row, ...nestedStats, week: row.week ?? week };
}

export function normalizeSleeperWeeklyRows(payload: unknown): SleeperWeeklyStatRow[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
      return [flattenSleeperWeeklyRow(value as SleeperWeeklyStatRow)];
    });
  }
  if (typeof payload !== "object" || payload === null) return [];
  return Object.entries(payload).flatMap(([weekKey, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return [flattenSleeperWeeklyRow(value as SleeperWeeklyStatRow, Number(weekKey))];
  });
}

export function sleeperActualStats(row: SleeperWeeklyStatRow): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
  }
  return stats;
}

export function sleeperGameLogStats(
  position: "QB" | "RB" | "WR" | "TE",
  row: SleeperWeeklyStatRow,
): Record<string, number> {
  const fields: Record<"QB" | "RB" | "WR" | "TE", Array<[string, string[]]>> = {
    QB: [
      ["passCmp", ["pass_cmp"]], ["passAtt", ["pass_att"]], ["passYds", ["pass_yd"]],
      ["passTd", ["pass_td"]], ["interceptions", ["pass_int"]], ["rushAtt", ["rush_att"]],
      ["rushYds", ["rush_yd"]], ["rushTd", ["rush_td"]],
    ],
    RB: [
      ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]], ["rushTd", ["rush_td"]],
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]],
    ],
    WR: [
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]], ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]],
      ["rushTd", ["rush_td"]],
    ],
    TE: [
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]], ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]],
      ["rushTd", ["rush_td"]],
    ],
  };
  const stats: Record<string, number> = {};
  for (const [outputKey, sourceKeys] of fields[position]) {
    const value = sourceKeys.map((key) => row[key]).find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
    if (typeof value === "number") stats[outputKey] = value;
  }
  return stats;
}

export function hasSleeperGameParticipation(row: SleeperWeeklyStatRow): boolean {
  if (typeof row.game_id !== "string" || row.game_id.length === 0) return false;
  const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
  if (status === "inactive" || status === "out" || status === "dnp") return false;
  const participationFields = [
    "pass_att", "rush_att", "targets", "rec", "off_snp", "snp", "snap_count", "snap_pct",
    "pass_yd", "rush_yd", "rec_yd", "pass_td", "rush_td", "rec_td", "fum", "fum_lost",
    "pr_yd", "kr_yd", "pr_td", "kr_td", "two_pt_conv", "pass_2pt", "rush_2pt", "rec_2pt",
  ];
  return participationFields.some((key) => typeof row[key] === "number" && Number(row[key]) > 0);
}

// The value is only read by `z.infer`. It is the series shape `buildBoomBustSeries` returns.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only schema
const boomBustSeriesSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  weeklyScores: z.array(z.object({ season: z.number().int(), week: z.number().int(), points: z.number() })),
  floor: z.number().nullable(),
  firstQuartile: z.number().nullable(),
  median: z.number().nullable(),
  mean: z.number().nullable(),
  thirdQuartile: z.number().nullable(),
  ceiling: z.number().nullable(),
});

export function buildBoomBustSeries(
  games: Array<{ season: number; week: number; points: number }>,
  status: "ok" | "unavailable",
): z.infer<typeof boomBustSeriesSchema> {
  const weeklyScores = games.slice().sort((a, b) => a.season - b.season || a.week - b.week);
  const values = weeklyScores.map((score) => score.points);
  return {
    status,
    weeklyScores,
    floor: values.length >= 5 ? percentile(values, 0.1) : values.length ? Math.min(...values) : null,
    firstQuartile: values.length >= 8 ? percentile(values, 0.25) : null,
    median: median(values),
    mean: mean(values),
    thirdQuartile: values.length >= 8 ? percentile(values, 0.75) : null,
    ceiling: values.length ? Math.max(...values) : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) return null;
  if (ordered.length % 2 === 1) return upper;
  const lower = ordered[middle - 1];
  return lower === undefined ? upper : Number(((lower + upper) / 2).toFixed(2));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const rank = (ordered.length - 1) * quantile;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = ordered[lowerIndex];
  const upper = ordered[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  return Number((lower + (upper - lower) * (rank - lowerIndex)).toFixed(2));
}

// ---------------------------------------------------------------------------
// League format + availability
// ---------------------------------------------------------------------------

export function isDynasticalPpfdLeague(league: Pick<SleeperLeague, "league_id" | "name">): boolean {
  return league.league_id === DYNASTICAL_CUCKS_LEAGUE_ID || league.name.toLowerCase().includes("dynastical cucks");
}

export function seasonLongFormatForLeague(league: SleeperLeague): SeasonLongFormat {
  const rosterPositions = league.roster_positions ?? [];
  const numQbs = rosterPositions.includes("SUPER_FLEX") || rosterPositions.filter((slot) => slot === "QB").length > 1 ? 2 : 1;
  const isPpfdLeague = isDynasticalPpfdLeague(league);
  const ppr = isPpfdLeague ? 1 : league.scoring_settings?.rec === 1 ? 1 : league.scoring_settings?.rec === 0 ? 0 : 0.5;
  const isDynasty = league.settings?.type === 2 || league.name.toLowerCase().includes("dynasty");
  const numTeams = Math.max(2, Math.min(32, league.total_rosters ?? 12));
  const key = `${isDynasty ? "dynasty" : "redraft"}-${numQbs}qb-${numTeams}t-${ppr}ppr`;
  const scoring = isPpfdLeague ? "PPR proxy · PPFD league" : ppr === 1 ? "PPR" : ppr === 0.5 ? "Half PPR" : "Standard";
  return {
    key,
    isDynasty,
    numQbs,
    numTeams,
    ppr,
    label: `${isDynasty ? "Dynasty" : "Redraft"} · ${numTeams}-team · ${numQbs === 2 ? "Superflex / 2QB" : "1QB"} · ${scoring}`,
  };
}

/** FFC format slug used for ADP requests for a league. */
export function ffcFormatForLeague(league: SleeperLeague): string {
  const format = seasonLongFormatForLeague(league);
  if (format.numQbs === 2) return "2qb";
  if (format.isDynasty) return "dynasty";
  if (format.ppr === 1) return "ppr";
  if (format.ppr === 0.5) return "half-ppr";
  return "standard";
}

/**
 * Cache key for draft-market ADP rows. Content depends on season and the
 * caller's FFC format/team pairs, so the key must include both — a single
 * global key lets the first caller's formats poison later users for 24h.
 */
export function draftMarketCacheKey(season: number, leagues: SleeperLeague[]): string {
  const pairs = new Set<string>();
  for (const league of leagues) {
    const format = seasonLongFormatForLeague(league);
    const ffcFormat = ffcFormatForLeague(league);
    pairs.add(`${ffcFormat}:${format.numTeams}`);
    if (format.isDynasty) pairs.add(`rookie:${format.numTeams}`);
  }
  const suffix = [...pairs].sort().join(",") || "none";
  return `${DRAFT_MARKET_CACHE_KEY}:${season}:${suffix}`;
}

export function normalizedAvailabilityStatus(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
}

export function isUnavailableForCurrentWeek(status: string | null | undefined): boolean {
  if (!status) return false;
  return new Set([
    "out",
    "inactive",
    "ir",
    "injured reserve",
    "pup",
    "physically unable to perform",
    "nfi",
    "non football injury",
    "non football illness",
    "suspended",
    "suspension",
    "reserve suspended",
    "sus",
  ]).has(normalizedAvailabilityStatus(status));
}

export function weeklyAvailabilityStatus(player: SleeperPlayer | undefined): string | null {
  if (!player) return null;
  const injuryStatus = player.injury_status?.trim() || null;
  if (isUnavailableForCurrentWeek(injuryStatus)) return injuryStatus;
  const rosterStatus = player.status?.trim() || null;
  if (isUnavailableForCurrentWeek(rosterStatus)) return rosterStatus;
  const injuryNotes = player.injury_notes?.trim() || null;
  if (injuryNotes && /\b(out for (?:the )?(?:week|season|year)|ruled out|season[ -]ending|miss (?:the )?rest of (?:the )?(?:season|year)|placed on injured reserve)\b/i.test(injuryNotes)) {
    return injuryStatus ?? "Out";
  }
  return injuryStatus;
}

export function parseInjurySnapshot(payload: string | undefined): Record<string, string | null> {
  if (!payload) return {};
  try {
    const value: unknown = decodeSourceCachePayload(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter(
      (entry): entry is [string, string | null] => typeof entry[1] === "string" || entry[1] === null,
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}
