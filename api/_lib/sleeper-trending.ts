/**
 * Sleeper trending adds/drops as a market-sentiment signal for player
 * cards. The endpoints are public — GET
 * https://api.sleeper.app/v1/players/nfl/trending/add|drop, no auth —
 * and return platform-wide counts over a trailing window:
 * [{ player_id, count }]. The dashboard build fetches both lists and
 * merges them into one map keyed by Sleeper player id. A side is null
 * when the player is not on that list (below the fetched depth), so
 * the UI can show what is known instead of a fabricated zero.
 */

import { fetchJson, SLEEPER_BASE } from "./sleeper.js";

export interface PlayerTrending {
  adds: number | null;
  drops: number | null;
}

export type PlayerTrendingMap = Record<string, PlayerTrending>;

interface TrendingRow {
  player_id?: unknown;
  count?: unknown;
}

function readList(payload: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  if (!Array.isArray(payload)) return counts;
  for (const row of payload as TrendingRow[]) {
    if (typeof row?.player_id !== "string" || row.player_id.length === 0) continue;
    if (typeof row.count !== "number" || !Number.isFinite(row.count) || row.count < 0) continue;
    counts.set(row.player_id, Math.round(row.count));
  }
  return counts;
}

export function mergeTrendingLists(addsPayload: unknown, dropsPayload: unknown): PlayerTrendingMap {
  const adds = readList(addsPayload);
  const drops = readList(dropsPayload);
  const merged: PlayerTrendingMap = {};
  for (const playerId of new Set([...adds.keys(), ...drops.keys()])) {
    merged[playerId] = { adds: adds.get(playerId) ?? null, drops: drops.get(playerId) ?? null };
  }
  return merged;
}

const TRENDING_LIMIT = 100;
const TRENDING_LOOKBACK_HOURS = 24;

export async function loadSleeperTrending(): Promise<PlayerTrendingMap> {
  const query = `lookback_hours=${TRENDING_LOOKBACK_HOURS}&limit=${TRENDING_LIMIT}`;
  const [adds, drops] = await Promise.all([
    fetchJson<unknown>(`${SLEEPER_BASE}/players/nfl/trending/add?${query}`),
    fetchJson<unknown>(`${SLEEPER_BASE}/players/nfl/trending/drop?${query}`),
  ]);
  return mergeTrendingLists(adds, drops);
}
