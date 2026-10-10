import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  forbidden,
  hasCronSecret,
  internalError,
  json,
  unauthorized,
} from "./_lib/api-utils.js";
import { resolveSleeperUserId } from "./_lib/auth.js";
import { db, schema } from "./_lib/db.js";
import {
  PLAYER_NEWS_NOTES_SNAPSHOT_KEY,
  buildInjuryNotesDraft,
  buildInjuryStatusDraft,
  buildNewsUpdatedDraft,
  filterDuplicateDrafts,
  normalizeNewsUpdated,
  parseNotesSnapshot,
  retentionCutoff,
  type NotesSnapshot,
  type SharedNewsDraft,
} from "./_lib/player-news-shared.js";
import {
  PLAYER_NEWS_SNAPSHOT_KEY,
  REFRESH_TIMEOUT_MS,
  SLEEPER_BASE,
  fetchJson,
  parseInjurySnapshot,
  weeklyAvailabilityStatus,
  withDeadline,
  type SleeperPlayer,
} from "./_lib/sleeper.js";
import { readNflState } from "./_lib/user-leagues.js";

/**
 * /api/player-news
 *
 * GET  — shared player news (last 30 days). Auth required for signed-in reads.
 *        A cron-secret GET runs the refresh instead.
 * POST — cron-secret refresh.
 *
 * Refresh diffs Sleeper injury_status, injury_notes, and news_updated for
 * fantasy players league-wide into `shared_player_news` (deduped by URL /
 * external id). Clients filter the ticker by the signed-in user's roster in
 * the selected league; player cards show all shared rows for that player.
 */

const PLAYER_NEWS_CHECK_KEY = "player-news-last-check-v1";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

type InjuryPlayer = {
  playerId: string;
  player: string;
  team: string;
  injuryStatus: string | null;
  injuryNotes: string | null;
  newsUpdated: string | null;
};

export type PlayerNews = {
  lastCheckedAt: string | null;
  runs: Array<{
    id: string;
    checkedAt: string;
    items: Array<{
      id: string;
      playerId: string;
      player: string;
      team: string;
      change: string;
      leagueIds: string[];
      newsType: "roster" | "waiver" | "headline";
      leagues: string[];
      availability: Array<{
        leagueId: string;
        league: string;
        status: "available" | "your_roster" | "other_roster" | "unknown";
      }>;
      roleContext: string;
      sourceLabel: string;
      sourceUrl: string;
      sourcePublishedAt: string | null;
      author: string | null;
      source: "sleeper" | "x" | "nflverse";
      signal: string | null;
      score: number | null;
    }>;
  }>;
  emptyReason: string | null;
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

async function purgeExpiredNews(now = new Date()): Promise<number> {
  const cutoff = retentionCutoff(now);
  const deleted = await db
    .delete(schema.sharedPlayerNews)
    .where(
      or(
        and(
          sql`${schema.sharedPlayerNews.publishedAt} is not null`,
          lt(schema.sharedPlayerNews.publishedAt, cutoff),
        ),
        and(
          isNull(schema.sharedPlayerNews.publishedAt),
          lt(schema.sharedPlayerNews.createdAt, cutoff),
        ),
      ),
    )
    .returning({ id: schema.sharedPlayerNews.id });
  return deleted.length;
}

async function insertSharedDrafts(drafts: SharedNewsDraft[]): Promise<number> {
  const unique = filterDuplicateDrafts(drafts);
  if (unique.length === 0) return 0;
  let inserted = 0;
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100).map((draft) => ({
      id: draft.id,
      playerId: draft.playerId,
      player: draft.player,
      team: draft.team,
      change: draft.change,
      newsType: draft.newsType,
      roleContext: draft.roleContext,
      source: draft.source,
      sourceLabel: draft.sourceLabel,
      sourceUrl: draft.sourceUrl,
      author: draft.author,
      externalId: draft.externalId,
      publishedAt: draft.publishedAt,
      signal: draft.signal,
      score: draft.score,
      createdAt: new Date(),
    }));
    const result = await db
      .insert(schema.sharedPlayerNews)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: schema.sharedPlayerNews.id });
    inserted += result.length;
  }
  return inserted;
}

