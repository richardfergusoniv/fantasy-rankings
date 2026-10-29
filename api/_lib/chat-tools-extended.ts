/**
 * Additional read-only chat tools: news, advanced, projections, value history,
 * lineup/waiver/trade suggestions, and draft info. Prefer dashboard + source_cache.
 */
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Dashboard } from "./dashboard-schemas.js";
import { db, schema } from "./db.js";
import {
  optimizeLineup,
  optimizeTradeRoster,
  optimizeValueTradeRoster,
  eligibleForSlot,
} from "./lineup-optimizer.js";
import {
  positionalNeed,
  scoreStartSit,
  scoreTrade,
  scoreWaiver,
} from "./move-scoring.js";
import { readChartExtrasSnapshot } from "./nflverse-chart-extras.js";
import { isSleeperTimestampOnlyNews, newsPostDedupeKey } from "./player-news-filters.js";
import {
  PLAYER_NEWS_NOTES_SNAPSHOT_KEY,
  parseNotesSnapshot,
  retentionCutoff,
} from "./player-news-shared.js";
import { VALUE_HISTORY_CHART_MIN_DATE } from "./player-value-history.js";
import { loadPropLineWeek } from "./prop-line-week.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";
import { PLAYER_NEWS_SNAPSHOT_KEY } from "./sleeper.js";
import {
  defaultToolLeague,
  findLeague,
  leagueAssets,
  leagueSeasonLongAssets,
  loadBoomBustSummary,
  loadDashboard,
  resolvePlayerIdentity,
  tradeLineupBeforeAfter,
  waiverAdjustments,
  type ChatToolContext,
  type OpenAiToolDefinition,
} from "./chat-tools.js";
import { loadActiveScoringWeights } from "./scoring-jobs.js";

