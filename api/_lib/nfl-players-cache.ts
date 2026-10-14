import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import {
  SLEEPER_BASE,
  canonicalTeam,
  fetchJson,
  normalizePosition,
  type SleeperPlayer,
} from "./sleeper.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";

/**
 * Compact NFL player roster cache (team + status + identity).
 *
 * Sleeper's `/players/nfl` dump is ~16MB raw. Storing and re-reading that blob
 * in `source_cache` burns Supabase egress. This module keeps only the fields
 * rankings, trades, draft, and news need (~3MB raw, less gzipped), refreshed
 * at least daily via `/api/cron/jobs?job=refresh-nfl-players`.
 *
 * Replaces the legacy full-dump key `sleeper-players-nfl` (7-day TTL).
 */

export const NFL_PLAYERS_CACHE_KEY = "nfl-players-roster-v1";
/** Soft freshness window for consumers (dashboard, trades, draft). */
export const NFL_PLAYERS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Refuse to replace a good cache with fewer than this many compact rows. */
export const NFL_PLAYERS_MIN_COUNT = 1_000;
/**
 * Refuse to replace a retained snapshot with a dump smaller than this fraction
 * of its size (guards against partial Sleeper responses that still clear the
 * absolute minimum).
 */
export const NFL_PLAYERS_MIN_RETENTION_RATIO = 0.8;

export type NflPlayerRosterEntry = {
  team: string | null;
  status: string | null;
  position: string | null;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  injury_status?: string | null;
  injury_notes?: string | null;
  /** Sleeper news stamp — epoch seconds/ms or ISO string when present. */
  news_updated?: string | number | null;
  years_exp?: number | null;
};

export type NflPlayersCacheSnapshot = {
  fetchedAt: string;
  players: Record<string, NflPlayerRosterEntry>;
};

export type NflPlayersRefreshResult = {
  ok: true;
  status: "committed" | "kept-previous" | "empty";
  players: number;
  fetchedAt: string | null;
};

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Strip the Sleeper dump down to roster fields we actually read. */
export function compactSleeperPlayers(
  raw: Record<string, SleeperPlayer>,
): Record<string, NflPlayerRosterEntry> {
  const compact: Record<string, NflPlayerRosterEntry> = {};
  for (const [playerId, player] of Object.entries(raw)) {
    if (!player || typeof player !== "object") continue;
    const newsUpdated = player.news_updated;
    compact[playerId] = {
      team: asNullableString(player.team),
      status: asNullableString(player.status),
      position: asNullableString(player.position),
      full_name: asOptionalString(player.full_name),
      first_name: asOptionalString(player.first_name),
      last_name: asOptionalString(player.last_name),
      injury_status: player.injury_status === undefined
        ? undefined
        : asNullableString(player.injury_status),
      injury_notes: player.injury_notes === undefined
        ? undefined
        : asNullableString(player.injury_notes),
      news_updated: newsUpdated === undefined
        ? undefined
        : (typeof newsUpdated === "string" || typeof newsUpdated === "number" ? newsUpdated : null),
      years_exp: asOptionalNumber(player.years_exp),
    };
  }
  return compact;
}

export function rosterEntryToSleeperPlayer(entry: NflPlayerRosterEntry): SleeperPlayer {
  return {
    team: entry.team,
    status: entry.status,
    position: entry.position,
    full_name: entry.full_name,
    first_name: entry.first_name,
    last_name: entry.last_name,
    injury_status: entry.injury_status,
    injury_notes: entry.injury_notes,
    news_updated: entry.news_updated,
    years_exp: entry.years_exp,
  };
}

export function sleeperPlayersFromRosterMap(
  players: Record<string, NflPlayerRosterEntry>,
): Record<string, SleeperPlayer> {
  const output: Record<string, SleeperPlayer> = {};
  for (const [playerId, entry] of Object.entries(players)) {
    output[playerId] = rosterEntryToSleeperPlayer(entry);
  }
  return output;
}

/**
 * Prefer Sleeper's current team (including null = FA / no team). FantasyCalc
 * `maybeTeam` lags trades and cuts — never override a known Sleeper row with it.
 */
export function resolvePlayerTeam(
  sleeper: Pick<SleeperPlayer, "team"> | NflPlayerRosterEntry | undefined,
  fantasyCalcTeam?: string | null,
): string | null {
  if (sleeper) {
    const team = sleeper.team?.trim();
    return team ? canonicalTeam(team) : null;
  }
  const fallback = fantasyCalcTeam?.trim();
  return fallback ? canonicalTeam(fallback) : null;
}

/**
 * Weekly projection boards only list players currently on an NFL roster.
 * Free agents (null team) stay out so cut kickers / released players do not
 * appear as if they are still rostered.
 */
export function isActiveNflRosterPlayer(
  player: Pick<SleeperPlayer, "full_name" | "first_name" | "last_name" | "team" | "position">,
): boolean {
  const position = normalizePosition(player.position);
  const team = player.team?.trim() ? canonicalTeam(player.team) : "";
  const name = player.full_name
    ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
  return Boolean(name && team && ["QB", "RB", "WR", "TE", "K"].includes(position));
}

