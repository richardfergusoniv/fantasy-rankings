import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../_lib/db.js";
import {
  badRequest,
  internalError,
  json,
  methodNotAllowed,
} from "../_lib/api-utils.js";
import {
  SLEEPER_BASE,
  fetchJson,
  hasSleeperGameParticipation,
  loadSleeperPlayerWeeklySeason,
  scoreProjectedPlayerStats,
  sleeperActualStats,
  type SleeperLeague,
} from "../_lib/sleeper.js";

/**
 * GET /api/boom-bust/ranges?leagueId=&position=&playerIds=a,b,c
 *
 * Replaces `getBoomBustRanges`. Scores each player's 2026 weekly actuals
 * through the league's Sleeper scoring settings and returns floor/ceiling.
 *
 * Query params:
 * - leagueId (required)
 * - position (required): QB | RB | WR | TE
 * - playerIds (required): comma-separated Sleeper player IDs, 1–24
 */

const querySchema = z.object({
  leagueId: z.string().min(1).max(80),
  position: z.enum(["QB", "RB", "WR", "TE"]),
  playerIds: z.array(z.string().min(1).max(80)).min(1).max(24),
});

const boomBustRangesResponse = z.object({
  rows: z.array(z.object({
    playerId: z.string(),
    floor: z.number(),
    ceiling: z.number(),
    range: z.number(),
    games: z.number().int(),
  })),
  unavailablePlayerIds: z.array(z.string()),
});

async function loadScoringSettings(leagueId: string): Promise<Record<string, number> | null> {
  const cacheKey = `sleeper-league-settings-v1:${leagueId}`;
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && Date.now() - cached.fetchedAt.getTime() < 24 * 60 * 60 * 1000) {
    try {
      const parsed: unknown = JSON.parse(cached.payload);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, number>;
      }
    } catch {
      // A malformed cache entry is treated as a miss.
    }
  }
  const league = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${leagueId}`);
  if (league.league_id !== leagueId) return null;
  const scoringSettings = league.scoring_settings ?? {};
  await db.insert(schema.sourceCache).values({ cacheKey, payload: JSON.stringify(scoringSettings), fetchedAt: new Date() })
    .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(scoringSettings), fetchedAt: new Date() } });
  return scoringSettings;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);

  try {
    const url = new URL(req.url);
    const rawPlayerIds = url.searchParams.get("playerIds") ?? "";
    const parsed = querySchema.safeParse({
      leagueId: url.searchParams.get("leagueId") ?? undefined,
      position: url.searchParams.get("position") ?? undefined,
      playerIds: rawPlayerIds.split(",").map((id) => id.trim()).filter(Boolean),
    });
    if (!parsed.success) return badRequest("Invalid query params", parsed.error.issues);

    const scoringSettings = await loadScoringSettings(parsed.data.leagueId);
    if (!scoringSettings) {
      return json(boomBustRangesResponse.parse({ rows: [], unavailablePlayerIds: parsed.data.playerIds }));
    }

    const uniquePlayerIds = [...new Set(parsed.data.playerIds)];
    const results = await Promise.allSettled(uniquePlayerIds.map(async (playerId) => {
      const rows = await loadSleeperPlayerWeeklySeason(playerId, 2026);
      const points = rows.flatMap((row) => {
        const week = Number(row.week);
        if (!Number.isInteger(week) || week < 1 || week > 18 || !hasSleeperGameParticipation(row)) return [];
        return [scoreProjectedPlayerStats(parsed.data.position, sleeperActualStats(row), scoringSettings)];
      });
      if (points.length < 2) return null;
      const floor = Math.min(...points);
      const ceiling = Math.max(...points);
      return { playerId, floor, ceiling, range: Number((ceiling - floor).toFixed(2)), games: points.length };
    }));
    const rows = results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
    const returned = new Set(rows.map((row) => row.playerId));
    return json(boomBustRangesResponse.parse({
      rows,
      unavailablePlayerIds: uniquePlayerIds.filter((playerId) => !returned.has(playerId)),
    }));
  } catch (err) {
    return internalError(err);
  }
}
