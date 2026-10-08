import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  forbidden,
  hasCronSecret,
  internalError,
  json,
  unauthorized,
} from "./_lib/api-utils.js";
import { resolveSleeperUserId } from "./_lib/auth.js";
import { asNewsKind, relevantNewsForUser, type LeagueRosters } from "./_lib/league-relevance.js";
import {
  PLAYER_NEWS_SNAPSHOT_KEY,
  SLEEPER_BASE,
  REFRESH_TIMEOUT_MS,
  fetchJson,
  parseInjurySnapshot,
  weeklyAvailabilityStatus,
  withDeadline,
  type SleeperPlayer,
} from "./_lib/sleeper.js";
import { readLeagueRosters, readNflState, readUserLeagues } from "./_lib/user-leagues.js";

/**
 * /api/player-news
 *
 * GET  — news for the signed-in user's own leagues. The stored roundup is
 *        league-agnostic; this handler filters it against that user's
 *        rosters (their players, other teams, and free agents).
 *        A cron-secret GET runs the refresh instead.
 * POST — cron-secret refresh.
 *
 * The refresh diffs Sleeper injury statuses for fantasy players across the
 * whole NFL. It does not read a fixed league list or OWNER_SLEEPER_USER_ID.
 * The deep-research (Brave Search) half of the original Hatch flow remains
 * out of scope.
 */

const PLAYER_NEWS_CHECK_KEY = "player-news-last-check-v1";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const NO_LEAGUES_REASON = "No Sleeper leagues for the current season.";

const playerNewsAvailabilitySchema = z.object({
  leagueId: z.string(),
  league: z.string(),
  status: z.enum(["available", "your_roster", "other_roster", "unknown"]),
});

type InjuryPlayer = {
  playerId: string;
  player: string;
  team: string;
  injuryStatus: string | null;
};

function playerLabel(player: SleeperPlayer): string {
  return player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
}

function isFantasyPlayer(playerId: string, player: SleeperPlayer | undefined): player is SleeperPlayer {
  if (!player || /^[A-Z]{2,3}$/.test(playerId)) return false;
  const position = (player.position ?? "").toUpperCase();
  return FANTASY_POSITIONS.has(position) && playerLabel(player).length > 0;
}

async function readLastCheckedAt(): Promise<string | null> {
  const checkedRows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_CHECK_KEY))
    .limit(1);
  return checkedRows[0]?.fetchedAt.toISOString() ?? null;
}

async function readStoredRuns(sleeperUserId: string, leagues: LeagueRosters[]): Promise<Response> {
  const runs = await db
    .select()
    .from(schema.playerNewsRuns)
    .orderBy(desc(schema.playerNewsRuns.checkedAt))
    .limit(60);
  const runIds = runs.map((run) => run.id);
  const [items, lastCheckedAt] = await Promise.all([
    runIds.length > 0
      ? db.select().from(schema.playerNewsItems).where(inArray(schema.playerNewsItems.runId, runIds))
      : Promise.resolve([] as (typeof schema.playerNewsItems.$inferSelect)[]),
    readLastCheckedAt(),
  ]);

  const itemGroups = new Map<string, typeof items>();
  for (const item of items) {
    const group = itemGroups.get(item.runId) ?? [];
    group.push(item);
    itemGroups.set(item.runId, group);
  }

  const populatedRuns = runs.flatMap((run) => {
    const relevant = relevantNewsForUser(
      (itemGroups.get(run.id) ?? []).map((item) => ({
        ...item,
        newsType: asNewsKind(item.newsType),
      })),
      sleeperUserId,
      leagues,
    );
    if (relevant.length === 0) return [];
    return [{
      id: run.id,
      checkedAt: run.checkedAt.toISOString(),
      items: relevant.map((item) => ({
        id: item.id,
        playerId: item.playerId,
        player: item.player,
        team: item.team,
        change: item.change,
        leagueIds: item.leagueIds,
        newsType: item.newsType,
        leagues: item.leagues,
        availability: playerNewsAvailabilitySchema.array().parse(item.availability),
        roleContext: item.roleContext,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl,
        sourcePublishedAt: item.sourcePublishedAt?.toISOString() ?? null,
      })),
    }];
  }).slice(0, 20);

  return json({
    lastCheckedAt,
    runs: populatedRuns,
    emptyReason: null,
  });
}

