/**
 * Chat tools. Prefer the signed-in user's dashboard cache and
 * existing source_cache / shared news tables. Preference tools write
 * only to chat_preferences (see chat-preferences.ts).
 */
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Dashboard } from "./dashboard-schemas.js";
import { loadOrBuildUserDashboard, readUserDashboardCache } from "./dashboard-build.js";
import { db, schema } from "./db.js";
import { isSleeperTimestampOnlyNews } from "./player-news-filters.js";
import { retentionCutoff } from "./player-news-shared.js";
import {
  BOOM_BUST_SEASONS,
  buildBoomBustSeries,
  hasSleeperGameParticipation,
  loadSleeperPlayerWeeklySeason,
  scoreProjectedPlayerStats,
  sleeperActualStats,
} from "./sleeper.js";
import {
  optimizeTradeRoster,
  optimizeValueTradeRoster,
  type OptimizablePlayer,
} from "./lineup-optimizer.js";
import { scoreTrade } from "./move-scoring.js";
import { redraftTwinFormat } from "./season-long-format.js";
import { loadActiveScoringWeights } from "./scoring-jobs.js";
import { loadHistoricalTrades } from "./trades.js";
import {
  dispatchPreferenceChatTool,
  PREFERENCE_CHAT_TOOL_DEFINITIONS,
} from "./chat-preferences.js";
import {
  dispatchExtendedChatTool,
  EXTENDED_CHAT_TOOL_DEFINITIONS,
} from "./chat-tools-extended.js";

/** Week N lineup scores + optimized boards before/after a trade. */
export function tradeLineupBeforeAfter<T extends OptimizablePlayer>(args: {
  roster: T[];
  slots: string[];
  giveIds: ReadonlySet<string>;
  incoming: ReadonlyArray<T>;
}) {
  const beforeRoster = optimizeTradeRoster(args.roster, args.slots);
  const afterPlayers = [
    ...args.roster.filter((player) => !args.giveIds.has(player.playerId)),
    ...args.incoming,
  ];
  const afterRoster = optimizeTradeRoster(afterPlayers, args.slots);
  return {
    before: beforeRoster.score,
    after: afterRoster.score,
    beforeRoster,
    afterRoster,
  };
}

export type ChatToolContext = {
  userId: string;
  sleeperUserId: string;
  /** Lazy dashboard promise shared across tool calls in one question. */
  dashboardPromise?: Promise<Dashboard>;
  /** Ranking window the user is viewing — drives which score the model explains. */
  scoringWindow?: "week" | "season_long" | "dynasty";
};