export const EXTENDED_CHAT_TOOL_DEFINITIONS: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_player_news",
      description:
        "Recent player news. Scope: one player, my roster, my opponent, or the whole league. Newest first.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          scope: {
            type: "string",
            enum: ["player", "roster", "opponent", "league"],
            description: "Defaults to roster when leagueId is set; player when playerId/playerName is set",
          },
          playerId: { type: "string" },
          playerName: { type: "string" },
          limit: { type: "number", description: "Max items (default 15, max 30)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_advanced",
      description:
        "Advanced/usage stats and insights for a player (season/rolling analytics, depth, chart extras, Boom/Bust, SOS).",
      parameters: {
        type: "object",
        properties: {
          playerId: { type: "string" },
          playerName: { type: "string" },
          leagueId: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_projections",
      description:
        "This week's and rest-of-season projections for a player or my roster, plus prop lines and recent projection accuracy when available.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          scope: { type: "string", enum: ["player", "roster"] },
          playerId: { type: "string" },
          playerName: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_value_history",
      description:
        "Trade-value trend for a player from stored FantasyCalc snapshots (downsampled; does not backfill from FantasyCalc).",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string", description: "Used to pick the league format key when set" },
          playerId: { type: "string" },
          playerName: { type: "string" },
          formatKey: { type: "string", description: "Optional explicit format key" },
          maxPoints: { type: "number", description: "Max points returned (default 24, max 40)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_lineup",
      description:
        "Optimal start/sit for my team this week. Returns deterministic move-scoring labels and win-the-slot chances — explain them, never change them.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_waivers",
      description:
        "Best available free agents in my league, plus the user's waiver status (FAAB budget remaining, waiver position). Returns deterministic move-scoring labels (Must add / Add / Watch / Pass) per window — explain them, never change them. Pass is hidden from lists unless asked.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          limit: { type: "number", description: "Default 10, max 20" },
          position: { type: "string", description: "Optional position filter e.g. WR" },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_trades",
      description:
        "Trade ideas with deterministic move-scoring labels (Accept / Lean accept / Decline) and fair-trade z bands — explain them, never change them.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          limit: { type: "number", description: "Default 5, max 8" },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_draft_info",
      description: "Owned draft picks and draft-related market context for a league (dynasty-focused).",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
];

function requireLeague(dashboard: Dashboard, leagueId: string) {
  const league = findLeague(dashboard, leagueId);
  if (!league) return null;
  return league;
}

function resolveOptionalPlayerId(
  dashboard: Dashboard,
  args: { playerId?: string; playerName?: string },
): { playerId: string | null; error?: string } {
  const hasArg = Boolean(args.playerId?.trim() || args.playerName?.trim());
  if (!hasArg) return { playerId: null };
  const resolved = resolvePlayerIdentity(dashboard, args);
  if ("error" in resolved) return { playerId: null, error: resolved.error };
  return { playerId: resolved.playerId };
}

function scopePlayerIds(
  dashboard: Dashboard,
  league: Dashboard["leagues"][number],
  scope: "player" | "roster" | "opponent" | "league",
  playerId: string | null,
): string[] {
  if (scope === "player") return playerId ? [playerId] : [];
  if (scope === "roster") {
    return [...league.starters, ...league.bench].map((p) => p.playerId);
  }
  if (scope === "opponent") {
    return (league.opponentTeam?.starters ?? []).map((p) => p.playerId);
  }
  return [...new Set(league.rosteredPlayerIds)].slice(0, 80);
}

async function readSourceCacheValue(cacheKey: string): Promise<unknown | null> {
  const rows = await db
    .select({ payload: schema.sourceCache.payload })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return decodeSourceCachePayload(row.payload);
  } catch {
    return null;
  }
}

export async function toolGetPlayerNews(
  ctx: ChatToolContext,
  args: {
    leagueId?: string;
    scope?: "player" | "roster" | "opponent" | "league";
    playerId?: string;
    playerName?: string;
    limit?: number;
  },
) {
  const dashboard = await loadDashboard(ctx);
  const resolved = resolveOptionalPlayerId(dashboard, args);
  if (resolved.error) return { ok: false as const, error: resolved.error };
  const playerId = resolved.playerId;
  const league = args.leagueId
    ? requireLeague(dashboard, args.leagueId)
    : defaultToolLeague(dashboard, ctx);
  const scope =
    args.scope
    ?? (playerId ? "player" : "roster");
  if ((scope === "roster" || scope === "opponent" || scope === "league") && !league) {
    return { ok: false as const, error: "League not found for this user." };
  }
  if (scope === "player" && !playerId) {
    return { ok: false as const, error: "Provide playerId or playerName for player scope." };
  }

  const ids = league
    ? scopePlayerIds(dashboard, league, scope, playerId)
    : playerId
      ? [playerId]
      : [];
  if (ids.length === 0) return { ok: true as const, items: [], note: "No players in scope." };

  const limit = Math.min(30, Math.max(1, Math.floor(args.limit ?? 15)));
  const cutoff = retentionCutoff();
  const pageSize = scope === "player"
    ? Math.max(limit * 2, 16)
    : Math.max(limit * 4, 32);
  // Bound scanned rows so roundup fan-out cannot exhaust the query budget.
  const maxScan = scope === "player"
    ? pageSize
    : Math.max(limit * 20, 100);
  const newsWhere = and(
    inArray(schema.sharedPlayerNews.playerId, ids),
    or(
      and(
        sql`${schema.sharedPlayerNews.publishedAt} is not null`,
        gte(schema.sharedPlayerNews.publishedAt, cutoff),
      ),
      and(
        sql`${schema.sharedPlayerNews.publishedAt} is null`,
        gte(schema.sharedPlayerNews.createdAt, cutoff),
      ),
    ),
  );

  const seenPost = new Set<string>();
  const items = [];
  let scanned = 0;
  while (items.length < limit && scanned < maxScan) {
    const page = await db
      .select({
        id: schema.sharedPlayerNews.id,
        playerId: schema.sharedPlayerNews.playerId,
        player: schema.sharedPlayerNews.player,
        team: schema.sharedPlayerNews.team,
        change: schema.sharedPlayerNews.change,
        newsType: schema.sharedPlayerNews.newsType,
        roleContext: schema.sharedPlayerNews.roleContext,
        sourceLabel: schema.sharedPlayerNews.sourceLabel,
        sourceUrl: schema.sharedPlayerNews.sourceUrl,
        externalId: schema.sharedPlayerNews.externalId,
        publishedAt: schema.sharedPlayerNews.publishedAt,
        createdAt: schema.sharedPlayerNews.createdAt,
        source: schema.sharedPlayerNews.source,
      })
      .from(schema.sharedPlayerNews)
      .where(newsWhere)
      // Roundup rows share timestamps. Keep offset page boundaries deterministic.
      .orderBy(
        desc(sql`coalesce(${schema.sharedPlayerNews.publishedAt}, ${schema.sharedPlayerNews.createdAt})`),
        desc(schema.sharedPlayerNews.id),
      )
      .limit(Math.min(pageSize, maxScan - scanned))
      .offset(scanned);

    if (page.length === 0) break;
    scanned += page.length;

    for (const row of page) {
      if (isSleeperTimestampOnlyNews(row)) continue;
      // Player-scoped reads keep every row for that player; global scopes
      // collapse a multi-player X roundup to one chat item.
      if (scope !== "player") {
        const postKey = newsPostDedupeKey(row);
        if (seenPost.has(postKey)) continue;
        seenPost.add(postKey);
      }
      items.push({
        playerId: row.playerId,
        player: row.player,
        team: row.team,
        change: row.change,
        newsType: row.newsType,
        sourceLabel: row.sourceLabel,
        sourceUrl: row.sourceUrl,
        publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
        source: row.source,
      });
      if (items.length >= limit) break;
    }
    if (page.length < pageSize) break;
  }

  const injuryRaw = await readSourceCacheValue(PLAYER_NEWS_SNAPSHOT_KEY);
  const notesPayloadRows = await db
    .select({ payload: schema.sourceCache.payload })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_NOTES_SNAPSHOT_KEY))
    .limit(1);
  const notes = parseNotesSnapshot(notesPayloadRows[0]?.payload);
  const injuryByPlayer: Record<string, unknown> = {};
  if (injuryRaw && typeof injuryRaw === "object" && !Array.isArray(injuryRaw)) {
    const map = injuryRaw as Record<string, unknown>;
    for (const id of ids.slice(0, 40)) {
      if (id in map) injuryByPlayer[id] = map[id];
    }
  }
  const notesByPlayer: Record<string, unknown> = {};
  for (const id of ids.slice(0, 40)) {
    if (notes[id]) notesByPlayer[id] = notes[id];
  }

  // Lightweight legacy player_news_items sample for the same ids (newest runs).
  let legacyItems: Array<{ playerId: string; change: string; sourceLabel: string }> = [];
  try {
    const legacy = await db
      .select({
        playerId: schema.playerNewsItems.playerId,
        change: schema.playerNewsItems.change,
        sourceLabel: schema.playerNewsItems.sourceLabel,
        publishedAt: schema.playerNewsItems.sourcePublishedAt,
      })
      .from(schema.playerNewsItems)
      .where(inArray(schema.playerNewsItems.playerId, ids.slice(0, 40)))
      .orderBy(desc(schema.playerNewsItems.sourcePublishedAt))
      .limit(Math.min(10, limit));
    legacyItems = legacy.map((row) => ({
      playerId: row.playerId,
      change: row.change,
      sourceLabel: row.sourceLabel,
    }));
  } catch {
    legacyItems = [];
  }

  return {
    ok: true as const,
    scope,
    leagueId: league?.id ?? null,
    items,
    legacyItems,
    injurySnapshot: injuryByPlayer,
    notesSnapshot: notesByPlayer,
  };
}

