import { z } from "zod";
import {
  analyticsSchema,
  dashboardMetaSchema,
  dashboardPlayersSchema,
  dashboardTradeSchema,
  leaguePowerSchema,
  leagueTeamSchema,
  type Dashboard,
} from "./dashboard-schemas.js";

/**
 * Per-section `source_cache` rows for a user dashboard.
 * Keys: `dashboard:user:<id>:meta|team|players|league|analytics|trade`
 *
 * `trade` holds tradeTeams / tradeWaiverPool / tradeStarterSlots so the
 * always-on team (matchup) row stays small; the trade tab (and views that
 * need roster lookups) load it separately.
 */

export const DASHBOARD_CACHE_SECTIONS = [
  "meta",
  "team",
  "players",
  "league",
  "analytics",
  "trade",
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

export type DashboardSectionCacheData = {
  meta: DashboardMetaCacheData;
  team: DashboardTeamCacheData;
  players: DashboardPlayersCacheData;
  league: DashboardLeagueCacheData;
  analytics: DashboardAnalyticsCacheData;
  trade: DashboardTradeCacheData;
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
    },
    league: {
      leagues: dashboard.leagues.map(
        ({ id, powerRankingsWeek, powerRankingsSeasonLong, powerRankingsDynasty }) => ({
          id,
          powerRankingsWeek,
          powerRankingsSeasonLong,
          powerRankingsDynasty,
        }),
      ),
    },
    analytics: {
      analytics: dashboard.analytics,
    },
    trade: {
      leagues: dashboard.leagues.map(({ id, tradeTeams, tradeWaiverPool, tradeStarterSlots }) => ({
        id,
        tradeTeams,
        tradeWaiverPool,
        tradeStarterSlots,
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

export type ProjectedDashboardSection =
  | { section: "meta"; data: DashboardSectionCacheData["meta"] }
  | { section: "team"; data: DashboardTeamApiData }
  | { section: "players"; data: DashboardSectionCacheData["players"] }
  | { section: "league"; data: DashboardSectionCacheData["league"] }
  | { section: "analytics"; data: DashboardSectionCacheData["analytics"] }
  | { section: "trade"; data: DashboardSectionCacheData["trade"] };

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
 * trade data — fill empty arrays unless `trade` is provided.
 */
export function teamSectionApiData(
  team: DashboardTeamCacheData,
  trade: DashboardTradeCacheData | null,
): DashboardTeamApiData {
  const tradeByLeague = new Map((trade?.leagues ?? []).map((league) => [league.id, league]));
  return {
    leagues: team.leagues.map((league) => {
      const tradeLeague = tradeByLeague.get(league.id);
      return {
        ...league,
        tradeTeams: tradeLeague?.tradeTeams ?? [],
        tradeWaiverPool: tradeLeague?.tradeWaiverPool ?? [],
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
  if (
    !meta.success
    || !team.success
    || !players.success
    || !league.success
    || !analytics.success
    || !trade.success
  ) {
    return null;
  }
  if (meta.data.leagues.length === 0) return null;

  const teamById = new Map(team.data.leagues.map((row) => [row.id, row]));
  const leagueById = new Map(league.data.leagues.map((row) => [row.id, row]));
  const tradeById = new Map(trade.data.leagues.map((row) => [row.id, row]));

  const leagues: Dashboard["leagues"] = meta.data.leagues.map((identity) => {
    const teamRow = teamById.get(identity.id);
    const leagueRow = leagueById.get(identity.id);
    const tradeRow = tradeById.get(identity.id);
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
      tradeWaiverPool: tradeRow?.tradeWaiverPool ?? [],
      tradeStarterSlots: tradeRow?.tradeStarterSlots ?? [],
      powerRankingsWeek: leagueRow?.powerRankingsWeek ?? [],
      powerRankingsSeasonLong: leagueRow?.powerRankingsSeasonLong ?? [],
      powerRankingsDynasty: leagueRow?.powerRankingsDynasty ?? [],
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
    analytics: analytics.data.analytics,
    strengthOfSchedule: players.data.strengthOfSchedule ?? [],
  };
}

export function parseSectionEnvelope(payload: unknown): DashboardSectionEnvelope | null {
  const parsed = dashboardSectionEnvelopeSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