export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const CHAT_TOOL_DEFINITIONS: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_my_leagues",
      description:
        "List the signed-in user's leagues with roster players, FantasyCalc values, and this week's projections.",
      parameters: {
        type: "object",
        properties: {
          leagueId: {
            type: "string",
            description: "Optional Sleeper league id. Omit to return every league.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_card",
      description:
        "Player card: values, weekly/season projections, Boom/Bust summary, and recent news. Prefer playerId when known.",
      parameters: {
        type: "object",
        properties: {
          playerId: { type: "string", description: "Sleeper player id" },
          playerName: { type: "string", description: "Player name to search when id is unknown" },
          leagueId: { type: "string", description: "Optional league for scoring / boom-bust context" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_power_rankings",
      description:
        "Power rankings for a league (weekly, season-long, or dynasty), including league-average totals.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          horizon: {
            type: "string",
            enum: ["week", "season_long", "dynasty"],
            description: "Defaults to week",
          },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trade_history",
      description: "Recent completed trades for a league (uses the app's cached trade history).",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          season: { type: "number", description: "Optional season filter" },
          limit: { type: "number", description: "Max trades to return (default 15, max 40)" },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_trade",
      description:
        "Evaluate a two-sided trade with deterministic move-scoring labels and fair-trade z bands. Explain the scores; never change them.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          givePlayerIds: {
            type: "array",
            items: { type: "string" },
            description: "Assets the user would send",
          },
          getPlayerIds: {
            type: "array",
            items: { type: "string" },
            description: "Assets the user would receive",
          },
        },
        required: ["leagueId", "givePlayerIds", "getPlayerIds"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_week_matchup",
      description: "This week's projections and matchup for the user's team in a league (starters, bench, opponent).",
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
  ...EXTENDED_CHAT_TOOL_DEFINITIONS,
  ...PREFERENCE_CHAT_TOOL_DEFINITIONS,
];

export const CHAT_TOOL_NAMES = CHAT_TOOL_DEFINITIONS.map((tool) => tool.function.name);

const WAIVER_VALUE_FRACTION = 0.6982;
const WAIVER_SPOT_CAP = 753;
const WAIVER_SPOT_CAP_STEP = 0.23;

/** FantasyCalc waiver-spot credit used by the trade calculator UI. */
export function waiverAdjustments(
  give: ReadonlyArray<{ value: number }>,
  get: ReadonlyArray<{ value: number }>,
): { give: number; get: number } {
  if (give.length === 0 || get.length === 0 || give.length === get.length) {
    return { give: 0, get: 0 };
  }
  const fewerIsGive = give.length < get.length;
  const more = fewerIsGive ? get : give;
  const gap = Math.abs(give.length - get.length);
  const cheapest = [...more].sort((a, b) => a.value - b.value).slice(0, gap);
  const credit = cheapest.reduce(
    (sum, asset, index) =>
      sum
      + Math.floor(
        Math.min(asset.value * WAIVER_VALUE_FRACTION, WAIVER_SPOT_CAP + index * WAIVER_SPOT_CAP_STEP),
      ),
    0,
  );
  return fewerIsGive ? { give: credit, get: 0 } : { give: 0, get: credit };
}

export async function loadDashboard(ctx: ChatToolContext): Promise<Dashboard> {
  if (!ctx.dashboardPromise) {
    ctx.dashboardPromise = (async () => {
      const cached = await readUserDashboardCache(ctx.sleeperUserId);
      if (cached?.dashboard) return cached.dashboard;
      const built = await loadOrBuildUserDashboard(ctx.sleeperUserId, false);
      return built.dashboard;
    })();
  }
  return ctx.dashboardPromise;
}

export function findLeague(dashboard: Dashboard, leagueId: string) {
  return dashboard.leagues.find((league) => league.id === leagueId) ?? null;
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function leagueAssets(dashboard: Dashboard, leagueId: string) {
  const league = findLeague(dashboard, leagueId);
  if (!league) return [];
  const formatKey = league.seasonLongFormat.key;
  return dashboard.seasonLongRankings.filter((row) => row.formatKey === formatKey);
}

/** Season Long values: redraft twin in dynasty leagues, else the league format. */
export function leagueSeasonLongAssets(dashboard: Dashboard, leagueId: string) {
  const league = findLeague(dashboard, leagueId);
  if (!league) return [];
  if (!league.seasonLongFormat.isDynasty) return leagueAssets(dashboard, leagueId);
  const twinKey = redraftTwinFormat(league.seasonLongFormat).key;
  // Never fall back to dynasty values — an empty twin board means zeros.
  return dashboard.seasonLongRankings.filter((row) => row.formatKey === twinKey);
}

function rosterPlayerSummary(
  player: {
    playerId: string;
    name: string;
    team: string | null;
    position: string;
    projection: number | null;
    injuryStatus: string | null;
    isStarter: boolean;
  },
  valueById: Map<string, number>,
) {
  return {
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    position: player.position,
    projection: player.projection,
    value: valueById.get(player.playerId) ?? null,
    injuryStatus: player.injuryStatus,
    isStarter: player.isStarter,
  };
}

async function toolGetMyLeagues(ctx: ChatToolContext, args: { leagueId?: string }) {
  const dashboard = await loadDashboard(ctx);
  const leagues = args.leagueId
    ? dashboard.leagues.filter((league) => league.id === args.leagueId)
    : dashboard.leagues;
  if (leagues.length === 0) {
    return { ok: false as const, error: args.leagueId ? "League not found for this user." : "No leagues on the dashboard." };
  }
  return {
    ok: true as const,
    season: dashboard.season,
    week: dashboard.week,
    leagues: leagues.map((league) => {
      const assets = leagueAssets(dashboard, league.id);
      const valueById = new Map(assets.map((row) => [row.playerId, row.value]));
      const userTeam = league.tradeTeams.find((team) => team.isUser);
      const roster = [...league.starters, ...league.bench].map((player) =>
        rosterPlayerSummary(player, valueById),
      );
      const picks = (userTeam?.ownedPicks ?? []).map((pick) => ({
        playerId: pick.playerId,
        name: pick.name,
        position: "PICK" as const,
        value: pick.value,
      }));
      return {
        leagueId: league.id,
        name: league.name,
        scoringLabel: league.scoringLabel,
        isDynasty: league.seasonLongFormat.isDynasty,
        record: league.record,
        teamProjection: league.teamProjection,
        teamActual: league.teamActual,
        roster,
        ownedPicks: picks,
      };
    }),
  };
}

async function loadPlayerNews(playerId: string, limit = 8) {
  try {
    const cutoff = retentionCutoff();
    const rows = await db
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
        publishedAt: schema.sharedPlayerNews.publishedAt,
        createdAt: schema.sharedPlayerNews.createdAt,
        source: schema.sharedPlayerNews.source,
      })
      .from(schema.sharedPlayerNews)
      .where(
        and(
          eq(schema.sharedPlayerNews.playerId, playerId),
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
        ),
      )
      .orderBy(desc(sql`coalesce(${schema.sharedPlayerNews.publishedAt}, ${schema.sharedPlayerNews.createdAt})`))
      .limit(Math.max(limit * 2, 16));

    return rows
      .filter((row) => !isSleeperTimestampOnlyNews(row))
      .slice(0, limit)
      .map((row) => ({
        change: row.change,
        newsType: row.newsType,
        sourceLabel: row.sourceLabel,
        sourceUrl: row.sourceUrl,
        publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
        source: row.source,
      }));
  } catch {
    return [];
  }
}

export async function loadBoomBustSummary(args: {
  leagueId: string;
  playerId: string;
  position: "QB" | "RB" | "WR" | "TE";
  scoringSettings: Record<string, number> | undefined;
}) {
  if (!args.scoringSettings) {
    return { status: "unavailable" as const, reason: "League scoring settings missing from dashboard." };
  }
  try {
    const seasons = BOOM_BUST_SEASONS.slice(0, 1);
    const results = await Promise.allSettled(
      seasons.map(async (season) => ({
        season,
        rows: await loadSleeperPlayerWeeklySeason(args.playerId, season),
      })),
    );
    const games: Array<{ season: number; week: number; points: number }> = [];
    for (const [index, result] of results.entries()) {
      const season = seasons[index];
      if (season === undefined || result.status === "rejected") continue;
      for (const row of result.value.rows) {
        const week = Number(row.week);
        if (!Number.isInteger(week) || week < 1 || week > 18 || !hasSleeperGameParticipation(row)) continue;
        games.push({
          season,
          week,
          points: scoreProjectedPlayerStats(args.position, sleeperActualStats(row), args.scoringSettings),
        });
      }
    }
    if (games.length === 0) return { status: "unavailable" as const, reason: "No scored weekly games found." };
    const series = buildBoomBustSeries(games, "ok");
    return {
      status: series.status,
      floor: series.floor,
      median: series.median,
      mean: series.mean,
      ceiling: series.ceiling,
      games: games.length,
    };
  } catch {
    return { status: "unavailable" as const, reason: "Boom/Bust could not be loaded." };
  }
}

function findRosterPlayer(
  dashboard: Dashboard,
  playerId: string,
): { playerId: string; name: string; team: string | null; position: string; injuryStatus: string | null } | null {
  for (const league of dashboard.leagues) {
    for (const player of [...league.starters, ...league.bench]) {
      if (player.playerId === playerId) {
        return {
          playerId: player.playerId,
          name: player.name,
          team: player.team,
          position: player.position,
          injuryStatus: player.injuryStatus,
        };
      }
    }
    for (const team of league.tradeTeams) {
      for (const player of team.players) {
        if (player.playerId === playerId) {
          return {
            playerId: player.playerId,
            name: player.name,
            team: player.team,
            position: player.position,
            injuryStatus: player.injuryStatus,
          };
        }
      }
    }
  }
  return null;
}

export function resolvePlayerIdentity(
  dashboard: Dashboard,
  args: { playerId?: string; playerName?: string },
): { playerId: string; nameHint: string | null } | { error: string } {
  const trimmedId = args.playerId?.trim() || "";
  const needle = args.playerName ? normalizeName(args.playerName) : "";
  if (!trimmedId && !needle) {
    return { error: "Provide playerId or playerName." };
  }

  if (trimmedId) {
    const rankingHit =
      dashboard.rankings.find((row) => row.playerId === trimmedId)
      ?? dashboard.seasonLongRankings.find((row) => row.playerId === trimmedId && row.position !== "PICK");
    if (rankingHit) return { playerId: rankingHit.playerId, nameHint: rankingHit.name };
    const rosterHit = findRosterPlayer(dashboard, trimmedId);
    if (rosterHit) return { playerId: rosterHit.playerId, nameHint: rosterHit.name };
    if (dashboard.leagues.some((league) => league.rosteredPlayerIds.includes(trimmedId))) {
      return { playerId: trimmedId, nameHint: null };
    }
    return { error: "Player not found." };
  }

  const byName =
    dashboard.rankings.find((row) => normalizeName(row.name).includes(needle))
    ?? dashboard.seasonLongRankings.find(
      (row) => row.position !== "PICK" && normalizeName(row.name).includes(needle),
    );
  if (byName) return { playerId: byName.playerId, nameHint: byName.name };

  for (const league of dashboard.leagues) {
    for (const player of [...league.starters, ...league.bench]) {
      if (normalizeName(player.name).includes(needle)) {
        return { playerId: player.playerId, nameHint: player.name };
      }
    }
  }
  return { error: "Player not found." };
}

async function toolGetPlayerCard(
  ctx: ChatToolContext,
  args: { playerId?: string; playerName?: string; leagueId?: string },
) {
  const dashboard = await loadDashboard(ctx);
  const resolved = resolvePlayerIdentity(dashboard, args);
  if ("error" in resolved) return { ok: false as const, error: resolved.error };
  const playerId = resolved.playerId;

  const league =
    (args.leagueId ? findLeague(dashboard, args.leagueId) : null)
    ?? dashboard.leagues.find((item) => item.rosteredPlayerIds.includes(playerId))
    ?? dashboard.leagues[0]
    ?? null;

  const weekly =
    (league
      ? dashboard.rankings.find((row) => row.playerId === playerId && row.leagueId === league.id)
      : undefined)
    ?? dashboard.rankings.find((row) => row.playerId === playerId)
    ?? dashboard.weeklyChartRankings.find((row) => row.playerId === playerId)
    ?? null;
  const seasonRows = dashboard.seasonLongRankings.filter(
    (row) => row.playerId === playerId && row.position !== "PICK",
  );
  const roster = findRosterPlayer(dashboard, playerId);
  const trending = dashboard.playerTrending[playerId] ?? null;

  const position = (weekly?.position ?? seasonRows[0]?.position ?? roster?.position ?? null) as
    | "QB"
    | "RB"
    | "WR"
    | "TE"
    | "K"
    | null;
  const boomBust =
    league && position && (position === "QB" || position === "RB" || position === "WR" || position === "TE")
      ? await loadBoomBustSummary({
        leagueId: league.id,
        playerId,
        position,
        scoringSettings: league.scoringSettings,
      })
      : { status: "unavailable" as const, reason: "Boom/Bust needs a skill position and league context." };

  const news = await loadPlayerNews(playerId);

  return {
    ok: true as const,
    playerId,
    name: weekly?.name ?? seasonRows[0]?.name ?? roster?.name ?? resolved.nameHint ?? args.playerName ?? playerId,
    team: weekly?.team ?? seasonRows[0]?.team ?? roster?.team ?? null,
    position: weekly?.position ?? seasonRows[0]?.position ?? roster?.position ?? null,
    injuryStatus: weekly?.injuryStatus ?? roster?.injuryStatus ?? null,
    weekly: weekly
      ? {
        leagueProjection: weekly.leagueProjection,
        vegasProjection: weekly.vegasProjection,
        sleeperProjection: weekly.sleeperProjection,
        projectionSource: weekly.projectionSource,
        leagueRank: weekly.leagueRank,
        opponent: weekly.opponent,
        isBye: weekly.isBye,
      }
      : null,
    seasonLongValues: seasonRows.map((row) => ({
      formatKey: row.formatKey,
      value: row.value,
      overallRank: row.overallRank,
      positionRank: row.positionRank,
      trend30Day: row.trend30Day,
    })),
    trending,
    boomBust,
    news,
    leagueId: league?.id ?? null,
  };
}

function powerAverage(rows: Dashboard["leagues"][number]["powerRankingsWeek"]) {
  if (rows.length === 0) {
    return { totalValue: null, futurePickValue: null, positionValues: null as null | Record<string, number> };
  }
  const positionKeys = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"] as const;
  const positionValues = Object.fromEntries(
    positionKeys.map((key) => [
      key,
      rows.reduce((sum, row) => sum + row.positionValues[key], 0) / rows.length,
    ]),
  ) as Record<(typeof positionKeys)[number], number>;
  return {
    totalValue: rows.reduce((sum, row) => sum + row.totalValue, 0) / rows.length,
    futurePickValue: rows.reduce((sum, row) => sum + row.futurePickValue, 0) / rows.length,
    positionValues,
  };
}

async function toolGetPowerRankings(
  ctx: ChatToolContext,
  args: { leagueId: string; horizon?: "week" | "season_long" | "dynasty" },
) {
  const dashboard = await loadDashboard(ctx);
  const league = findLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };
  const horizon = args.horizon ?? "week";
  const rows =
    horizon === "week"
      ? league.powerRankingsWeek
      : horizon === "dynasty"
        ? league.powerRankingsDynasty
        : league.powerRankingsSeasonLong;
  if (rows.length === 0) {
    return {
      ok: true as const,
      leagueId: league.id,
      name: league.name,
      horizon,
      teams: [],
      leagueAverage: null,
      note: "No power rankings available for this horizon.",
    };
  }
  return {
    ok: true as const,
    leagueId: league.id,
    name: league.name,
    horizon,
    teams: [...rows]
      .sort((a, b) => a.rank - b.rank)
      .map((row) => ({
        rank: row.rank,
        teamName: row.teamName,
        record: row.record,
        totalValue: row.totalValue,
        futurePickValue: row.futurePickValue,
        positionValues: row.positionValues,
        isUser: row.isUser,
      })),
    leagueAverage: powerAverage(rows),
  };
}

async function toolGetTradeHistory(
  ctx: ChatToolContext,
  args: { leagueId: string; season?: number; limit?: number },
) {
  const dashboard = await loadDashboard(ctx);
  if (!findLeague(dashboard, args.leagueId)) {
    return { ok: false as const, error: "League not found for this user." };
  }
  const limit = Math.min(40, Math.max(1, Math.floor(args.limit ?? 15)));
  const history = await loadHistoricalTrades(args.leagueId, false, ctx.sleeperUserId, args.season);
  return {
    ok: true as const,
    leagueId: args.leagueId,
    seasons: history.seasons,
    asOf: history.asOf,
    trades: history.trades.slice(0, limit).map((trade) => ({
      id: trade.id,
      season: trade.season,
      week: trade.week,
      createdAt: trade.createdAt,
      teams: trade.teams.map((team) => ({
        teamName: team.teamName,
        isUserTeam: team.isUserTeam,
        players: team.assets.players.map((player) => ({
          name: player.name,
          position: player.position,
        })),
        picks: team.assets.picks.map((pick) => ({
          description: pick.description,
          season: pick.season,
          round: pick.round,
        })),
        faabReceived: team.assets.faabReceived,
      })),
    })),
    sourceErrors: history.sourceErrors,
  };
}

async function resolveTradeAssets(
  dashboard: Dashboard,
  leagueId: string,
  playerIds: string[],
) {
  const assets = leagueAssets(dashboard, leagueId);
  const byId = new Map(assets.map((row) => [row.playerId, row]));
  const league = findLeague(dashboard, leagueId);
  const ownedPicks = league?.tradeTeams.flatMap((team) => team.ownedPicks) ?? [];
  for (const pick of ownedPicks) byId.set(pick.playerId, pick);

  const resolved: Array<{ playerId: string; name: string; position: string; value: number }> = [];
  const missing: string[] = [];
  for (const id of playerIds) {
    const hit = byId.get(id);
    if (!hit) {
      missing.push(id);
      continue;
    }
    resolved.push({
      playerId: hit.playerId,
      name: hit.name,
      position: hit.position,
      value: hit.value,
    });
  }
  return { resolved, missing };
}

async function toolEvaluateTrade(
  ctx: ChatToolContext,
  args: { leagueId: string; givePlayerIds: string[]; getPlayerIds: string[] },
) {
  const dashboard = await loadDashboard(ctx);
  const league = findLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };

  const give = await resolveTradeAssets(dashboard, args.leagueId, args.givePlayerIds);
  const get = await resolveTradeAssets(dashboard, args.leagueId, args.getPlayerIds);
  if (give.missing.length || get.missing.length) {
    return {
      ok: false as const,
      error: "Some assets were not found in this league's value board.",
      missing: [...give.missing, ...get.missing],
    };
  }
  if (give.resolved.length === 0 || get.resolved.length === 0) {
    return { ok: false as const, error: "Both sides need at least one valued asset." };
  }

  const slots = league.tradeStarterSlots.length > 0
    ? league.tradeStarterSlots
    : league.starters.map((p) => p.lineupSlot ?? p.position);
  const giveIds = new Set(args.givePlayerIds);
  const projectionById = new Map(
    dashboard.rankings
      .filter((row) => row.leagueId === league.id)
      .map((row) => [row.playerId, row.leagueProjection]),
  );
  for (const player of [...league.starters, ...league.bench]) {
    if (!projectionById.has(player.playerId)) projectionById.set(player.playerId, player.projection);
  }
  const myPlayers = [...league.starters, ...league.bench].map((p) => ({
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    lineupSlot: p.lineupSlot,
    isStarter: p.isStarter,
    projection: p.projection ?? projectionById.get(p.playerId) ?? null,
    actual: p.actual,
  }));
  const incoming = get.resolved.map((asset) => ({
    playerId: asset.playerId,
    name: asset.name,
    position: asset.position,
    lineupSlot: null as string | null,
    isStarter: false,
    projection: projectionById.get(asset.playerId) ?? null,
    actual: null as number | null,
  }));
  const lineup = tradeLineupBeforeAfter({
    roster: myPlayers,
    slots,
    giveIds,
    incoming,
  });
  const afterPlayers = [
    ...myPlayers.filter((p) => !giveIds.has(p.playerId)),
    ...incoming,
  ];

  const seasonLongAssets = leagueSeasonLongAssets(dashboard, league.id);
  const dynastyAssets = league.seasonLongFormat.isDynasty
    ? leagueAssets(dashboard, league.id)
    : [];
  const seasonLongValue = new Map(seasonLongAssets.map((row) => [row.playerId, row.value]));
  const dynastyValue = new Map(dynastyAssets.map((row) => [row.playerId, row.value]));
  const toWindowAssets = (
    rows: typeof give.resolved,
    valueMap: Map<string, number>,
    /** When false, missing twin-board rows (picks, deep players) are 0 — never dynasty values. */
    fallbackToBoard: boolean,
  ) => rows.map((row) => ({
    playerId: row.playerId,
    name: row.name,
    position: row.position,
    value: valueMap.get(row.playerId) ?? (fallbackToBoard ? row.value : 0),
  }));
  const windowSide = (valueMap: Map<string, number>, fallbackToBoard: boolean) => {
    const giveRows = toWindowAssets(give.resolved, valueMap, fallbackToBoard);
    const getRows = toWindowAssets(get.resolved, valueMap, fallbackToBoard);
    const giveTotal = giveRows.reduce((sum, row) => sum + row.value, 0);
    const getTotal = getRows.reduce((sum, row) => sum + row.value, 0);
    const adjustment = waiverAdjustments(giveRows, getRows);
    // Spec: StarterValue fills slots by value (not Week N projections).
    const valueBefore = optimizeValueTradeRoster(myPlayers, slots, valueMap);
    const valueAfter = optimizeValueTradeRoster(afterPlayers, slots, valueMap);
    return {
      giveRows,
      getRows,
      giveTotal,
      getTotal,
      adjustment,
      giveAdjusted: giveTotal + adjustment.give,
      getAdjusted: getTotal + adjustment.get,
      starterBefore: Math.max(1, valueBefore.score),
      starterAfter: valueAfter.score,
    };
  };
  // Season Long in dynasty leagues must not fall back to dynasty board values.
  const seasonLongSide = windowSide(seasonLongValue, !league.seasonLongFormat.isDynasty);
  const dynastySide = league.seasonLongFormat.isDynasty ? windowSide(dynastyValue, true) : null;

  // Display totals use Season Long (redraft twin) values.
  const giveTotal = seasonLongSide.giveTotal;
  const getTotal = seasonLongSide.getTotal;
  const adjustment = seasonLongSide.adjustment;
  const giveAdjusted = seasonLongSide.giveAdjusted;
  const getAdjusted = seasonLongSide.getAdjusted;
  const margin = getAdjusted - giveAdjusted;

  const power = league.powerRankingsSeasonLong.length > 0
    ? league.powerRankingsSeasonLong
    : league.powerRankingsWeek;
  const myPower = power.find((row) => row.isUser);
  const myRankBefore = myPower?.rank ?? 1;
  const myRankAfter = margin >= 0 ? Math.max(1, myRankBefore - 1) : myRankBefore + 1;
  const weights = await loadActiveScoringWeights();
  const weakPos = myPower
    ? (["QB", "RB", "WR", "TE"] as const)
      .slice()
      .sort((a, b) => myPower.positionValues[a] - myPower.positionValues[b])[0]
    : null;
  const fillsHole = weakPos != null
    && get.resolved.some((asset) => asset.position === weakPos);

  const move = scoreTrade({
    week: {
      yourLineupBefore: lineup.before,
      yourLineupAfter: lineup.after,
    },
    seasonLong: {
      give: seasonLongSide.giveRows,
      get: seasonLongSide.getRows,
      yourStarterValueBefore: seasonLongSide.starterBefore,
      yourStarterValueAfter: seasonLongSide.starterAfter,
      yourPowerRankBefore: myRankBefore,
      yourPowerRankAfter: myRankAfter,
      fillsHole,
    },
    dynasty: dynastySide
      ? {
        give: dynastySide.giveRows,
        get: dynastySide.getRows,
        yourStarterValueBefore: dynastySide.starterBefore,
        yourStarterValueAfter: dynastySide.starterAfter,
        yourPowerRankBefore: myRankBefore,
        yourPowerRankAfter: (dynastySide.getAdjusted - dynastySide.giveAdjusted) >= 0
          ? Math.max(1, myRankBefore - 1)
          : myRankBefore + 1,
        fillsHole,
      }
      : undefined,
    isDynasty: league.seasonLongFormat.isDynasty,
    weights,
  });

  // Primary follows the chat scoring window (default Week N).
  const windowKey: "week" | "season_long" | "dynasty" =
    ctx.scoringWindow === "week"
      ? "week"
      : ctx.scoringWindow === "dynasty" && move.dynasty
        ? "dynasty"
        : "season_long";
  const primary =
    windowKey === "week"
      ? move.week
      : windowKey === "dynasty" && move.dynasty
        ? move.dynasty
        : move.seasonLong;

  return {
    ok: true as const,
    leagueId: league.id,
    formatKey: league.seasonLongFormat.key,
    scoringWindow: windowKey,
    note: "Labels and scores are from move-scoring. Explain them; do not re-rank.",
    give: give.resolved,
    get: get.resolved,
    giveTotal,
    getTotal,
    waiverAdjustment: adjustment,
    giveAdjustedTotal: giveAdjusted,
    getAdjustedTotal: getAdjusted,
    margin,
    scoring: move,
    primaryLabel: primary.label,
    primaryScore: primary.score,
    verdict: `${primary.label} (${primary.score}): ${primary.reasons[0]?.effect ?? ""}`,
    unsupportedSettings: league.tradeValuation.unsupportedSettings,
  };
}