export async function toolGetPlayerAdvanced(
  ctx: ChatToolContext,
  args: { playerId?: string; playerName?: string; leagueId?: string },
) {
  const dashboard = await loadDashboard(ctx);
  const resolved = resolvePlayerIdentity(dashboard, args);
  if ("error" in resolved) return { ok: false as const, error: resolved.error };
  const playerId = resolved.playerId;

  const league =
    (args.leagueId ? requireLeague(dashboard, args.leagueId) : null)
    ?? defaultToolLeague(dashboard, ctx, { preferRosterOf: playerId });

  const entity = dashboard.analytics.entities.find((row) => row.id === playerId) ?? null;
  const insights = dashboard.playerInsights;
  const depth = insights.depth[playerId] ?? null;
  const depthPrevious = insights.depthPrevious[playerId] ?? null;
  const sos = league
    ? dashboard.strengthOfSchedule.find((row) => row.leagueId === league.id) ?? null
    : null;
  const weekly = dashboard.rankings.find((row) => row.playerId === playerId) ?? null;
  const team = weekly?.team ?? entity?.team ?? null;
  const position = (weekly?.position ?? entity?.position ?? null) as
    | "QB"
    | "RB"
    | "WR"
    | "TE"
    | "K"
    | null;

  let chartExtras: { player?: unknown; team?: unknown; recentSnaps?: unknown } = {};
  try {
    const extras = await readChartExtrasSnapshot();
    if (extras) {
      chartExtras = {
        player: extras.players[playerId] ?? null,
        team: team ? extras.teams[team] ?? null : null,
        recentSnaps: extras.snaps
          .filter((row) => row.player === (entity?.name ?? weekly?.name) || (team != null && row.team === team && row.position === position))
          .slice(-6),
      };
    }
  } catch {
    chartExtras = {};
  }

  const boomBust =
    league && position && (position === "QB" || position === "RB" || position === "WR" || position === "TE")
      ? await loadBoomBustSummary({
        leagueId: league.id,
        playerId,
        position,
        scoringSettings: league.scoringSettings,
      })
      : { status: "unavailable" as const, reason: "Boom/Bust needs a skill position and league context." };

  const sosForTeam = team && sos && position && (position === "QB" || position === "RB" || position === "WR" || position === "TE")
    ? sos.table[team]?.[position] ?? null
    : null;

  return {
    ok: true as const,
    playerId,
    name: entity?.name ?? weekly?.name ?? args.playerName ?? playerId,
    team,
    position,
    analytics: entity
      ? {
        seasonGames: entity.seasonGames,
        rollingGames: entity.rollingGames,
        season: entity.season,
        rolling17: entity.rolling17,
        weeklyExpected: entity.weeklyExpected.slice(-5),
        weeklySnaps: entity.weeklySnaps.slice(-5),
      }
      : null,
    depth,
    depthPrevious,
    chartExtras,
    strengthOfSchedule: sosForTeam,
    boomBust,
    analyticsAsOf: dashboard.analytics.asOf,
    throughWeek: dashboard.analytics.throughWeek,
  };
}

export async function toolGetProjections(
  ctx: ChatToolContext,
  args: {
    leagueId?: string;
    scope?: "player" | "roster";
    playerId?: string;
    playerName?: string;
  },
) {
  const dashboard = await loadDashboard(ctx);
  const league = args.leagueId
    ? requireLeague(dashboard, args.leagueId)
    : defaultToolLeague(dashboard, ctx);
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const scope = args.scope ?? (args.playerId || args.playerName ? "player" : "roster");
  const resolved = resolveOptionalPlayerId(dashboard, args);
  if (scope === "player" && resolved.error) {
    return { ok: false as const, error: resolved.error };
  }
  const playerId = resolved.playerId;
  const ids =
    scope === "player"
      ? (playerId ? [playerId] : [])
      : [...league.starters, ...league.bench].map((p) => p.playerId);
  if (ids.length === 0) {
    return { ok: false as const, error: scope === "player" ? "Provide playerId or playerName." : "Empty roster." };
  }

  const formatKey = league.seasonLongFormat.key;
  const assets = leagueAssets(dashboard, league.id);
  const valueById = new Map(assets.map((row) => [row.playerId, row]));

  const players = ids.map((id) => {
    const weekly =
      dashboard.rankings.find((row) => row.playerId === id && row.leagueId === league.id)
      ?? dashboard.rankings.find((row) => row.playerId === id)
      ?? null;
    const ros = valueById.get(id) ?? null;
    const roster = [...league.starters, ...league.bench].find((p) => p.playerId === id);
    return {
      playerId: id,
      name: weekly?.name ?? ros?.name ?? roster?.name ?? id,
      position: weekly?.position ?? ros?.position ?? roster?.position ?? null,
      team: weekly?.team ?? ros?.team ?? roster?.team ?? null,
      week: weekly
        ? {
          leagueProjection: weekly.leagueProjection,
          vegasProjection: weekly.vegasProjection,
          sleeperProjection: weekly.sleeperProjection,
          projectionSource: weekly.projectionSource,
          opponent: weekly.opponent,
          isBye: weekly.isBye,
        }
        : {
          leagueProjection: roster?.projection ?? null,
          vegasProjection: null,
          sleeperProjection: null,
          projectionSource: roster?.projectionSource ?? null,
          opponent: roster?.opponent ?? null,
          isBye: roster?.isBye ?? false,
        },
      restOfSeason: ros
        ? { value: ros.value, overallRank: ros.overallRank, positionRank: ros.positionRank, trend30Day: ros.trend30Day }
        : null,
    };
  });

  let propLines: unknown[] = [];
  try {
    const weekProps = await loadPropLineWeek({ season: dashboard.season, week: dashboard.week });
    const idSet = new Set(ids);
    propLines = weekProps.lines.filter((line) => idSet.has(line.playerId)).slice(0, 40);
  } catch {
    propLines = [];
  }

  let accuracy: unknown[] = [];
  try {
    accuracy = await db
      .select({
        playerId: schema.projectionAccuracy.playerId,
        week: schema.projectionAccuracy.week,
        vegasProjection: schema.projectionAccuracy.vegasProjection,
        firstDownProjection: schema.projectionAccuracy.firstDownProjection,
        actualScore: schema.projectionAccuracy.actualScore,
      })
      .from(schema.projectionAccuracy)
      .where(
        and(
          eq(schema.projectionAccuracy.leagueId, league.id),
          eq(schema.projectionAccuracy.season, dashboard.season),
          inArray(schema.projectionAccuracy.playerId, ids.slice(0, 30)),
        ),
      )
      .orderBy(desc(schema.projectionAccuracy.week))
      .limit(40);
  } catch {
    accuracy = [];
  }

  return {
    ok: true as const,
    season: dashboard.season,
    week: dashboard.week,
    leagueId: league.id,
    formatKey,
    scope,
    players,
    propLines,
    projectionAccuracy: accuracy,
  };
}

