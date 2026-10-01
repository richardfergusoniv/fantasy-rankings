import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import { internalError, json, methodNotAllowed } from "./_lib/api-utils.js";

/**
 * GET /api/player-news
 *
 * Replaces `getPlayerNews`. Pure read: last 60 `player_news_runs` + all
 * `player_news_items` + last-check timestamp. Returns max 20 populated runs.
 */

const PLAYER_NEWS_CHECK_KEY = "player-news-last-check-v1";

const PLAYER_NEWS_LEAGUES = [
  { id: "1389344450517430272", name: "NY Sack Exchange II" },
  { id: "1355920300633513984", name: "Tits Out for The Ladz XII" },
  { id: "1317270144682070016", name: "C2C superconference" },
  { id: "1312127020972404736", name: "Hoe Ass Dynasty" },
  { id: "1311470531635052544", name: "Tainticklers" },
  { id: "1306489414548979712", name: "Dynastical Cucks" },
] as const;

const playerNewsAvailabilitySchema = z.object({
  leagueId: z.string(),
  league: z.string(),
  status: z.enum(["available", "your_roster", "other_roster", "unknown"]),
});

function parseNewsAvailability(payload: string | null): z.infer<typeof playerNewsAvailabilitySchema>[] {
  if (!payload) return [];
  try {
    return z.array(playerNewsAvailabilitySchema).parse(JSON.parse(payload));
  } catch {
    return [];
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const [runs, items, checkedRows] = await Promise.all([
      db.select().from(schema.playerNewsRuns).orderBy(desc(schema.playerNewsRuns.checkedAt)).limit(60),
      db.select().from(schema.playerNewsItems),
      db
        .select()
        .from(schema.sourceCache)
        .where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_CHECK_KEY))
        .limit(1),
    ]);

    const itemGroups = new Map<string, typeof items>();
    for (const item of items) {
      const group = itemGroups.get(item.runId) ?? [];
      group.push(item);
      itemGroups.set(item.runId, group);
    }

    const populatedRuns = runs
      .flatMap((run) => {
        const runItems = itemGroups.get(run.id) ?? [];
        if (runItems.length === 0) return [];
        return [
          {
            id: run.id,
            checkedAt: run.checkedAt.toISOString(),
            items: runItems.map((item) => {
              let leagueIds: string[] = [];
              try {
                leagueIds = JSON.parse(item.leaguesJson) as string[];
              } catch {
                leagueIds = [];
              }
              return {
                id: item.id,
                playerId: item.playerId,
                player: item.player,
                team: item.team,
                change: item.change,
                leagueIds,
                newsType: item.newsType,
                leagues: leagueIds.flatMap((leagueId) => {
                  const league = PLAYER_NEWS_LEAGUES.find((candidate) => candidate.id === leagueId);
                  return league ? [league.name] : [];
                }),
                availability: parseNewsAvailability(item.availabilityJson),
                roleContext: item.roleContext,
                sourceLabel: item.sourceLabel,
                sourceUrl: item.sourceUrl,
                sourcePublishedAt: item.sourcePublishedAt?.toISOString() ?? null,
              };
            }),
          },
        ];
      })
      .slice(0, 20);

    return json({
      lastCheckedAt: checkedRows[0]?.fetchedAt.toISOString() ?? null,
      runs: populatedRuns,
    });
  } catch (err) {
    return internalError(err);
  }
}
