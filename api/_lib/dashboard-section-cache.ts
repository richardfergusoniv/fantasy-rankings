import { z } from "zod";
import {
  analyticsSchema,
  dashboardMetaSchema,
  dashboardPlayersSchema,
  dashboardTradeSchema,
  dashboardTradeWaiverSchema,
  emptyPlayerInsights,
  leaguePowerSchema,
  leagueTeamSchema,
  type Dashboard,
} from "./dashboard-schemas.js";

/**
 * Per-section `source_cache` rows for a user dashboard.
 * Keys: `dashboard:user:<id>:meta|team|players|league|analytics|trade|trade-waiver`
 *
 * `trade` holds tradeTeams + tradeStarterSlots (~0.9 MB raw) for Matchup /
 * Monitor / Power / Trade. `trade-waiver` holds tradeWaiverPool (~1.5 MB) and
 * is loaded only by the Trade tab.
 */

export const DASHBOARD_CACHE_SECTIONS = [
  "meta",
  "team",
  "players",
  "league",
  "analytics",
  "trade",
  "trade-waiver",
] as const;

export type DashboardCacheSection = (typeof DASHBOARD_CACHE_SECTIONS)[number];

export function userDashboardSectionCacheKey(
  sleeperUserId: string,
  section: DashboardCacheSection,
): string {
  return `dashboard:user:${sleeperUserId}:${section}`;
}

/** Team slice stored without the heavy trade fields. */
export const dashboardTeamCacheSchema = z.object({
  leagues: z.array(
    leagueTeamSchema.omit({
      tradeTeams: true,
      tradeWaiverPool: true,
      tradeStarterSlots: true,
    }),
  ),
});

export const dashboardTradeCacheSchema = dashboardTradeSchema;
export const dashboardTradeWaiverCacheSchema = dashboardTradeWaiverSchema;

export const dashboardLeagueCacheSchema = z.object({
  leagues: z.array(leaguePowerSchema),
});

export const dashboardAnalyticsCacheSchema = z.object({
  analytics: analyticsSchema,
});

export type DashboardMetaCacheData = z.infer<typeof dashboardMetaSchema>;
export type DashboardTeamCacheData = z.infer<typeof dashboardTeamCacheSchema>;
export type DashboardPlayersCacheData = z.infer<typeof dashboardPlayersSchema>;
export type DashboardLeagueCacheData = z.infer<typeof dashboardLeagueCacheSchema>;
export type DashboardAnalyticsCacheData = z.infer<typeof dashboardAnalyticsCacheSchema>;
export type DashboardTradeCacheData = z.infer<typeof dashboardTradeCacheSchema>;
export type DashboardTradeWaiverCacheData = z.infer<typeof dashboardTradeWaiverCacheSchema>;

export type DashboardSectionCacheData = {
  meta: DashboardMetaCacheData;
  team: DashboardTeamCacheData;
  players: DashboardPlayersCacheData;
  league: DashboardLeagueCacheData;
  analytics: DashboardAnalyticsCacheData;
  trade: DashboardTradeCacheData;
  "trade-waiver": DashboardTradeWaiverCacheData;
};

/** Team API response data (includes trade fields for shape compatibility). */
export type DashboardTeamApiData = {
  leagues: z.infer<typeof leagueTeamSchema>[];
};

/** Envelope written with every section in one build (same version + live flag). */
export const dashboardSectionEnvelopeSchema = z.object({
  version: z.string(),
  live: z.boolean(),
  data: z.unknown(),
});

export type DashboardSectionEnvelope<T = unknown> = {
  version: string;
  live: boolean;
  data: T;
};