async function buildInjuryUniverse(): Promise<{
  active: boolean;
  season: number;
  week: number;
  players: InjuryPlayer[];
}> {
  const state = await readNflState(true);
  if (state.seasonType !== "regular" && state.seasonType !== "post") {
    return { active: false, season: state.season, week: state.week, players: [] };
  }
  const players = await fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`);
  const rosteredPlayers = Object.entries(players).flatMap(([playerId, player]) => {
    if (!isFantasyPlayer(playerId, player)) return [];
    return [{
      playerId,
      player: playerLabel(player),
      team: player.team ?? "FA",
      injuryStatus: weeklyAvailabilityStatus(player),
    }];
  });
  return { active: true, season: state.season, week: state.week, players: rosteredPlayers };
}

async function runRefresh(): Promise<Response> {
  let context: Awaited<ReturnType<typeof buildInjuryUniverse>>;
  try {
    context = await withDeadline(buildInjuryUniverse(), REFRESH_TIMEOUT_MS);
  } catch {
    return json({ ok: false, error: "Sleeper player data is temporarily unavailable." }, 502);
  }
  if (!context.active) {
    return json({ ok: true, queued: false, reason: "Player-news checks are paused outside the regular season and playoffs." });
  }

  const priorRows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_SNAPSHOT_KEY)).limit(1);
  const previous = parseInjurySnapshot(priorRows[0]?.payload);
  const current: Record<string, string | null> = Object.fromEntries(
    context.players.map((player) => [player.playerId, player.injuryStatus]),
  );
  const changes = context.players.flatMap((player) => {
    if (!(player.playerId in previous) || previous[player.playerId] === player.injuryStatus) return [];
    return [player];
  });

  const checkedAt = new Date();
  const runKey = `player-news-${checkedAt.toISOString()}`;

  await db.insert(schema.playerNewsRuns).values({ id: runKey, checkedAt, itemCount: changes.length })
    .onConflictDoUpdate({ target: schema.playerNewsRuns.id, set: { checkedAt, itemCount: changes.length } });

  if (changes.length > 0) {
    const values = changes.map((item, index) => ({
      id: `${runKey}:${index}:${item.playerId}`,
      runId: runKey,
      playerId: item.playerId,
      player: item.player,
      team: item.team,
      change: `Injury status changed from ${previous[item.playerId] ?? "No designation"} to ${item.injuryStatus ?? "No designation"}.`,
      leaguesJson: "[]",
      newsType: "roster" as const,
      availabilityJson: null,
      roleContext: "Sleeper injury-status change detected by the scheduled check.",
      sourceLabel: "Sleeper",
      sourceUrl: "https://sleeper.app",
      sourcePublishedAt: null,
    }));
    for (let index = 0; index < values.length; index += 100) {
      await db.insert(schema.playerNewsItems).values(values.slice(index, index + 100)).onConflictDoNothing();
    }
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
    if (hasCronSecret(req)) {
      return await runRefresh();
    }
    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");

    let leagues: Awaited<ReturnType<typeof readUserLeagues>>["leagues"];
    try {
      leagues = (await readUserLeagues(sleeperUserId)).leagues;
    } catch (err) {
      console.error("[player-news] league lookup failed", err instanceof Error ? err.stack : err);
      return json({ ok: false, error: "Sleeper leagues are temporarily unavailable." }, 502);
    }
    if (leagues.length === 0) {
      return json({
        lastCheckedAt: await readLastCheckedAt(),
        runs: [],
        emptyReason: NO_LEAGUES_REASON,
      });
    }

    let rosters: LeagueRosters[];
    try {
      rosters = await readLeagueRosters(leagues);
    } catch (err) {
      console.error("[player-news] roster lookup failed", err instanceof Error ? err.stack : err);
      return json({ ok: false, error: "Sleeper rosters are temporarily unavailable." }, 502);
    }
    if (rosters.every((league) => league.rosters === null)) {
      return json({ ok: false, error: "Sleeper rosters are temporarily unavailable." }, 502);
    }
    return await readStoredRuns(sleeperUserId, rosters);
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
