/**
 * Load current-week prop lines from `prop_line_snapshots` (one compact query)
 * and enrich with Sleeper player identity from the NFL players cache.
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "./db.js";
import { readCachedNflPlayersMap } from "./nfl-players-cache.js";
import {
  currentWeekPropLines,
  type CurrentWeekPropLine,
} from "./prop-line-reads.js";
import type { SleeperPlayer } from "./sleeper.js";
import {
  buildSleeperPickMap,
  parseStoredSleeperPicks,
  sleeperPicksCacheKey,
  type SleeperPickLine,
} from "./sleeper-picks.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";
import { readNflState } from "./user-leagues.js";

export type PropLineWeekPayload = {
  season: number;
  week: number;
  pulledAt: string | null;
  /** When the staged Sleeper Picks board was pulled (null = no board). */
  sleeperPulledAt: string | null;
  /** Set only when the lines could not be loaded, so an empty list is not "no lines posted". */
  degraded?: true;
  lines: Array<{
    playerId: string;
    name: string;
    team: string | null;
    position: string | null;
    stat: string;
    line: number;
    overOdds: number | null;
    underOdds: number | null;
    bookCount: number;
    openLine: number | null;
    move: number | null;
    /** Sleeper Picks reference for this player/stat, when Sleeper offers it. */
    sleeper: {
      line: number;
      overMultiplier: number | null;
      underMultiplier: number | null;
    } | null;
  }>;
};

type CacheEntry = {
  expiresAt: number;
  body: PropLineWeekPayload;
};

const PROP_LINE_WEEK_CACHE_MS = 15 * 60 * 1000;
const PROP_LINE_WEEK_CACHE_MAX = 8;
const propLineWeekCache = new Map<string, CacheEntry>();

function playerDisplayName(entry: SleeperPlayer | undefined): string {
  if (!entry) return "";
  if (entry.full_name?.trim()) return entry.full_name.trim();
  const parts = [entry.first_name, entry.last_name].filter(Boolean);
  return parts.join(" ").trim();
}

function setCache(cacheKey: string, body: PropLineWeekPayload): void {
  const nowMs = Date.now();
  for (const [key, cached] of propLineWeekCache) {
    if (cached.expiresAt <= nowMs) propLineWeekCache.delete(key);
  }
  if (propLineWeekCache.size >= PROP_LINE_WEEK_CACHE_MAX) {
    const oldest = propLineWeekCache.keys().next().value;
    if (oldest !== undefined) propLineWeekCache.delete(oldest);
  }
  propLineWeekCache.set(cacheKey, {
    expiresAt: nowMs + PROP_LINE_WEEK_CACHE_MS,
    body,
  });
}

function serializeLines(
  lines: CurrentWeekPropLine[],
  players: Record<string, SleeperPlayer>,
  sleeperByKey: Map<string, SleeperPickLine>,
): PropLineWeekPayload["lines"] {
  return lines.map((line) => {
    const meta = players[line.playerId];
    const sleeper = sleeperByKey.get(`${line.playerId}|${line.stat}`);
    return {
      playerId: line.playerId,
      name: playerDisplayName(meta) || line.playerId,
      team: meta?.team ?? null,
      position: meta?.position ?? null,
      stat: line.stat,
      line: line.line,
      overOdds: line.medianOverOdds,
      underOdds: line.medianUnderOdds,
      bookCount: line.bookCount,
      openLine: line.openLine,
      move: line.move,
      sleeper: sleeper
        ? {
          line: sleeper.line,
          overMultiplier: sleeper.overMultiplier,
          underMultiplier: sleeper.underMultiplier,
        }
        : null,
    };
  });
}

/** The week's staged Sleeper Picks board, joined by player id + stat. */
async function loadSleeperPickBoard(
  season: number,
  week: number,
): Promise<{ byKey: Map<string, SleeperPickLine>; pulledAt: string | null }> {
  try {
    const rows = await db
      .select({ payload: schema.sourceCache.payload })
      .from(schema.sourceCache)
      .where(eq(schema.sourceCache.cacheKey, sleeperPicksCacheKey(season, week)))
      .limit(1);
    const row = rows[0];
    if (!row) return { byKey: new Map(), pulledAt: null };
    const board = parseStoredSleeperPicks(decodeSourceCachePayload(row.payload));
    if (!board) return { byKey: new Map(), pulledAt: null };
    return { byKey: buildSleeperPickMap(board.lines), pulledAt: board.pulledAt };
  } catch {
    return { byKey: new Map(), pulledAt: null };
  }
}

/** One season/week query → latest line per player/stat (+ open/move). */
export async function loadPropLineWeek(options?: {
  season?: number;
  week?: number;
}): Promise<PropLineWeekPayload> {
  let season = options?.season;
  let week = options?.week;
  if (season === undefined || week === undefined) {
    const state = await readNflState();
    season = season ?? state.season;
    week = week ?? state.week;
  }

  const cacheKey = `${season}|${week}`;
  const cached = propLineWeekCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.body;
  }

  const rows = await db
    .select({
      playerId: schema.propLineSnapshots.playerId,
      stat: schema.propLineSnapshots.stat,
      line: schema.propLineSnapshots.line,
      medianOverOdds: schema.propLineSnapshots.medianOverOdds,
      medianUnderOdds: schema.propLineSnapshots.medianUnderOdds,
      bookCount: schema.propLineSnapshots.bookCount,
      pulledAt: schema.propLineSnapshots.pulledAt,
    })
    .from(schema.propLineSnapshots)
    .where(and(
      eq(schema.propLineSnapshots.season, season),
      eq(schema.propLineSnapshots.week, week),
    ));

  const collapsed = currentWeekPropLines(rows);
  const players = await readCachedNflPlayersMap();
  let latestPulledAt: Date | null = null;
  for (const line of collapsed) {
    if (!latestPulledAt || line.pulledAt.getTime() > latestPulledAt.getTime()) {
      latestPulledAt = line.pulledAt;
    }
  }

  const sleeperBoard = await loadSleeperPickBoard(season, week);
  const body: PropLineWeekPayload = {
    season,
    week,
    pulledAt: latestPulledAt?.toISOString() ?? null,
    sleeperPulledAt: sleeperBoard.pulledAt,
    lines: serializeLines(collapsed, players, sleeperBoard.byKey),
  };
  // Avoid caching a non-empty week with missing player metadata (empty roster
  // map) — that degrades names/teams and hides game-filtered props for 15m.
  if (collapsed.length === 0 || Object.keys(players).length > 0) {
    setCache(cacheKey, body);
  }
  return body;
}

/** Test helper — clear the in-process week cache. */
export function clearPropLineWeekCacheForTests(): void {
  propLineWeekCache.clear();
}