export function splitDashboardIntoSections(dashboard: Dashboard): DashboardSectionCacheData {
  return {
    meta: {
      status: dashboard.status,
      season: dashboard.season,
      week: dashboard.week,
      asOf: dashboard.asOf,
      rankingsAsOf: dashboard.rankingsAsOf,
      fantasyCalcAsOf: dashboard.fantasyCalcAsOf,
      sourceErrors: dashboard.sourceErrors,
      leagues: dashboard.leagues.map(
        ({
          id,
          name,
          scoringLabel,
          rankingField,
          rosteredPlayerIds,
          rosterAssignments,
          rankingPositions,
          showSuperFilter,
          seasonLongFormat,
          tradeValuation,
          waivers,
        }) => ({
          id,
          name,
          scoringLabel,
          rankingField,
          rosteredPlayerIds,
          rosterAssignments,
          rankingPositions,
          showSuperFilter,
          seasonLongFormat,
          tradeValuation,
          waivers: waivers ?? null,
        }),
      ),
    },
    team: {
      leagues: dashboard.leagues.map(
        ({
          id,
          record,
          teamActual,
          teamProjection,
          starters,
          bench,
          opponentTeam,
          suggestion,
        }) => ({
          id,
          record,
          teamActual,
          teamProjection,
          starters,
          bench,
          opponentTeam,
          suggestion,
        }),
      ),
    },
    players: {
      rankings: dashboard.rankings,
      weeklyChartRankings: dashboard.weeklyChartRankings,
      seasonLongRankings: dashboard.seasonLongRankings,
      defenses: dashboard.defenses,
      strengthOfSchedule: dashboard.strengthOfSchedule ?? [],
      playerTrending: dashboard.playerTrending ?? {},
      playerInsights: dashboard.playerInsights ?? emptyPlayerInsights,
      gameLines: dashboard.gameLines ?? [],
    },
    league: {
      leagues: dashboard.leagues.map(
        ({ id, powerRankingsWeek, powerRankingsSeasonLong, powerRankingsDynasty, standings, playoffs }) => ({
          id,
          powerRankingsWeek,
          powerRankingsSeasonLong,
          powerRankingsDynasty,
          standings: standings ?? [],
          playoffs: playoffs ?? { teams: null, weekStart: null },
        }),
      ),
    },
    analytics: {
      analytics: dashboard.analytics,
    },
    trade: {
      leagues: dashboard.leagues.map(({ id, tradeTeams, tradeStarterSlots }) => ({
        id,
        tradeTeams,
        tradeStarterSlots,
      })),
    },
    "trade-waiver": {
      leagues: dashboard.leagues.map(({ id, tradeWaiverPool }) => ({
        id,
        tradeWaiverPool,
      })),
    },
  };
}

export function wrapSectionEnvelope<T>(
  dashboard: Dashboard,
  data: T,
  live: boolean,
): DashboardSectionEnvelope<T> {
  return {
    version: dashboard.asOf,
    live,
    data,
  };
}

/** True when any rostered player in this snapshot is in a live game. */
export function dashboardSnapshotIsLive(dashboard: {
  leagues: Array<{
    starters?: Array<{ gamePhase?: string | null }>;
    bench?: Array<{ gamePhase?: string | null }>;
    opponentTeam?: {
      starters?: Array<{ gamePhase?: string | null }>;
      bench?: Array<{ gamePhase?: string | null }>;
    } | null;
  }>;
}): boolean {
  return dashboard.leagues.some((league) => {
    const pools = [
      league.starters ?? [],
      league.bench ?? [],
      league.opponentTeam?.starters ?? [],
      league.opponentTeam?.bench ?? [],
    ];
    return pools.some((players) => players.some((player) => player.gamePhase === "live"));
  });
}

/**
 * Section body returned by `/api/dashboard/section` for a freshly built
 * dashboard. Team matches the slim section row (trade fields empty); the
 * legacy full-row projection still includes trade data.
 */
