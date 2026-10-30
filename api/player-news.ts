import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
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
  DYNASTY_NEWS_TAG,
  isSleeperTimestampOnlyNews,
  takeNewsRowsForPostLimit,
} from "./_lib/player-news-filters.js";
import {
  PLAYER_NEWS_NOTES_SNAPSHOT_KEY,
  buildInjuryNotesDraft,
  buildInjuryStatusDraft,
  filterDuplicateDrafts,
  normalizeNewsUpdated,
  parseNotesSnapshot,
  retentionCutoff,
  type NotesSnapshot,
  type SharedNewsDraft,
} from "./_lib/player-news-shared.js";
import { loadNflPlayersMap } from "./_lib/nfl-players-cache.js";
import {
  PLAYER_NEWS_SNAPSHOT_KEY,
  REFRESH_TIMEOUT_MS,
  parseInjurySnapshot,
  weeklyAvailabilityStatus,
  withDeadline,
  type SleeperPlayer,
} from "./_lib/sleeper.js";
import { encodeSourceCachePayload } from "./_lib/source-cache-payload.js";
import { readNflState } from "./_lib/user-leagues.js";

/**
 * /api/player-news
 *
 * GET  — shared player news (last 30 days). Auth required for signed-in reads.
 *        A cron-secret GET runs the refresh instead.
 * POST — cron-secret refresh.
 *
 * Refresh diffs Sleeper injury_status and injury_notes for fantasy players
 * league-wide into `shared_player_news` (deduped by URL+player /
 * external id+player). Timestamp-only news_updated pings are not created;
 * legacy rows are filtered on read. Clients filter the ticker by the
 * signed-in user's roster in the selected league (and collapse multi-player
 * X roundups by post); player cards show all shared rows for that player.
 */

const PLAYER_NEWS_CHECK_KEY = "player-news-last-check-v1";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
/** Distinct posts returned to signed-in clients (player rows for those posts stay). */
const SHARED_NEWS_POST_LIMIT = 500;
/** Row scan cap so multi-player roundups do not shrink the post window too far. */
const SHARED_NEWS_ROW_SCAN = 2500;

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
      /** Null for team/league-scoped X rows. */
      playerId: string | null;
      player: string;
      /** Null for league-scoped X rows. */
      team: string | null;
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
      /** X post_id / Sleeper external id — used by global feeds to group roundups. */
      externalId: string | null;
      source: "sleeper" | "x" | "nflverse" | "article";
      signal: string | null;
      score: number | null;
      /** e.g. `["dynasty"]` — redraft clients hide dynasty-tagged rows. */
      tags: string[];
      /** player (default) | team | league. */
      scope: "player" | "team" | "league";
    }>;
  }>;
  emptyReason: string | null;
};

/** Redraft (default) hides dynasty-tagged rows at query time. */
function dynastyTagVisibilitySql(isDynastyContext: boolean) {
  if (isDynastyContext) return undefined;
  return sql`NOT (${DYNASTY_NEWS_TAG} = ANY(${schema.sharedPlayerNews.tags}))`;
}

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
      tags: draft.tags,
      scope: draft.scope,
      createdAt: new Date(),
    }));
    const result = await db
      .insert(schema.sharedPlayerNews)
      .values(chunk)
      // Bare ON CONFLICT covers both (source_url, player_id) and
      // (source, external_id, player_id) unique indexes.
      .onConflictDoNothing()
      .returning({ id: schema.sharedPlayerNews.id });
    inserted += result.length;
  }
  return inserted;
}

