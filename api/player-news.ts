import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  forbidden,
  hasCronSecret,
  internalError,
  json,
} from "./_lib/api-utils.js";
import {
  PLAYER_NEWS_LEAGUES,
  PLAYER_NEWS_SNAPSHOT_KEY,
  SLEEPER_BASE,
  SLEEPER_USER_ID,
  fetchJson,
  parseInjurySnapshot,
  weeklyAvailabilityStatus,
  withDeadline,
  type SleeperPlayer,
  type SleeperRoster,
} from "./_lib/sleeper.js";

/**
 * /api/player-news
 *
 * GET  — read the latest player-news roundup (replaces `getPlayerNews`).
 *        When the request carries the Vercel Cron secret, it instead runs
 *        a refresh (Vercel Cron invokes the path with GET + the CRON_SECRET
 *        bearer header), so this single route serves both the reader and
 *        the scheduled refresh that used to live at /api/cron/refresh-player-news.
 * POST — run a refresh (manual / cron-secret guarded).
 *
 * The refresh diffs Sleeper injury statuses against the saved snapshot and
 * writes one news item per status change. The deep-research (Brave Search)
 * half of the original Hatch flow remains out of scope (Phase 3).
 */

const PLAYER_NEWS_CHECK_KEY = "player-news-last-check-v1";
const REFRESH_TIMEOUT_MS = 110_000;

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

async function readPlayerNews(): Promise<Response> {
  const runs = await db
    .select()
    .from(schema.playerNewsRuns)
    .orderBy(desc(schema.playerNewsRuns.checkedAt))
    .limit(60);
  const runIds = runs.map((run) => run.id);

  const [items, checkedRows] = await Promise.all([
    runIds.length > 0
      ? db.select().from(schema.playerNewsItems).where(inArray(schema.playerNewsItems.runId, runIds))
      : Promise.resolve([] as (typeof schema.playerNewsItems.$inferSelect)[]),
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
}

type RosterPlayer = {
  playerId: string;
  player: string;
  team: string;
  injuryStatus: string | null;
  leagues: Array<{ id: string; name: string }>;
};

async function buildRosterContext(): Promise<{
  active: boolean;
  season: number;
  week: number;
  players: RosterPlayer[];
}> {
  const state = await fetchJson<{ season: string; week: number; season_type?: string }>(`${SLEEPER_BASE}/state/nfl`);
  const season = Number(state.season);
  if (season !== 2026 || state.season_type !== "regular") {
    return { active: false, season, week: state.week, players: [] };
  }
  const [players, rosterResults] = await Promise.all([
    fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`),
    Promise.all(PLAYER_NEWS_LEAGUES.map(async (league) => ({
      league,
      rosters: await fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.id}/rosters`),
    }))),
  ]);
  const leagueMembership = new Map<string, Array<{ id: string; name: string }>>();
  for (const result of rosterResults) {
    const ownRoster = result.rosters.find((roster) => roster.owner_id === SLEEPER_USER_ID);
    for (const playerId of ownRoster?.players ?? []) {
      if (!players[playerId] || /^[A-Z]{2,3}$/.test(playerId)) continue;
      const memberships = leagueMembership.get(playerId) ?? [];
      memberships.push({ id: result.league.id, name: result.league.name });
      leagueMembership.set(playerId, memberships);
    }
  }
  const rosteredPlayers = [...leagueMembership.entries()].flatMap(([playerId, leagues]) => {
    const player = players[playerId];
    if (!player) return [];
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name) return [];
    return [{
      playerId,
      player: name,
      team: player.team ?? "FA",
      injuryStatus: weeklyAvailabilityStatus(player),
      leagues,
    }];
  }).sort((a, b) => a.player.localeCompare(b.player));
  return { active: true, season, week: state.week, players: rosteredPlayers };
}

async function runRefresh(): Promise<Response> {
  let context: Awaited<ReturnType<typeof buildRosterContext>>;
  try {
    context = await withDeadline(buildRosterContext(), REFRESH_TIMEOUT_MS);
  } catch {
    return json({ ok: false, error: "Sleeper rosters are temporarily unavailable." }, 502);
  }
  if (!context.active) {
    return json({ ok: true, queued: false, reason: "Player-news checks are paused outside the 2026 regular season." });
  }

  const priorRows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_SNAPSHOT_KEY)).limit(1);
  const previous = parseInjurySnapshot(priorRows[0]?.payload);
  const current: Record<string, string | null> = Object.fromEntries(
    context.players.map((player) => [player.playerId, player.injuryStatus]),
  );
  const changes = context.players.flatMap((player) => {
    if (!(player.playerId in previous) || previous[player.playerId] === player.injuryStatus) return [];
    return [{
      playerId: player.playerId,
      player: player.player,
      team: player.team,
      change: `Injury status changed from ${previous[player.playerId] ?? "No designation"} to ${player.injuryStatus ?? "No designation"}.`,
      leagues: player.leagues,
    }];
  });

  const checkedAt = new Date();
  const runKey = `player-news-${checkedAt.toISOString()}`;

  await db.insert(schema.playerNewsRuns).values({ id: runKey, checkedAt, itemCount: changes.length })
    .onConflictDoUpdate({ target: schema.playerNewsRuns.id, set: { checkedAt, itemCount: changes.length } });

  if (changes.length > 0) {
    await db.insert(schema.playerNewsItems).values(changes.map((item, index) => ({
      id: `${runKey}:${index}:${item.playerId}`,
      runId: runKey,
      playerId: item.playerId,
      player: item.player,
      team: item.team,
      change: item.change,
      leaguesJson: JSON.stringify(item.leagues.map((league) => league.id)),
      newsType: "roster" as const,
      availabilityJson: null,
      roleContext: "Sleeper injury-status change detected by the scheduled check.",
      sourceLabel: "Sleeper",
      sourceUrl: "https://sleeper.app",
      sourcePublishedAt: null,
    }))).onConflictDoNothing();
  }

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_SNAPSHOT_KEY,
    payload: JSON.stringify(current),
    fetchedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: JSON.stringify(current), fetchedAt: new Date() },
  });

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_CHECK_KEY,
    payload: JSON.stringify({ checkedAt: checkedAt.toISOString() }),
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: JSON.stringify({ checkedAt: checkedAt.toISOString() }), fetchedAt: checkedAt },
  });

  return json({
    ok: true,
    queued: true,
    runKey,
    week: context.week,
    injuryChanges: changes.length,
  });
}

export async function GET(req: Request): Promise<Response> {
  try {
    // Vercel Cron hits the path with GET + the CRON_SECRET bearer header.
    if (hasCronSecret(req)) {
      return await runRefresh();
    }
    return await readPlayerNews();
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!hasCronSecret(req)) return forbidden("Invalid cron secret.");
  try {
    return await runRefresh();
  } catch (err) {
    return internalError(err);
  }
}