function downsamplePoints<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const out: T[] = [];
  const last = points.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const index = i === maxPoints - 1 ? last : Math.round((i * last) / (maxPoints - 1));
    const point = points[index];
    if (point !== undefined) out.push(point);
  }
  return out;
}

export async function toolGetValueHistory(
  ctx: ChatToolContext,
  args: {
    leagueId?: string;
    playerId?: string;
    playerName?: string;
    formatKey?: string;
    maxPoints?: number;
  },
) {
  const dashboard = await loadDashboard(ctx);
  const resolved = resolvePlayerIdentity(dashboard, args);
  if ("error" in resolved) return { ok: false as const, error: resolved.error };
  const playerId = resolved.playerId;

  const league = args.leagueId
    ? requireLeague(dashboard, args.leagueId)
    : defaultToolLeague(dashboard, ctx, { preferRosterOf: playerId });
  const formatKey = args.formatKey?.trim() || league?.seasonLongFormat.key;
  if (!formatKey) return { ok: false as const, error: "formatKey or leagueId required." };

  const maxPoints = Math.min(40, Math.max(4, Math.floor(args.maxPoints ?? 24)));
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      snapshotDate: schema.playerValueSnapshots.snapshotDate,
      playerName: schema.playerValueSnapshots.playerName,
      position: schema.playerValueSnapshots.position,
      value: schema.playerValueSnapshots.value,
    })
    .from(schema.playerValueSnapshots)
    .where(
      and(
        eq(schema.playerValueSnapshots.formatKey, formatKey),
        eq(schema.playerValueSnapshots.playerId, playerId),
        gte(schema.playerValueSnapshots.snapshotDate, VALUE_HISTORY_CHART_MIN_DATE),
        lte(schema.playerValueSnapshots.snapshotDate, today),
      ),
    )
    .orderBy(asc(schema.playerValueSnapshots.snapshotDate))
    .limit(400);

  if (rows.length === 0) {
    return {
      ok: true as const,
      playerId,
      formatKey,
      points: [],
      note: "No stored value snapshots for this player/format.",
    };
  }

  const latest = rows[rows.length - 1]!;
  const points = downsamplePoints(
    rows.map((row) => ({ date: row.snapshotDate, value: row.value })),
    maxPoints,
  );
  const first = points[0];
  const last = points[points.length - 1];
  return {
    ok: true as const,
    playerId,
    name: latest.playerName,
    position: latest.position,
    formatKey,
    points,
    change: first && last ? last.value - first.value : null,
  };
}

export async function toolSuggestLineup(ctx: ChatToolContext, args: { leagueId: string }) {
  const dashboard = await loadDashboard(ctx);
  const league = requireLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const before = {
    starters: league.starters.map((p) => ({ ...p })),
    bench: league.bench.map((p) => ({ ...p })),
  };
  const optimized = optimizeLineup(before.starters, before.bench);
  const beforeIds = before.starters.map((p) => p.playerId);
  const afterIds = optimized.starters.map((p) => p.playerId);
  const sit = before.starters.filter((p) => !afterIds.includes(p.playerId) && p.playerId !== "0");
  const start = optimized.starters.filter((p) => !beforeIds.includes(p.playerId) && p.playerId !== "0");

  const beforeProj = before.starters.reduce((sum, p) => sum + (p.projection ?? 0), 0);
  const afterProj = optimized.starters.reduce((sum, p) => sum + (p.projection ?? 0), 0);

  const rankingById = new Map(
    dashboard.rankings
      .filter((row) => row.leagueId === league.id)
      .map((row) => [row.playerId, row]),
  );

  const weights = await loadActiveScoringWeights();
  const toScored = (player: (typeof league.starters)[number]) => {
    const ranking = rankingById.get(player.playerId);
    return {
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      team: player.team,
      // Spec: V is league-scored projection. Omit usage so blend uses no-history (w_v=1).
      vegasProjection: ranking?.leagueProjection ?? player.projection,
      injuryStatus: player.injuryStatus,
      isBye: ranking?.isBye ?? player.isBye,
      gamePhase: player.gamePhase,
      actual: player.actual,
      projection: player.projection,
    };
  };

  const swaps = start.map((incoming, index) => {
    const outgoing = sit[index] ?? null;
    const slot = incoming.lineupSlot ?? incoming.position;
    const alternative =
      outgoing
      ?? optimized.bench.find((bench) => eligibleForSlot(bench.position, slot))
      ?? null;
    const scored = scoreStartSit({
      player: toScored(incoming),
      alternative: alternative ? toScored(alternative) : null,
      weights,
    });
    return {
      start: {
        playerId: incoming.playerId,
        name: incoming.name,
        position: incoming.position,
        slot: incoming.lineupSlot,
        projection: incoming.projection,
      },
      sit: outgoing
        ? {
          playerId: outgoing.playerId,
          name: outgoing.name,
          position: outgoing.position,
          slot: outgoing.lineupSlot,
          projection: outgoing.projection,
        }
        : null,
      scoring: scored.week,
      reason: `${scored.week.label} (${scored.week.score}): ${scored.week.reasons[0]?.effect ?? incoming.name}`,
    };
  });

  return {
    ok: true as const,
    leagueId: league.id,
    week: dashboard.week,
    scoringWindow: "week" as const,
    note: "Labels and scores are from move-scoring. Explain them; do not re-rank.",
    currentStarterProjection: Number(beforeProj.toFixed(2)),
    optimizedStarterProjection: Number(afterProj.toFixed(2)),
    projectionDelta: Number((afterProj - beforeProj).toFixed(2)),
    swaps,
    optimizedStarters: optimized.starters.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      slot: p.lineupSlot,
      projection: p.projection,
    })),
  };
}