async function readStoredNews(isDynastyContext: boolean): Promise<Response> {
  const cutoff = retentionCutoff();
  const tagVisibility = dynastyTagVisibilitySql(isDynastyContext);
  const newsSelect = {
    id: schema.sharedPlayerNews.id,
    playerId: schema.sharedPlayerNews.playerId,
    player: schema.sharedPlayerNews.player,
    team: schema.sharedPlayerNews.team,
    change: schema.sharedPlayerNews.change,
    newsType: schema.sharedPlayerNews.newsType,
    roleContext: schema.sharedPlayerNews.roleContext,
    sourceLabel: schema.sharedPlayerNews.sourceLabel,
    sourceUrl: schema.sharedPlayerNews.sourceUrl,
    publishedAt: schema.sharedPlayerNews.publishedAt,
    createdAt: schema.sharedPlayerNews.createdAt,
    author: schema.sharedPlayerNews.author,
    externalId: schema.sharedPlayerNews.externalId,
    source: schema.sharedPlayerNews.source,
    signal: schema.sharedPlayerNews.signal,
    score: schema.sharedPlayerNews.score,
    tags: schema.sharedPlayerNews.tags,
    scope: schema.sharedPlayerNews.scope,
  };
  const retentionWhere = and(
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
    ...(tagVisibility ? [tagVisibility] : []),
  );
  const orderByRecency = desc(
    sql`coalesce(${schema.sharedPlayerNews.publishedAt}, ${schema.sharedPlayerNews.createdAt})`,
  );
  // Scan article rows separately so high article volume cannot push Sleeper/X
  // posts out of the shared recency window.
  const [primaryRows, articleRows] = await Promise.all([
    db
      .select(newsSelect)
      .from(schema.sharedPlayerNews)
      .where(and(retentionWhere, ne(schema.sharedPlayerNews.source, "article")))
      .orderBy(orderByRecency)
      .limit(SHARED_NEWS_ROW_SCAN),
    db
      .select(newsSelect)
      .from(schema.sharedPlayerNews)
      .where(and(retentionWhere, eq(schema.sharedPlayerNews.source, "article")))
      .orderBy(orderByRecency)
      .limit(SHARED_NEWS_ROW_SCAN),
  ]);
  const rows = [...primaryRows, ...articleRows].sort((a, b) => {
    const aMs = (a.publishedAt ?? a.createdAt).getTime();
    const bMs = (b.publishedAt ?? b.createdAt).getTime();
    return bMs - aMs;
  });

  const lastCheckedAt = await readLastCheckedAt();
  const checkedAt = lastCheckedAt ?? new Date().toISOString();
  // Bound by distinct posts so a 15-player roundup does not crowd older news
  // out of the 500-post window; keep every player row for selected posts.
  // Team/league X rows are included for the ticker; player cards filter by
  // player_id / scope client-side.
  const items = takeNewsRowsForPostLimit(
    rows.filter((item) => !isSleeperTimestampOnlyNews(item)),
    SHARED_NEWS_POST_LIMIT,
  ).map((item) => ({
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
    externalId: item.externalId,
    source: item.source as "sleeper" | "x" | "nflverse" | "article",
    signal: item.signal,
    score: item.score,
    tags: item.tags ?? [],
    scope: (item.scope ?? "player") as "player" | "team" | "league",
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
  // Force refresh so injury status tracks Sleeper at least as often as the cron.
  const players = await loadNflPlayersMap(true);
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
    if (notesDraft) drafts.push(notesDraft);
  }

  const inserted = await insertSharedDrafts(drafts);
  const purged = await purgeExpiredNews(checkedAt);

  const statusPayload = encodeSourceCachePayload(nextStatus);
  const notesPayload = encodeSourceCachePayload(nextNotes);
  const checkPayload = encodeSourceCachePayload({ checkedAt: checkedAt.toISOString() });

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_SNAPSHOT_KEY,
    payload: statusPayload,
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: statusPayload, fetchedAt: checkedAt },
  });

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_NOTES_SNAPSHOT_KEY,
    payload: notesPayload,
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: notesPayload, fetchedAt: checkedAt },
  });

  await db.insert(schema.sourceCache).values({
    cacheKey: PLAYER_NEWS_CHECK_KEY,
    payload: checkPayload,
    fetchedAt: checkedAt,
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload: checkPayload, fetchedAt: checkedAt },
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
    // ?dynasty=1 → dynasty league context (include dynasty-tagged rows).
    // Missing / other values → redraft (default when no league context).
    const url = new URL(req.url, "https://localhost");
    const isDynastyContext = url.searchParams.get("dynasty") === "1";
    return await readStoredNews(isDynastyContext);
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