async function readStoredNews(): Promise<Response> {
  const cutoff = retentionCutoff();
  const rows = await db
    .select()
    .from(schema.sharedPlayerNews)
    .where(
      or(
        and(
          sql`${schema.sharedPlayerNews.publishedAt} is not null`,
          gt(schema.sharedPlayerNews.publishedAt, cutoff),
        ),
        and(
          isNull(schema.sharedPlayerNews.publishedAt),
          gt(schema.sharedPlayerNews.createdAt, cutoff),
        ),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${schema.sharedPlayerNews.publishedAt}, ${schema.sharedPlayerNews.createdAt})`),
    )
    .limit(500);

  const lastCheckedAt = await readLastCheckedAt();
  const checkedAt = lastCheckedAt ?? new Date().toISOString();
  const items = rows.map((item) => ({
    id: item.id,
    playerId: item.playerId,
    player: item.player,
    team: item.team,
    change: item.change,
    leagueIds: [] as string[],
    newsType: item.newsType as "roster" | "waiver" | "headline",
    leagues: [] as string[],
    availability: [] as PlayerNews["runs"][number]["items"][number]["availability"],
    roleContext: item.roleContext,
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    sourcePublishedAt: item.publishedAt?.toISOString() ?? item.createdAt.toISOString(),
    author: item.author,
    source: item.source as "sleeper" | "x" | "nflverse",
    signal: item.signal,
    score: item.score,
  }));

  return json({
    lastCheckedAt,
    runs: items.length > 0
      ? [{ id: "shared", checkedAt, items }]
      : [],
    emptyReason: null,
  } satisfies PlayerNews);
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
      injuryNotes: player.injury_notes?.trim() || null,
      newsUpdated: normalizeNewsUpdated(player.news_updated),
    }];
  });
  return { active: true, season: state.season, week: state.week, players: rosteredPlayers };
}

async function runRefresh(): Promise<Response> {
  let context: Awaited<ReturnType<typeof buildInjuryUniverse>>;
  try {
    context = await withDeadline(buildInjuryUniverse(), REFRESH_TIMEOUT_MS);
  } catch {
    return json({ ok: false, worked: false, error: "Sleeper player data is temporarily unavailable." }, 502);
  }
  if (!context.active) {
    return json({
      ok: true,
      worked: true,
      queued: false,
      reason: "Player-news checks are paused outside the regular season and playoffs.",
    });
  }

  const [statusRows, notesRows] = await Promise.all([
    db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_SNAPSHOT_KEY)).limit(1),
    db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_NOTES_SNAPSHOT_KEY)).limit(1),
  ]);
  const previousStatus = parseInjurySnapshot(statusRows[0]?.payload);
  const previousNotes = parseNotesSnapshot(notesRows[0]?.payload);

  const checkedAt = new Date();
  const drafts: SharedNewsDraft[] = [];
  const nextStatus: Record<string, string | null> = {};
  const nextNotes: NotesSnapshot = {};
  const hasPriorStatus = Object.keys(previousStatus).length > 0;
  const hasPriorNotes = Object.keys(previousNotes).length > 0;

  for (const player of context.players) {
    nextStatus[player.playerId] = player.injuryStatus;
    nextNotes[player.playerId] = {
      injuryNotes: player.injuryNotes,
      newsUpdated: player.newsUpdated,
    };

    if (
      hasPriorStatus
      && player.playerId in previousStatus
      && previousStatus[player.playerId] !== player.injuryStatus
    ) {
      drafts.push(buildInjuryStatusDraft({
        playerId: player.playerId,
        player: player.player,
        team: player.team,
        previousStatus: previousStatus[player.playerId] ?? null,
        nextStatus: player.injuryStatus,
        checkedAt,
      }));
    }

    if (!hasPriorNotes) continue;

    const priorNotes = previousNotes[player.playerId] ?? {
      injuryNotes: null,
      newsUpdated: null,
    };
    const notesDraft = buildInjuryNotesDraft({
      playerId: player.playerId,
      player: player.player,
      team: player.team,
      previousNotes: priorNotes.injuryNotes,
      nextNotes: player.injuryNotes,
      newsUpdated: player.newsUpdated,
      checkedAt,
    });
    if (notesDraft) {
      drafts.push(notesDraft);
      continue;
    }

    const updatedDraft = buildNewsUpdatedDraft({
      playerId: player.playerId,
      player: player.player,
      team: player.team,
      previousUpdated: priorNotes.newsUpdated,
      nextUpdated: player.newsUpdated,
      injuryNotes: player.injuryNotes,
      checkedAt,
    });
    if (updatedDraft) drafts.push(updatedDraft);
  }

  const inserted = await insertSharedDrafts(drafts);
  const purged = await purgeExpiredNews(checkedAt);

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_SNAPSHOT_KEY,
    payload: JSON.stringify(nextStatus),
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: JSON.stringify(nextStatus), fetchedAt: checkedAt },
  });

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_NOTES_SNAPSHOT_KEY,
    payload: JSON.stringify(nextNotes),
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: JSON.stringify(nextNotes), fetchedAt: checkedAt },
  });

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_CHECK_KEY,
    payload: JSON.stringify({ checkedAt: checkedAt.toISOString() }),
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: JSON.stringify({ checkedAt: checkedAt.toISOString() }), fetchedAt: checkedAt },
  });

  const runKey = `player-news-${checkedAt.toISOString()}`;
  await db.insert(schema.playerNewsRuns).values({
    id: runKey,
    checkedAt,
    itemCount: inserted,
  }).onConflictDoUpdate({
    target: schema.playerNewsRuns.id,
    set: { checkedAt, itemCount: inserted },
  });

  return json({
    ok: true,
    worked: true,
    queued: true,
    runKey,
    week: context.week,
    candidates: drafts.length,
    inserted,
    purged,
  });
}

export async function GET(req: Request): Promise<Response> {
  try {
    if (hasCronSecret(req)) {
      return await runRefresh();
    }
    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");
    return await readStoredNews();
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