export async function toolSuggestWaivers(
  ctx: ChatToolContext,
  args: { leagueId: string; limit?: number; position?: string },
) {
  const dashboard = await loadDashboard(ctx);
  const league = requireLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const limit = Math.min(20, Math.max(1, Math.floor(args.limit ?? 10)));
  const rostered = new Set(league.rosteredPlayerIds);
  const seasonLongAssets = leagueSeasonLongAssets(dashboard, league.id);
  const dynastyAssets = league.seasonLongFormat.isDynasty
    ? leagueAssets(dashboard, league.id)
    : seasonLongAssets;
  const seasonLongValueById = new Map(seasonLongAssets.map((row) => [row.playerId, row.value]));
  const dynastyValueById = new Map(dynastyAssets.map((row) => [row.playerId, row.value]));
  const valueById = seasonLongValueById;
  const weights = await loadActiveScoringWeights();

  const myByPos = new Map<string, number>();
  for (const player of [...league.starters, ...league.bench]) {
    myByPos.set(player.position, (myByPos.get(player.position) ?? 0) + (valueById.get(player.playerId) ?? 0));
  }
  const power = league.powerRankingsSeasonLong.find((row) => row.isUser)
    ?? league.powerRankingsWeek.find((row) => row.isUser)
    ?? null;
  const weakPositions = power
    ? (["QB", "RB", "WR", "TE"] as const)
      .map((pos) => ({ pos, value: power.positionValues[pos] }))
      .sort((a, b) => a.value - b.value)
      .slice(0, 2)
      .map((row) => row.pos)
    : ["RB", "WR"];

  const pool = (league.tradeWaiverPool.length > 0
    ? league.tradeWaiverPool
    : dashboard.rankings
      .filter((row) => row.leagueId === league.id && !rostered.has(row.playerId))
      .map((row) => ({
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        projection: row.leagueProjection,
        injuryStatus: row.injuryStatus,
      })))
    .filter((player) => !rostered.has(player.playerId))
    .filter((player) => !args.position || player.position === args.position.toUpperCase());

  const slots = league.tradeStarterSlots.length > 0
    ? league.tradeStarterSlots
    : league.starters.map((p) => p.lineupSlot ?? p.position);
  const rosterPlayers = [...league.starters, ...league.bench].map((p) => ({ ...p }));
  const baseline = optimizeTradeRoster(rosterPlayers, slots);
  const baselineScore = baseline.score;
  const baselineSl = optimizeValueTradeRoster(rosterPlayers, slots, seasonLongValueById);
  const baselineDy = league.seasonLongFormat.isDynasty
    ? optimizeValueTradeRoster(rosterPlayers, slots, dynastyValueById)
    : null;

  // Drop candidate: lowest-value bench player not in this week's best lineup.
  const bestIds = new Set(baseline.starters.map((p) => p.playerId));
  const dropCandidate = [...league.bench]
    .filter((p) => p.playerId !== "0" && !bestIds.has(p.playerId))
    .map((p) => ({ player: p, value: valueById.get(p.playerId) ?? 0 }))
    .sort((a, b) => a.value - b.value)[0] ?? null;

  const powerRows = league.powerRankingsSeasonLong.length > 0
    ? league.powerRankingsSeasonLong
    : league.powerRankingsWeek;
  const myPower = powerRows.find((row) => row.isUser) ?? null;
  const medians: Record<string, number> = {};
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const values = powerRows.map((row) => row.positionValues[pos]).sort((a, b) => a - b);
    medians[pos] = values.length ? values[Math.floor(values.length / 2)]! : 0;
  }

  // One window for every row and the response (dynasty only when the league supports it).
  const waiverWindowKey: "week" | "season_long" | "dynasty" =
    ctx.scoringWindow === "dynasty" && league.seasonLongFormat.isDynasty
      ? "dynasty"
      : ctx.scoringWindow === "season_long"
        ? "season_long"
        : "week";

  const scored = pool.map((player) => {
    const weekly =
      dashboard.rankings.find((row) => row.playerId === player.playerId && row.leagueId === league.id)
      ?? dashboard.rankings.find((row) => row.playerId === player.playerId);
    const projection = weekly?.leagueProjection ?? player.projection ?? 0;
    const value = valueById.get(player.playerId) ?? 0;
    const position = weekly?.position ?? player.position;

    const withAdd = [
      ...rosterPlayers.filter((p) => !dropCandidate || p.playerId !== dropCandidate.player.playerId),
      {
        playerId: player.playerId,
        name: weekly?.name ?? player.name,
        position,
        lineupSlot: null,
        isStarter: false,
        projection,
        actual: null,
        injuryStatus: player.injuryStatus ?? null,
      },
    ];
    const after = optimizeTradeRoster(withAdd, slots);
    const afterSl = optimizeValueTradeRoster(withAdd, slots, seasonLongValueById);
    const afterDy = baselineDy
      ? optimizeValueTradeRoster(withAdd, slots, dynastyValueById)
      : null;
    const need = myPower
      ? positionalNeed(myPower.positionValues[position as "QB" | "RB" | "WR" | "TE"] ?? 0, medians[position] ?? 0)
      : 0;
    const sumValues = (
      players: ReadonlyArray<{ playerId: string }>,
      map: Map<string, number>,
    ) => players.reduce((sum, p) => sum + (map.get(p.playerId) ?? 0), 0);

    const move = scoreWaiver({
      addName: weekly?.name ?? player.name,
      dropName: dropCandidate?.player.name ?? null,
      addPosition: position,
      needPos: need,
      isDynasty: league.seasonLongFormat.isDynasty,
      week: { lineupBefore: baselineScore, lineupAfter: after.score },
      seasonLong: {
        starterValueBefore: Math.max(1, baselineSl.score),
        starterValueAfter: afterSl.score,
        benchValueBefore: sumValues(baselineSl.bench, seasonLongValueById),
        benchValueAfter: sumValues(afterSl.bench, seasonLongValueById),
      },
      dynasty: baselineDy && afterDy
        ? {
          starterValueBefore: Math.max(1, baselineDy.score),
          starterValueAfter: afterDy.score,
          benchValueBefore: sumValues(baselineDy.bench, dynastyValueById),
          benchValueAfter: sumValues(afterDy.bench, dynastyValueById),
        }
        : undefined,
      weights,
    });

    const primary = waiverWindowKey === "dynasty" && move.dynasty
      ? move.dynasty
      : waiverWindowKey === "season_long"
        ? move.seasonLong
        : move.week;

    return {
      playerId: player.playerId,
      name: weekly?.name ?? player.name,
      position,
      team: weekly?.team ?? player.team,
      projection,
      value,
      dropCandidate: dropCandidate
        ? {
          playerId: dropCandidate.player.playerId,
          name: dropCandidate.player.name,
          value: valueById.get(dropCandidate.player.playerId) ?? 0,
        }
        : null,
      scoring: move,
      primaryWindow: waiverWindowKey,
      primaryLabel: primary.label,
      primaryScore: primary.score,
      // Hide Pass from default lists (spec); still returned when explicitly asked later.
      hidden: primary.label === "Pass",
      reason: `${primary.label} (${primary.score}): ${primary.reasons[0]?.effect ?? ""}`,
    };
  });

  const ranked = scored
    .sort((a, b) => b.primaryScore - a.primaryScore || b.projection - a.projection);
  // Pass is hidden from default waiver lists; keep the top Pass rows only when
  // nothing stronger is available so the tool still has something to explain.
  const nonPass = ranked.filter((row) => !row.hidden);
  const visible = (nonPass.length > 0 ? nonPass : ranked).slice(0, limit);

  return {
    ok: true as const,
    leagueId: league.id,
    week: dashboard.week,
    scoringWindow: waiverWindowKey,
    // FAAB budget / waiver priority, so bids and timing can be advised.
    waivers: league.waivers ?? null,
    note: "Labels and scores are from move-scoring. Explain them; do not re-rank. Pass adds are omitted from lists unless nothing stronger is available or the user asks.",
    weakPositions,
    suggestions: visible,
  };
}