async function toolGetWeekMatchup(ctx: ChatToolContext, args: { leagueId: string }) {
  const dashboard = await loadDashboard(ctx);
  const league = findLeague(dashboard, args.leagueId);
  if (!league) return { ok: false as const, error: "League not found for this user." };
  const valueById = new Map(leagueAssets(dashboard, league.id).map((row) => [row.playerId, row.value]));
  return {
    ok: true as const,
    season: dashboard.season,
    week: dashboard.week,
    leagueId: league.id,
    name: league.name,
    record: league.record,
    teamProjection: league.teamProjection,
    teamActual: league.teamActual,
    suggestion: league.suggestion,
    starters: league.starters.map((player) => rosterPlayerSummary(player, valueById)),
    bench: league.bench.map((player) => rosterPlayerSummary(player, valueById)),
    opponent: league.opponentTeam
      ? {
        name: league.opponentTeam.name,
        teamProjection: league.opponentTeam.teamProjection,
        teamActual: league.opponentTeam.teamActual,
        starters: league.opponentTeam.starters.map((player) => ({
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          projection: player.projection,
          actual: player.actual,
        })),
      }
      : null,
  };
}

const emptyArgsSchema = z.object({ leagueId: z.string().min(1).optional() }).strict();
const playerCardSchema = z
  .object({
    playerId: z.string().min(1).max(80).optional(),
    playerName: z.string().min(1).max(120).optional(),
    leagueId: z.string().min(1).max(80).optional(),
  })
  .strict();
