import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import {
  leagueDataTtlMs,
  leagueRostersCacheKey,
  nflStateCacheKey,
  userLeaguesCacheKey,
  type LeagueRosters,
  type RosterSlot,
} from "./league-relevance.js";
import { SLEEPER_BASE, fetchJson, type SleeperLeague, type SleeperRoster } from "./sleeper.js";

/**
 * Look up the current NFL season from Sleeper, then the signed-in user's
 * leagues and those leagues' rosters. League lists are cached per Sleeper
 * user. Rosters are cached per league so friends in the same league share
 * one Sleeper read. Nothing here uses a fixed league list or owner id.
 */

export type NflState = {
  season: number;
  week: number;
  seasonType: string;
};

export type UserLeagues = NflState & {
  leagues: SleeperLeague[];
};

const NFL_STATE_KEY = nflStateCacheKey();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNflState(value: unknown): NflState | null {
  if (!isRecord(value)) return null;
  const { season, week, seasonType } = value;
  if (typeof season !== "number" || !Number.isInteger(season) || season < 2000) return null;
  if (typeof week !== "number" || !Number.isInteger(week)) return null;
  if (typeof seasonType !== "string") return null;
  return { season, week, seasonType };
}

function isSleeperLeague(value: unknown): value is SleeperLeague {
  if (!isRecord(value)) return false;
  return typeof value.league_id === "string" && value.league_id.length > 0 && typeof value.name === "string";
}

function parseLeagueList(value: unknown): SleeperLeague[] | null {
  if (!Array.isArray(value) || !value.every(isSleeperLeague)) return null;
  return value;
}

function parseRosterCache(value: unknown): RosterSlot[] | null {
  if (!isRecord(value) || !Array.isArray(value.rosters)) return null;
  const parsed: RosterSlot[] = [];
  for (const roster of value.rosters) {
    if (!isRecord(roster)) return null;
    const { ownerId, playerIds } = roster;
    if (!(ownerId === null || typeof ownerId === "string")) return null;
    if (!Array.isArray(playerIds) || !playerIds.every((id) => typeof id === "string")) return null;
    parsed.push({ ownerId, playerIds });
  }
  return parsed;
}

async function readCachedPayload(cacheKey: string): Promise<{ value: unknown; fresh: boolean } | null> {
  const rows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      value: JSON.parse(row.payload) as unknown,
      fresh: Date.now() - row.fetchedAt.getTime() <= leagueDataTtlMs(),
    };
  } catch {
    return null;
  }
}

async function writeCache(cacheKey: string, payload: unknown): Promise<void> {
  try {
    const body = JSON.stringify(payload);
    const fetchedAt = new Date();
    await db.insert(schema.sourceCache).values({ cacheKey, payload: body, fetchedAt }).onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: body, fetchedAt },
    });
  } catch (err) {
    console.error("[user-leagues] cache write failed", cacheKey, err instanceof Error ? err.message : err);
  }
}

export async function readNflState(fresh = false): Promise<NflState> {
  const cached = await readCachedPayload(NFL_STATE_KEY);
  const parsed = cached ? parseNflState(cached.value) : null;
  if (!fresh && parsed && cached?.fresh) return parsed;
  try {
    const state = await fetchJson<{ season: string; week: number; season_type?: string }>(`${SLEEPER_BASE}/state/nfl`);
    const next = parseNflState({
      season: Number(state.season),
      week: state.week,
      seasonType: state.season_type ?? "",
    });
    if (!next) throw new Error("Sleeper NFL state is unavailable");
    await writeCache(NFL_STATE_KEY, next);
    return next;
  } catch (err) {
    if (parsed) return parsed;
    throw err;
  }
}

export async function readUserLeagues(sleeperUserId: string, fresh = false): Promise<UserLeagues> {
  const state = await readNflState(fresh);
  const cacheKey = userLeaguesCacheKey(sleeperUserId, state.season);
  const cached = await readCachedPayload(cacheKey);
  const parsed = cached ? parseLeagueList(cached.value) : null;
  // An empty list is not cached as fresh: a user who just joined a league
  // should see it on the next request instead of waiting out the TTL.
  if (!fresh && parsed && cached?.fresh && parsed.length > 0) return { ...state, leagues: parsed };
  try {
    const leagues = await fetchJson<unknown>(`${SLEEPER_BASE}/user/${sleeperUserId}/leagues/nfl/${state.season}`);
    const next = parseLeagueList(leagues);
    if (!next) throw new Error("Sleeper leagues are unavailable");
    await writeCache(cacheKey, next);
    return { ...state, leagues: next };
  } catch (err) {
    if (parsed) return { ...state, leagues: parsed };
    throw err;
  }
}

function rosterSlots(rosters: SleeperRoster[]): RosterSlot[] {
  return rosters.map((roster) => ({
    ownerId: roster.owner_id ?? null,
    playerIds: (roster.players ?? []).filter((playerId): playerId is string => typeof playerId === "string"),
  }));
}

/**
 * Rosters for the viewer's leagues. A failed league is `rosters: null`
 * unless an older cache row can fill it. Callers decide whether every
 * league failing is an error.
 */
export async function readLeagueRosters(leagues: SleeperLeague[], fresh = false): Promise<LeagueRosters[]> {
  return Promise.all(leagues.map(async (league) => {
    const cacheKey = leagueRostersCacheKey(league.league_id);
    const cached = await readCachedPayload(cacheKey);
    const parsed = cached ? parseRosterCache(cached.value) : null;
    if (!fresh && parsed && cached?.fresh) {
      return { id: league.league_id, name: league.name, rosters: parsed };
    }
    try {
      const raw = await fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`);
      const rosters = rosterSlots(raw);
      await writeCache(cacheKey, { rosters });
      return { id: league.league_id, name: league.name, rosters };
    } catch (err) {
      console.error("[user-leagues] roster fetch failed", league.league_id, err instanceof Error ? err.message : err);
      if (parsed) return { id: league.league_id, name: league.name, rosters: parsed };
      return { id: league.league_id, name: league.name, rosters: null };
    }
  }));
}