export async function toolSuggestTrades(
  ctx: ChatToolContext,
  args: { leagueId: string; limit?: number },
) {
  const dashboard = await loadDashboard(ctx);
  const league = requireLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const limit = Math.min(8, Math.max(1, Math.floor(args.limit ?? 5)));
  const seasonLongAssets = leagueSeasonLongAssets(dashboard, league.id);
  const dynastyAssets = league.seasonLongFormat.isDynasty
    ? leagueAssets(dashboard, league.id)
    : seasonLongAssets;
  const valueById = new Map(seasonLongAssets.map((row) => [row.playerId, row]));
  const dynastyValueById = new Map(dynastyAssets.map((row) => [row.playerId, row.value]));
  const seasonLongValueById = new Map(seasonLongAssets.map((row) => [row.playerId, row.value]));
  const weights = await loadActiveScoringWeights();
  const me = league.tradeTeams.find((team) => team.isUser);
  if (!me) return { ok: false as const, error: "User roster not found in this league." };

  const tradeWindowKey: "week" | "season_long" | "dynasty" =
    ctx.scoringWindow === "week"
      ? "week"
      : ctx.scoringWindow === "dynasty" && league.seasonLongFormat.isDynasty
        ? "dynasty"
        : "season_long";

  const power = league.powerRankingsSeasonLong.length > 0
    ? league.powerRankingsSeasonLong
    : league.powerRankingsWeek;
  const myPower = power.find((row) => row.isUser) ?? null;
  const skillPositions = ["QB", "RB", "WR", "TE"] as const;

  const myNeeds = myPower
    ? [...skillPositions].sort((a, b) => myPower.positionValues[a] - myPower.positionValues[b])
    : (["RB", "WR"] as const);

  const mySurplus = myPower
    ? [...skillPositions].sort((a, b) => myPower.positionValues[b] - myPower.positionValues[a])
    : (["WR", "RB"] as const);

  type Asset = { playerId: string; name: string; position: string; value: number; teamName: string };
  const myAssets: Asset[] = me.players
    .map((player) => {
      const asset = valueById.get(player.playerId);
      if (!asset) return null;
      return {
        playerId: player.playerId,
        name: player.name,
        position: player.position,
        value: asset.value,
        teamName: me.teamName,
      };
    })
    .filter((row): row is Asset => row != null)
    .sort((a, b) => b.value - a.value);

  const ideas: Array<{
    partner: string;
    give: Asset[];
    get: Asset[];
    giveTotal: number;
    getTotal: number;
    adjustedGive: number;
    adjustedGet: number;
    margin: number;
    scoring: ReturnType<typeof scoreTrade>;
    primaryLabel: string;
    primaryScore: number;
    reason: string;
  }> = [];

  for (const partner of league.tradeTeams.filter((team) => !team.isUser)) {
    const partnerPower = power.find((row) => row.rosterId === partner.rosterId) ?? null;
    const partnerNeeds = partnerPower
      ? [...skillPositions].sort((a, b) => partnerPower.positionValues[a] - partnerPower.positionValues[b])
      : mySurplus;
    const theirAssets: Asset[] = partner.players
      .map((player) => {
        const asset = valueById.get(player.playerId);
        if (!asset) return null;
        return {
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          value: asset.value,
          teamName: partner.teamName,
        };
      })
      .filter((row): row is Asset => row != null)
      .sort((a, b) => b.value - a.value);

    const givePool = myAssets.filter(
      (asset) => asset.position === mySurplus[0] || asset.position === partnerNeeds[0],
    );
    const getPool = theirAssets.filter(
      (asset) => asset.position === myNeeds[0] || asset.position === myNeeds[1],
    );
    let best: {
      give: Asset;
      get: Asset;
      ratio: number;
    } | null = null;
    for (const giveCandidate of givePool) {
      for (const getCandidate of getPool) {
        if (giveCandidate.playerId === getCandidate.playerId) continue;
        const denom = Math.max(giveCandidate.value, getCandidate.value, 1);
        const ratio = Math.abs(getCandidate.value - giveCandidate.value) / denom;
        if (ratio > 0.35) continue;
        if (!best || ratio < best.ratio) {
          best = { give: giveCandidate, get: getCandidate, ratio };
        }
      }
    }
    if (!best) continue;

    const give = [best.give];
    const get = [best.get];
    const remap = (
      rows: Asset[],
      map: Map<string, number>,
      fallbackToBoard: boolean,
    ) => rows.map((row) => ({
      ...row,
      value: map.get(row.playerId) ?? (fallbackToBoard ? row.value : 0),
    }));
    const windowTotals = (map: Map<string, number>, fallbackToBoard: boolean) => {
      const giveRows = remap(give, map, fallbackToBoard);
      const getRows = remap(get, map, fallbackToBoard);
      const giveTotal = giveRows.reduce((sum, row) => sum + row.value, 0);
      const getTotal = getRows.reduce((sum, row) => sum + row.value, 0);
      const adjustment = waiverAdjustments(giveRows, getRows);
      return {
        giveRows,
        getRows,
        giveTotal,
        getTotal,
        adjustedGive: giveTotal + adjustment.give,
        adjustedGet: getTotal + adjustment.get,
      };
    };
    const seasonLongTotals = windowTotals(
      seasonLongValueById,
      !league.seasonLongFormat.isDynasty,
    );
    const dynastyTotals = league.seasonLongFormat.isDynasty
      ? windowTotals(dynastyValueById, true)
      : null;
    // Display totals use Season Long (redraft twin) values.
    const giveTotal = seasonLongTotals.giveTotal;
    const getTotal = seasonLongTotals.getTotal;
    const adjustedGive = seasonLongTotals.adjustedGive;
    const adjustedGet = seasonLongTotals.adjustedGet;
    const margin = adjustedGet - adjustedGive;
    const myRank = myPower?.rank ?? 1;
    const giveIds = new Set(give.map((row) => row.playerId));
    const fillsHole = best.get.position === myNeeds[0];
    const projectionById = new Map(
      dashboard.rankings
        .filter((row) => row.leagueId === league.id)
        .map((row) => [row.playerId, row.leagueProjection]),
    );
    for (const player of me.players) {
      if (!projectionById.has(player.playerId)) {
        projectionById.set(player.playerId, player.projection);
      }
    }
    const slots = league.tradeStarterSlots.length > 0
      ? league.tradeStarterSlots
      : league.starters.map((p) => p.lineupSlot ?? p.position);
    const rosterPlayers = me.players.map((player) => ({
      playerId: player.playerId,
      name: player.name,
      position: player.position,
      lineupSlot: player.lineupSlot,
      isStarter: player.isStarter,
      projection: player.projection ?? projectionById.get(player.playerId) ?? null,
      actual: player.actual,
    }));
    const incoming = get.map((asset) => ({
      playerId: asset.playerId,
      name: asset.name,
      position: asset.position,
      lineupSlot: null as string | null,
      isStarter: false,
      projection: projectionById.get(asset.playerId) ?? null,
      actual: null as number | null,
    }));
    const lineup = tradeLineupBeforeAfter({
      roster: rosterPlayers,
      slots,
      giveIds,
      incoming,
    });
    const afterPlayers = [
      ...rosterPlayers.filter((player) => !giveIds.has(player.playerId)),
      ...incoming,
    ];
    const slBefore = optimizeValueTradeRoster(rosterPlayers, slots, seasonLongValueById);
    const slAfter = optimizeValueTradeRoster(afterPlayers, slots, seasonLongValueById);
    const dyBefore = dynastyTotals
      ? optimizeValueTradeRoster(rosterPlayers, slots, dynastyValueById)
      : null;
    const dyAfter = dynastyTotals
      ? optimizeValueTradeRoster(afterPlayers, slots, dynastyValueById)
      : null;
    const move = scoreTrade({
      week: {
        yourLineupBefore: lineup.before,
        yourLineupAfter: lineup.after,
      },
      seasonLong: {
        give: seasonLongTotals.giveRows,
        get: seasonLongTotals.getRows,
        yourStarterValueBefore: Math.max(1, slBefore.score),
        yourStarterValueAfter: slAfter.score,
        yourPowerRankBefore: myRank,
        yourPowerRankAfter: margin >= 0 ? Math.max(1, myRank - 1) : myRank + 1,
        fillsHole,
      },
      dynasty: dynastyTotals && dyBefore && dyAfter
        ? {
          give: dynastyTotals.giveRows,
          get: dynastyTotals.getRows,
          yourStarterValueBefore: Math.max(1, dyBefore.score),
          yourStarterValueAfter: dyAfter.score,
          yourPowerRankBefore: myRank,
          yourPowerRankAfter: (dynastyTotals.adjustedGet - dynastyTotals.adjustedGive) >= 0
            ? Math.max(1, myRank - 1)
            : myRank + 1,
          fillsHole,
        }
        : undefined,
      isDynasty: league.seasonLongFormat.isDynasty,
      weights,
    });
    const primary =
      tradeWindowKey === "week"
        ? move.week
        : tradeWindowKey === "dynasty" && move.dynasty
          ? move.dynasty
          : move.seasonLong;
    ideas.push({
      partner: partner.teamName,
      give,
      get,
      giveTotal,
      getTotal,
      adjustedGive,
      adjustedGet,
      margin,
      scoring: move,
      primaryLabel: primary.label,
      primaryScore: primary.score,
      reason: `${primary.label} (${primary.score}): ${primary.reasons[0]?.effect ?? ""}`,
    });
  }

  ideas.sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin) || b.getTotal - a.getTotal);

  return {
    ok: true as const,
    leagueId: league.id,
    formatKey: league.seasonLongFormat.key,
    scoringWindow: tradeWindowKey,
    note: "Labels and scores are from move-scoring. Explain them; do not re-rank.",
    myNeeds,
    mySurplus,
    suggestions: ideas.slice(0, limit),
  };
}