const powerSchema = z
  .object({
    leagueId: z.string().min(1).max(80),
    horizon: z.enum(["week", "season_long", "dynasty"]).optional(),
  })
  .strict();
const tradeHistorySchema = z
  .object({
    leagueId: z.string().min(1).max(80),
    season: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(40).optional(),
  })
  .strict();
const evaluateTradeSchema = z
  .object({
    leagueId: z.string().min(1).max(80),
    givePlayerIds: z.array(z.string().min(1).max(80)).min(1).max(20),
    getPlayerIds: z.array(z.string().min(1).max(80)).min(1).max(20),
  })
  .strict();
const weekMatchupSchema = z.object({ leagueId: z.string().min(1).max(80) }).strict();

export async function dispatchChatTool(
  name: string,
  rawArgs: unknown,
  ctx: ChatToolContext,
): Promise<unknown> {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  switch (name) {
    case "get_my_leagues": {
      const parsed = emptyArgsSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetMyLeagues(ctx, parsed.data);
    }
    case "get_player_card": {
      const parsed = playerCardSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetPlayerCard(ctx, parsed.data);
    }
    case "get_power_rankings": {
      const parsed = powerSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetPowerRankings(ctx, parsed.data);
    }
    case "get_trade_history": {
      const parsed = tradeHistorySchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetTradeHistory(ctx, parsed.data);
    }
    case "evaluate_trade": {
      const parsed = evaluateTradeSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolEvaluateTrade(ctx, parsed.data);
    }
    case "get_week_matchup": {
      const parsed = weekMatchupSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
      return toolGetWeekMatchup(ctx, parsed.data);
    }
    default: {
      const preference = await dispatchPreferenceChatTool(name, args, ctx.userId);
      if (preference !== null) return preference;
      const extended = await dispatchExtendedChatTool(name, args, ctx);
      if (extended !== null) return extended;
      return { ok: false, error: `Unknown tool: ${name}` };
    }
  }
}

export function parseToolCallArguments(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __parseError: "Tool arguments were not valid JSON.", raw };
  }
}