export function apiSectionDataFromDashboard(
  dashboard: Dashboard,
  section: DashboardCacheSection,
): ProjectedDashboardSection["data"] {
  const sections = splitDashboardIntoSections(dashboard);
  switch (section) {
    case "meta":
      return sections.meta;
    case "team":
      return teamSectionApiData(sections.team, null, null);
    case "players":
      return sections.players;
    case "league":
      return sections.league;
    case "analytics":
      return sections.analytics;
    case "trade":
      return sections.trade;
    case "trade-waiver":
      return sections["trade-waiver"];
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export type ProjectedDashboardSection =
  | { section: "meta"; data: DashboardSectionCacheData["meta"] }
  | { section: "team"; data: DashboardTeamApiData }
  | { section: "players"; data: DashboardSectionCacheData["players"] }
  | { section: "league"; data: DashboardSectionCacheData["league"] }
  | { section: "analytics"; data: DashboardSectionCacheData["analytics"] }
  | { section: "trade"; data: DashboardSectionCacheData["trade"] }
  | { section: "trade-waiver"; data: DashboardSectionCacheData["trade-waiver"] };

/**
 * Project a full dashboard into the stored/API slice for one section (legacy
 * full-row fallback and owner snapshot).
 */
export function projectDashboardSection(
  dashboard: Dashboard,
  section: DashboardCacheSection,
): ProjectedDashboardSection["data"] {
  if (section === "team") {
    // Legacy / snapshot path: include trade fields so team responses stay shaped.
    return {
      leagues: dashboard.leagues.map(
        ({
          id,
          record,
          teamActual,
          teamProjection,
          starters,
          bench,
          opponentTeam,
          suggestion,
          tradeTeams,
          tradeWaiverPool,
          tradeStarterSlots,
        }) => ({
          id,
          record,
          teamActual,
          teamProjection,
          starters,
          bench,
          opponentTeam,
          suggestion,
          tradeTeams,
          tradeWaiverPool,
          tradeStarterSlots,
        }),
      ),
    };
  }
  return splitDashboardIntoSections(dashboard)[section];
}

/**
 * Team API response shape (includes trade fields). New team cache rows omit
 * trade data — fill empty arrays unless trade slices are provided.
 */
export function teamSectionApiData(
  team: DashboardTeamCacheData,
  trade: DashboardTradeCacheData | null,
  waiver: DashboardTradeWaiverCacheData | null = null,
): DashboardTeamApiData {
  const tradeByLeague = new Map((trade?.leagues ?? []).map((league) => [league.id, league]));
  const waiverByLeague = new Map((waiver?.leagues ?? []).map((league) => [league.id, league]));
  return {
    leagues: team.leagues.map((league) => {
      const tradeLeague = tradeByLeague.get(league.id);
      const waiverLeague = waiverByLeague.get(league.id);
      return {
        ...league,
        tradeTeams: tradeLeague?.tradeTeams ?? [],
        tradeWaiverPool: waiverLeague?.tradeWaiverPool ?? tradeLeague?.tradeWaiverPool ?? [],
        tradeStarterSlots: tradeLeague?.tradeStarterSlots ?? [],
      };
    }),
  };
}

/**
 * Rebuild a full Dashboard from per-section rows. All sections must share the
 * same `version`. `weeklyChartRankings` is taken from players (or rankings).
 */
export function assembleDashboardFromSections(
  sections: DashboardSectionCacheData,
): Dashboard | null {
  const meta = dashboardMetaSchema.safeParse(sections.meta);
  const team = dashboardTeamCacheSchema.safeParse(sections.team);
  const players = dashboardPlayersSchema.safeParse(sections.players);
  const league = dashboardLeagueCacheSchema.safeParse(sections.league);
  const analytics = dashboardAnalyticsCacheSchema.safeParse(sections.analytics);
  const trade = dashboardTradeCacheSchema.safeParse(sections.trade);
  const waiver = dashboardTradeWaiverCacheSchema.safeParse(sections["trade-waiver"]);
  if (
    !meta.success
    || !team.success
    || !players.success
    || !league.success
    || !analytics.success
    || !trade.success
    || !waiver.success
  ) {
    return null;
  }
  if (meta.data.leagues.length === 0) return null;

  const teamById = new Map(team.data.leagues.map((row) => [row.id, row]));
  const leagueById = new Map(league.data.leagues.map((row) => [row.id, row]));
  const tradeById = new Map(trade.data.leagues.map((row) => [row.id, row]));
  const waiverById = new Map(waiver.data.leagues.map((row) => [row.id, row]));

  const leagues: Dashboard["leagues"] = meta.data.leagues.map((identity) => {
    const teamRow = teamById.get(identity.id);
    const leagueRow = leagueById.get(identity.id);
    const tradeRow = tradeById.get(identity.id);
    const waiverRow = waiverById.get(identity.id);
    return {
      ...identity,
      record: teamRow?.record ?? { wins: 0, losses: 0, ties: 0 },
      teamActual: teamRow?.teamActual ?? null,
      teamProjection: teamRow?.teamProjection ?? null,
      starters: teamRow?.starters ?? [],
      bench: teamRow?.bench ?? [],
      opponentTeam: teamRow?.opponentTeam ?? null,
      suggestion: teamRow?.suggestion ?? null,
      tradeTeams: tradeRow?.tradeTeams ?? [],
      tradeWaiverPool: waiverRow?.tradeWaiverPool ?? tradeRow?.tradeWaiverPool ?? [],
      tradeStarterSlots: tradeRow?.tradeStarterSlots ?? [],
      powerRankingsWeek: leagueRow?.powerRankingsWeek ?? [],
      powerRankingsSeasonLong: leagueRow?.powerRankingsSeasonLong ?? [],
      powerRankingsDynasty: leagueRow?.powerRankingsDynasty ?? [],
      standings: leagueRow?.standings ?? [],
      playoffs: leagueRow?.playoffs ?? { teams: null, weekStart: null },
      waivers: identity.waivers ?? null,
    };
  });

  const rankings = players.data.rankings;
  const weeklyChartRankings = players.data.weeklyChartRankings ?? rankings;

  return {
    status: meta.data.status,
    season: meta.data.season,
    week: meta.data.week,
    asOf: meta.data.asOf,
    rankingsAsOf: meta.data.rankingsAsOf,
    fantasyCalcAsOf: meta.data.fantasyCalcAsOf,
    sourceErrors: meta.data.sourceErrors,
    leagues,
    rankings,
    weeklyChartRankings,
    seasonLongRankings: players.data.seasonLongRankings,
    defenses: players.data.defenses,
    playerTrending: players.data.playerTrending ?? {},
    playerInsights: players.data.playerInsights ?? emptyPlayerInsights,
    analytics: analytics.data.analytics,
    strengthOfSchedule: players.data.strengthOfSchedule ?? [],
    gameLines: players.data.gameLines ?? [],
  };
}

export function parseSectionEnvelope(payload: unknown): DashboardSectionEnvelope | null {
  const parsed = dashboardSectionEnvelopeSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** One `source_cache` upsert produced by a dashboard write. */
export type DashboardCacheWrite = {
  cacheKey: string;
  payload: string;
  fetchedAt: Date;
};

/**
 * Build every `source_cache` write for a dashboard. Per-user keys write the
 * seven section rows only; non-user keys (the owner snapshot) write the full
 * row. Pure — used by `writeUserDashboardCache` and unit tests.
 */
export function buildDashboardCacheWrites(args: {
  cacheKey: string;
  dashboard: Dashboard;
  fetchedAt: Date;
  live: boolean;
  encode: (value: unknown) => string;
  serializeFull: (dashboard: Dashboard) => string;
}): DashboardCacheWrite[] {
  const { cacheKey, dashboard, fetchedAt, live, encode, serializeFull } = args;
  const writes: DashboardCacheWrite[] = [];

  if (cacheKey.startsWith("dashboard:user:")) {
    const sleeperUserId = cacheKey.slice("dashboard:user:".length);
    if (!sleeperUserId.includes(":")) {
      const sections = splitDashboardIntoSections(dashboard);
      const playersForCache = {
        rankings: sections.players.rankings,
        seasonLongRankings: sections.players.seasonLongRankings,
        defenses: sections.players.defenses,
        strengthOfSchedule: sections.players.strengthOfSchedule,
        playerInsights: sections.players.playerInsights,
      };
      const sectionPayloads: Array<{ section: DashboardCacheSection; data: unknown }> = [
        { section: "meta", data: sections.meta },
        { section: "team", data: sections.team },
        { section: "players", data: playersForCache },
        { section: "league", data: sections.league },
        { section: "analytics", data: sections.analytics },
        { section: "trade", data: sections.trade },
        { section: "trade-waiver", data: sections["trade-waiver"] },
      ];
      for (const { section, data } of sectionPayloads) {
        writes.push({
          cacheKey: userDashboardSectionCacheKey(sleeperUserId, section),
          payload: encode(wrapSectionEnvelope(dashboard, data, live)),
          fetchedAt,
        });
      }
      // Per-user keys write section rows only: the legacy full
      // `dashboard:user:<id>` row duplicated every section byte a second
      // time (roughly 2x snapshot egress on reads of it). Reads still fall
      // back to older full rows; new writes no longer produce one.
      return writes;
    }
  }

  writes.push({
    cacheKey,
    payload: serializeFull(dashboard),
    fetchedAt,
  });
  return writes;
}

export type SourceCacheRowLike = {
  cacheKey: string;
  payload: string;
  fetchedAt: Date;
};

/**
 * Assemble a dashboard from section rows. Returns null on missing sections,
 * decode failures, or version mismatch across envelopes.
 */
export function dashboardFromSectionRows(args: {
  sleeperUserId: string;
  rows: SourceCacheRowLike[];
  decode: (raw: string) => unknown;
  parseSectionData: <S extends DashboardCacheSection>(
    section: S,
    data: unknown,
  ) => DashboardSectionCacheData[S] | null;
  nowMs?: number;
  ttlMs: (live: boolean) => number;
}): { dashboard: Dashboard; fresh: boolean; fetchedAtMs: number; live: boolean } | null {
  const { sleeperUserId, rows, decode, parseSectionData, ttlMs } = args;
  const nowMs = args.nowMs ?? Date.now();
  if (rows.length < DASHBOARD_CACHE_SECTIONS.length) return null;

  const byKey = new Map(rows.map((row) => [row.cacheKey, row]));
  const assembled: Partial<DashboardSectionCacheData> = {};
  let version: string | null = null;
  let live = false;
  let fetchedAtMs = Number.POSITIVE_INFINITY;

  for (const section of DASHBOARD_CACHE_SECTIONS) {
    const row = byKey.get(userDashboardSectionCacheKey(sleeperUserId, section));
    if (!row) return null;
    let decoded: unknown;
    try {
      decoded = decode(row.payload);
    } catch {
      return null;
    }
    const envelope = parseSectionEnvelope(decoded);
    if (!envelope) return null;
    if (version == null) version = envelope.version;
    else if (envelope.version !== version) return null;
    live = live || envelope.live;
    fetchedAtMs = Math.min(fetchedAtMs, row.fetchedAt.getTime());
    const data = parseSectionData(section, envelope.data);
    if (!data) return null;
    assembled[section] = data as never;
  }

  const dashboard = assembleDashboardFromSections(assembled as DashboardSectionCacheData);
  if (!dashboard) return null;
  return {
    dashboard,
    fresh: nowMs - fetchedAtMs < ttlMs(live),
    fetchedAtMs,
    live,
  };
}

/**
 * Resolve one section hit from a section row, else from a legacy full-row
 * dashboard. Pure helper for `readUserDashboardSection` tests.
 */
export function resolveSectionHitFromRows<S extends DashboardCacheSection>(args: {
  section: S;
  sectionRow: SourceCacheRowLike | null;
  fullDashboard: Dashboard | null;
  fullFresh: boolean;
  decode: (raw: string) => unknown;
  parseSectionData: <T extends DashboardCacheSection>(
    section: T,
    data: unknown,
  ) => DashboardSectionCacheData[T] | null;
  nowMs?: number;
  ttlMs: (live: boolean) => number;
  /** `fetchedAt` of the legacy full row, when that fallback is eligible. */
  fullFetchedAt?: Date | null;
}): {
  data: S extends "team" ? DashboardTeamApiData : DashboardSectionCacheData[S];
  fresh: boolean;
  source: "section" | "full-row";
  version: string;
  live: boolean;
  fetchedAtMs: number;
} | null {
  const { section, sectionRow, fullDashboard, fullFresh, decode, parseSectionData, ttlMs } = args;
  const nowMs = args.nowMs ?? Date.now();

  if (sectionRow) {
    try {
      const decoded = decode(sectionRow.payload);
      const envelope = parseSectionEnvelope(decoded);
      if (envelope) {
        const data = parseSectionData(section, envelope.data);
        if (data) {
          const apiData = section === "team"
            ? teamSectionApiData(data as DashboardSectionCacheData["team"], null, null)
            : data;
          return {
            data: apiData as S extends "team" ? DashboardTeamApiData : DashboardSectionCacheData[S],
            fresh: nowMs - sectionRow.fetchedAt.getTime() < ttlMs(envelope.live),
            source: "section",
            version: envelope.version,
            live: envelope.live,
            fetchedAtMs: sectionRow.fetchedAt.getTime(),
          };
        }
      }
    } catch {
      // Fall through to the legacy full row.
    }
  }

  if (!fullDashboard) return null;
  return {
    data: projectDashboardSection(fullDashboard, section) as S extends "team"
      ? DashboardTeamApiData
      : DashboardSectionCacheData[S],
    fresh: fullFresh,
    source: "full-row",
    version: fullDashboard.asOf,
    live: dashboardSnapshotIsLive(fullDashboard),
    fetchedAtMs: args.fullFetchedAt?.getTime() ?? 0,
  };
}