export async function toolGetDraftInfo(ctx: ChatToolContext, args: { leagueId: string }) {
  const dashboard = await loadDashboard(ctx);
  const league = requireLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const me = league.tradeTeams.find((team) => team.isUser);
  const ownedPicks = (me?.ownedPicks ?? []).map((pick) => ({
    playerId: pick.playerId,
    name: pick.name,
    value: pick.value,
    overallRank: pick.overallRank,
    positionRank: pick.positionRank,
  }));

  const marketPicks = dashboard.seasonLongRankings
    .filter((row) => row.formatKey === league.seasonLongFormat.key && row.position === "PICK")
    .slice(0, 24)
    .map((row) => ({
      playerId: row.playerId,
      name: row.name,
      value: row.value,
      overallRank: row.overallRank,
    }));

  let draftMarket: unknown = null;
  try {
    const rows = await db
      .select({
        cacheKey: schema.sourceCache.cacheKey,
        payload: schema.sourceCache.payload,
        fetchedAt: schema.sourceCache.fetchedAt,
      })
      .from(schema.sourceCache)
      .where(sql`${schema.sourceCache.cacheKey} like ${"draft-market-signals-v1:%"}`)
      .orderBy(desc(schema.sourceCache.fetchedAt))
      .limit(1);
    const row = rows[0];
    if (row) {
      draftMarket = {
        cacheKey: row.cacheKey,
        fetchedAt: row.fetchedAt.toISOString(),
        payload: decodeSourceCachePayload(row.payload),
      };
    }
  } catch {
    draftMarket = null;
  }

  return {
    ok: true as const,
    leagueId: league.id,
    isDynasty: league.seasonLongFormat.isDynasty,
    formatKey: league.seasonLongFormat.key,
    ownedPicks,
    marketPickBoard: marketPicks,
    draftMarket,
  };
}