function parsePlayersCachePayload(payload: string): NflPlayersCacheSnapshot | null {
  try {
    const parsed: unknown = decodeSourceCachePayload(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as { fetchedAt?: unknown; players?: unknown };
    if (typeof record.fetchedAt !== "string" || !record.players || typeof record.players !== "object" || Array.isArray(record.players)) {
      return null;
    }
    return {
      fetchedAt: record.fetchedAt,
      players: record.players as Record<string, NflPlayerRosterEntry>,
    };
  } catch {
    return null;
  }
}

async function readCachedSnapshot(): Promise<{ snapshot: NflPlayersCacheSnapshot; fetchedAt: Date } | null> {
  const [cached] = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, NFL_PLAYERS_CACHE_KEY))
    .limit(1);
  if (!cached) return null;
  const snapshot = parsePlayersCachePayload(cached.payload);
  if (!snapshot || Object.keys(snapshot.players).length === 0) return null;
  return { snapshot, fetchedAt: cached.fetchedAt };
}

async function writePlayersSnapshot(
  players: Record<string, NflPlayerRosterEntry>,
  fetchedAt: Date,
): Promise<NflPlayersCacheSnapshot> {
  const snapshot: NflPlayersCacheSnapshot = {
    fetchedAt: fetchedAt.toISOString(),
    players,
  };
  const payload = encodeSourceCachePayload(snapshot);
  await db.insert(schema.sourceCache).values({
    cacheKey: NFL_PLAYERS_CACHE_KEY,
    payload,
    fetchedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload, fetchedAt },
  });
  return snapshot;
}

/**
 * Decide whether a freshly compacted Sleeper map is complete enough to store,
 * or whether callers should keep serving `previous`. Pure so retention stays
 * unit-testable without DB / network mocks.
 */
export function selectRosterRefreshOutcome(
  compact: Record<string, NflPlayerRosterEntry>,
  previous: Record<string, NflPlayerRosterEntry> | null,
): { action: "commit"; players: Record<string, NflPlayerRosterEntry> }
  | { action: "keep-previous"; players: Record<string, NflPlayerRosterEntry> }
  | { action: "empty"; players: Record<string, NflPlayerRosterEntry> } {
  const count = Object.keys(compact).length;
  const previousCount = previous ? Object.keys(previous).length : 0;
  const meetsFloor = count >= NFL_PLAYERS_MIN_COUNT;
  const notShrunkTooMuch = previousCount === 0
    || count >= Math.floor(previousCount * NFL_PLAYERS_MIN_RETENTION_RATIO);
  if (meetsFloor && notShrunkTooMuch) {
    return { action: "commit", players: compact };
  }
  if (previousCount > 0 && previous) {
    return { action: "keep-previous", players: previous };
  }
  return { action: "empty", players: compact };
}

/**
 * Fetch Sleeper `/players/nfl`, compact it, and replace the cache when the
 * dump looks complete. On failure or a thin response, keep the last snapshot.
 */
export async function refreshNflPlayersCache(): Promise<NflPlayersRefreshResult> {
  const previous = await readCachedSnapshot();
  const previousPlayers = previous?.snapshot.players ?? null;
  try {
    const fresh = await fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`);
    const compact = compactSleeperPlayers(fresh);
    const outcome = selectRosterRefreshOutcome(compact, previousPlayers);
    if (outcome.action !== "commit") {
      return {
        ok: true,
        status: outcome.action === "keep-previous" ? "kept-previous" : "empty",
        players: Object.keys(outcome.players).length,
        fetchedAt: previous?.snapshot.fetchedAt ?? null,
      };
    }
    const fetchedAt = new Date();
    const snapshot = await writePlayersSnapshot(outcome.players, fetchedAt);
    return {
      ok: true,
      status: "committed",
      players: Object.keys(outcome.players).length,
      fetchedAt: snapshot.fetchedAt,
    };
  } catch {
    return {
      ok: true,
      status: previous ? "kept-previous" : "empty",
      players: previous ? Object.keys(previous.snapshot.players).length : 0,
      fetchedAt: previous?.snapshot.fetchedAt ?? null,
    };
  }
}

/**
 * Read the compact roster map from `source_cache` only — no Sleeper refresh.
 * Used by light read routes (e.g. prop-line enrichment) to avoid egress spikes.
 */
export async function readCachedNflPlayersMap(): Promise<Record<string, SleeperPlayer>> {
  const cached = await readCachedSnapshot();
  if (!cached) return {};
  return sleeperPlayersFromRosterMap(cached.snapshot.players);
}

/**
 * Load the compact roster map as `SleeperPlayer` records. Uses the daily cache
 * when fresh; refreshes from Sleeper when missing, forced, or past the soft
 * freshness window. Never writes the full dump back to Supabase.
 *
 * Past the soft window (or when `forceRefresh` is set), a Sleeper pull is
 * attempted. On failure or a thin dump, any retained cache row is still
 * returned so dashboards stay up.
 */
export async function loadNflPlayersMap(forceRefresh = false): Promise<Record<string, SleeperPlayer>> {
  const cached = await readCachedSnapshot();
  const ageMs = cached ? Date.now() - cached.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
  if (!forceRefresh && cached && ageMs < NFL_PLAYERS_CACHE_MAX_AGE_MS) {
    return sleeperPlayersFromRosterMap(cached.snapshot.players);
  }

  try {
    const fresh = await fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`);
    const compact = compactSleeperPlayers(fresh);
    const outcome = selectRosterRefreshOutcome(compact, cached?.snapshot.players ?? null);
    if (outcome.action === "commit") {
      await writePlayersSnapshot(outcome.players, new Date());
    }
    return sleeperPlayersFromRosterMap(outcome.players);
  } catch (error) {
    if (cached) {
      return sleeperPlayersFromRosterMap(cached.snapshot.players);
    }
    throw error;
  }
}
