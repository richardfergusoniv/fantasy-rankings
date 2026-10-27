import { readOwnerSleeperUserId } from "./auth.js";
import {
  isActiveNflRosterPlayer,
  loadNflPlayersMap,
  readCachedNflPlayersMap,
} from "./nfl-players-cache.js";
import type { SleeperPlayer } from "./sleeper.js";
import { readLeagueRosters, readUserLeagues } from "./user-leagues.js";

/**
 * Priority player set for Richard’s external X → `/api/ingest/player-news-x`
 * producer (coverage option A):
 *
 *   union( all player_ids rostered in owner leagues ,
 *          active skill+K with Sleeper search_rank ≤ SEARCH_RANK_MAX )
 *
 * Served by `GET /api/cron/jobs?job=x-producer-priority` (CRON_SECRET).
 * Pure builders below are unit-tested without DB / network.
 */

/** Active fantasy-relevant players at or below this Sleeper search_rank. */
export const X_PRODUCER_SEARCH_RANK_MAX = 300;

export type XProducerPriorityReason = "rostered" | "search_rank";

export type XProducerPriorityPlayer = {
  playerId: string;
  fullName: string;
  team: string | null;
  position: string | null;
  searchRank: number | null;
  reasons: XProducerPriorityReason[];
};

export type XProducerPrioritySet = {
  playerIds: string[];
  players: XProducerPriorityPlayer[];
  rosteredCount: number;
  searchRankCount: number;
  searchRankMax: number;
  sleeperUserId: string;
  leagueCount: number;
  leaguesLoaded: number;
};

function playerLabel(player: SleeperPlayer | undefined): string {
  if (!player) return "";
  return player.full_name
    ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
}

function isActiveRosterStatus(status: string | null | undefined): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized === "active";
}

/**
 * Active NFL skill+K (team set) with a finite search_rank ≤ max.
 * Lower search_rank = more relevant on Sleeper.
 */
export function collectSearchRankPriorityIds(
  players: Record<string, SleeperPlayer>,
  searchRankMax = X_PRODUCER_SEARCH_RANK_MAX,
): Set<string> {
  const out = new Set<string>();
  for (const [playerId, player] of Object.entries(players)) {
    if (!isActiveNflRosterPlayer(player)) continue;
    if (!isActiveRosterStatus(player.status)) continue;
    const rank = player.search_rank;
    if (typeof rank !== "number" || !Number.isFinite(rank) || rank < 0) continue;
    if (rank > searchRankMax) continue;
    out.add(playerId);
  }
  return out;
}

/** Flatten league roster slots into unique Sleeper player ids. */
export function collectRosteredPlayerIds(
  leagues: Array<{ rosters: Array<{ playerIds: string[] }> | null }>,
): Set<string> {
  const out = new Set<string>();
  for (const league of leagues) {
    if (!league.rosters) continue;
    for (const roster of league.rosters) {
      for (const playerId of roster.playerIds) {
        if (playerId) out.add(playerId);
      }
    }
  }
  return out;
}

function reasonOrder(reason: XProducerPriorityReason): number {
  switch (reason) {
    case "rostered":
      return 0;
    case "search_rank":
      return 1;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * Build the durable priority set from in-memory inputs (no I/O).
 * `players` should be the compact NFL roster map (includes search_rank after refresh).
 */
export function buildXProducerPrioritySet(input: {
  sleeperUserId: string;
  players: Record<string, SleeperPlayer>;
  leagues: Array<{
    id: string;
    name: string;
    rosters: Array<{ playerIds: string[] }> | null;
  }>;
  searchRankMax?: number;
}): XProducerPrioritySet {
  const searchRankMax = input.searchRankMax ?? X_PRODUCER_SEARCH_RANK_MAX;
  const rostered = collectRosteredPlayerIds(input.leagues);
  const byRank = collectSearchRankPriorityIds(input.players, searchRankMax);

  const reasonsById = new Map<string, Set<XProducerPriorityReason>>();
  for (const playerId of rostered) {
    const set = reasonsById.get(playerId) ?? new Set<XProducerPriorityReason>();
    set.add("rostered");
    reasonsById.set(playerId, set);
  }
  for (const playerId of byRank) {
    const set = reasonsById.get(playerId) ?? new Set<XProducerPriorityReason>();
    set.add("search_rank");
    reasonsById.set(playerId, set);
  }

  const players: XProducerPriorityPlayer[] = [];
  for (const [playerId, reasonSet] of reasonsById) {
    const meta = input.players[playerId];
    const reasons = [...reasonSet].sort((a, b) => reasonOrder(a) - reasonOrder(b));
    const rank = meta?.search_rank;
    players.push({
      playerId,
      fullName: playerLabel(meta) || playerId,
      team: meta?.team ?? null,
      position: meta?.position ?? null,
      searchRank: typeof rank === "number" && Number.isFinite(rank) ? rank : null,
      reasons,
    });
  }

  players.sort((a, b) => {
    const aRank = a.searchRank ?? Number.POSITIVE_INFINITY;
    const bRank = b.searchRank ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.playerId.localeCompare(b.playerId);
  });

  return {
    playerIds: players.map((row) => row.playerId),
    players,
    rosteredCount: rostered.size,
    searchRankCount: byRank.size,
    searchRankMax,
    sleeperUserId: input.sleeperUserId,
    leagueCount: input.leagues.length,
    leaguesLoaded: input.leagues.filter((league) => league.rosters !== null).length,
  };
}

/**
 * Load owner leagues + NFL roster cache and build the priority set.
 * Uses `OWNER_SLEEPER_USER_ID`. Prefers cached NFL players; refreshes when empty.
 */
export async function loadXProducerPrioritySet(options: {
  freshLeagues?: boolean;
  searchRankMax?: number;
} = {}): Promise<XProducerPrioritySet & { playersCacheSource: "cache" | "refreshed" }> {
  const sleeperUserId = readOwnerSleeperUserId();
  if (!sleeperUserId) {
    throw new Error("OWNER_SLEEPER_USER_ID is not set");
  }

  let players = await readCachedNflPlayersMap();
  let playersCacheSource: "cache" | "refreshed" = "cache";
  if (Object.keys(players).length === 0) {
    players = await loadNflPlayersMap(true);
    playersCacheSource = "refreshed";
  }

  const { leagues } = await readUserLeagues(sleeperUserId, options.freshLeagues === true);
  const leagueRosters = await readLeagueRosters(leagues, options.freshLeagues === true);

  const built = buildXProducerPrioritySet({
    sleeperUserId,
    players,
    leagues: leagueRosters,
    searchRankMax: options.searchRankMax,
  });
  return { ...built, playersCacheSource };
}