const newsSchema = z
  .object({
    leagueId: z.string().min(1).max(80).optional(),
    scope: z.enum(["player", "roster", "opponent", "league"]).optional(),
    playerId: z.string().min(1).max(80).optional(),
    playerName: z.string().min(1).max(120).optional(),
    limit: z.number().int().positive().max(30).optional(),
  })
  .strict();
const playerScopeSchema = z
  .object({
    playerId: z.string().min(1).max(80).optional(),
    playerName: z.string().min(1).max(120).optional(),
    leagueId: z.string().min(1).max(80).optional(),
  })
  .strict();
const projectionsSchema = z
  .object({
    leagueId: z.string().min(1).max(80).optional(),
    scope: z.enum(["player", "roster"]).optional(),
    playerId: z.string().min(1).max(80).optional(),
    playerName: z.string().min(1).max(120).optional(),
  })
  .strict();
const valueHistorySchema = z
  .object({
    leagueId: z.string().min(1).max(80).optional(),
    playerId: z.string().min(1).max(80).optional(),
    playerName: z.string().min(1).max(120).optional(),
    formatKey: z.string().min(1).max(80).optional(),
    maxPoints: z.number().int().positive().max(40).optional(),
  })
  .strict();
const leagueOnlySchema = z.object({ leagueId: z.string().min(1).max(80) }).strict();
const waiversSchema = z
  .object({
    leagueId: z.string().min(1).max(80),
    limit: z.number().int().positive().max(20).optional(),
    position: z.string().min(1).max(8).optional(),
  })
  .strict();
const tradesSuggestSchema = z
  .object({
    leagueId: z.string().min(1).max(80),
    limit: z.number().int().positive().max(8).optional(),
  })
  .strict();

export async function dispatchExtendedChatTool(
  name: string,
  rawArgs: unknown,
  ctx: ChatToolContext,
): Promise<unknown | null> {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  switch (name) {
    case "get_player_news": {
      const parsed = newsSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetPlayerNews(ctx, parsed.data);
    }
    case "get_player_advanced": {
      const parsed = playerScopeSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetPlayerAdvanced(ctx, parsed.data);
    }
    case "get_projections": {
      const parsed = projectionsSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetProjections(ctx, parsed.data);
    }
    case "get_value_history": {
      const parsed = valueHistorySchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetValueHistory(ctx, parsed.data);
    }
    case "suggest_lineup": {
      const parsed = leagueOnlySchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolSuggestLineup(ctx, parsed.data);
    }
    case "suggest_waivers": {
      const parsed = waiversSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolSuggestWaivers(ctx, parsed.data);
    }
    case "suggest_trades": {
      const parsed = tradesSuggestSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolSuggestTrades(ctx, parsed.data);
    }
    case "get_draft_info": {
      const parsed = leagueOnlySchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetDraftInfo(ctx, parsed.data);
    }
    default:
      return null;
  }
}
