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
  BOOM_BUST_SEASONS,
  SLEEPER_BASE,
  buildBoomBustSeries,
  canonicalTeam,
  fetchJson,
  hasSleeperGameParticipation,
  loadSleeperPlayerWeeklySeason,
  scoreProjectedPlayerStats,
  sleeperActualStats,
  sleeperGameLogStats,
  type SleeperLeague,
} from "../_lib/sleeper.js";

/**
 * GET /api/boom-bust/history?leagueId=&playerId=&position=&view=
 *
 * Replaces `getBoomBustHistory`. Returns the weekly-score distribution series
 * plus a 2026 game log, scored through the league's Sleeper scoring settings.
 *
 * Query params:
 * - leagueId (required)
 * - playerId (required)
 * - position (required): QB | RB | WR | TE
 * - view (required): season | last3
 */

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

const boomBustHistoryResponse = boomBustSeriesSchema.extend({
  view: z.enum(["season", "last3"]),
  season: z.literal(2026),
  leagueId: z.string(),
  playerId: z.string(),
  gameLog: z.array(z.object({
    season: z.number().int(),
    week: z.number().int(),
    opponent: z.string().nullable(),
    team: z.string().nullable(),
    points: z.number(),
    stats: z.record(z.string(), z.number()),
  })),
  seasonTotals: z.record(z.string(), z.number()),
  coverageNote: z.string().nullable(),
});

const querySchema = z.object({
  leagueId: z.string().min(1).max(80),
  playerId: z.string().min(1).max(80),
  position: z.enum(["QB", "RB", "WR", "TE"]),
  view: z.enum(["season", "last3"]),
});

async function loadScoringSettings(leagueId: string): Promise<Record<string, number> | null> {
  const cacheKey = `sleeper-league-settings-v1:${leagueId}`;
  const leagueSettingsRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cachedLeagueSettings = leagueSettingsRows[0];
  if (cachedLeagueSettings && Date.now() - cachedLeagueSettings.fetchedAt.getTime() < 24 * 60 * 60 * 1000) {
    try {
      const parsed: unknown = JSON.parse(cachedLeagueSettings.payload);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, number>;
      }
    } catch {
      // A malformed cache entry is treated as a miss and replaced below.
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
    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({
      leagueId: url.searchParams.get("leagueId") ?? undefined,
      playerId: url.searchParams.get("playerId") ?? undefined,
      position: url.searchParams.get("position") ?? undefined,
      view: url.searchParams.get("view") ?? undefined,
    });
    if (!parsed.success) return badRequest("Invalid query params", parsed.error.issues);
    const args = parsed.data;

    const unavailable = (): z.infer<typeof boomBustHistoryResponse> => ({
      ...buildBoomBustSeries([], "unavailable"),
      view: args.view,
      season: 2026,
      leagueId: args.leagueId,
      playerId: args.playerId,
      gameLog: [],
      seasonTotals: {},
      coverageNote: null,
    });

    try {
      const scoringSettings = await loadScoringSettings(args.leagueId);
      if (!scoringSettings) return json(unavailable());

      const seasons: readonly number[] = args.view === "season" ? [2026] : BOOM_BUST_SEASONS;
      const results = await Promise.allSettled(seasons.map(async (season) => ({
        season,
        rows: await loadSleeperPlayerWeeklySeason(args.playerId, season),
      })));
      const unavailableSeasons: number[] = [];
      const games: Array<{
        season: number;
        week: number;
        opponent: string | null;
        team: string | null;
        points: number;
        stats: Record<string, number>;
      }> = [];
      for (const [index, result] of results.entries()) {
        const season = seasons[index];
        if (season === undefined) continue;
        if (result.status === "rejected") {
          unavailableSeasons.push(season);
          continue;
        }
        for (const row of result.value.rows) {
          const week = Number(row.week);
          if (!Number.isInteger(week) || week < 1 || week > 18 || !hasSleeperGameParticipation(row)) continue;
          const opponentValue = row.opponent ?? row.opp;
          const teamValue = row.team;
          games.push({
            season,
            week,
            opponent: typeof opponentValue === "string" && opponentValue ? canonicalTeam(opponentValue) : null,
            team: typeof teamValue === "string" && teamValue ? canonicalTeam(teamValue) : null,
            points: scoreProjectedPlayerStats(args.position, sleeperActualStats(row), scoringSettings),
            stats: sleeperGameLogStats(args.position, row),
          });
        }
      }
      const loadedSeasonCount = seasons.length - unavailableSeasons.length;
      if (loadedSeasonCount === 0) return json(unavailable());
      const dedupedGames = [...new Map(games.map((game) => [`${game.season}-${game.week}`, game])).values()];
      let coverageNote: string | null = null;
      if (args.view === "last3" && unavailableSeasons.length > 0) {
        coverageNote = "Some Sleeper seasons could not be loaded, so the last 3 years may be incomplete.";
      }
      const gameLog = dedupedGames.filter((game) => game.season === 2026);
      const seasonTotals = gameLog.reduce<Record<string, number>>((totals, game) => {
        totals.fantasyPoints = Number(((totals.fantasyPoints ?? 0) + game.points).toFixed(2));
        for (const [key, value] of Object.entries(game.stats)) {
          totals[key] = Number(((totals[key] ?? 0) + value).toFixed(2));
        }
        return totals;
      }, {});
      return json(boomBustHistoryResponse.parse({
        ...buildBoomBustSeries(dedupedGames, "ok"),
        view: args.view,
        season: 2026,
        leagueId: args.leagueId,
        playerId: args.playerId,
        gameLog,
        seasonTotals,
        coverageNote,
      }));
    } catch {
      return json(unavailable());
    }
  } catch (err) {
    return internalError(err);
  }
}
