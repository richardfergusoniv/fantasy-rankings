import { z } from "zod";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";

/**
 * Dashboard zod schemas, copied verbatim from app/server/src/actions.ts.
 *
 * Only change: `import { z } from "@hatch/space-sdk"` → `import { z } from "zod"`.
 * These validate the cached dashboard snapshot payload stored in `source_cache`.
 */

export const rankingSchema = z.object({
  leagueId: z.string(),
  playerId: z.string(),
  name: z.string(),
  team: z.string(),
  opponent: z.string().nullable(),
  isAway: z.boolean().nullable(),
  isBye: z.boolean(),
  position: z.enum(["QB", "RB", "WR", "TE", "K"]),
  pprRank: z.number().int(),
  halfPprRank: z.number().int(),
  leagueRank: z.number().int(),
  ppr: z.number().nullable(),
  halfPpr: z.number().nullable(),
  standard: z.number().nullable(),
  leagueProjection: z.number().nullable(),
  vegasProjection: z.number().nullable(),
  sleeperProjection: z.number().nullable(),
  projectionSource: z.enum(["vegas", "first_down", "fallback", "sleeper"]),
  projectionComponents: z.record(z.string(), z.number()).nullable(),
  injuryStatus: z.string().nullable(),
  gameTime: z.string().nullable(),
});

export const defenseProjectionComponentsSchema = z.record(z.string(), z.number());

export const defenseSchema = z.object({
  leagueId: z.string(),
  team: z.string(),
  opponent: z.string(),
  isAway: z.boolean(),
  opponentProjectedPoints: z.number().nullable(),
  projectedPointsSource: z.enum(["vegas", "unavailable"]),
  pregameProjection: z.number().nullable(),
  displayProjection: z.number().nullable(),
  projectionSource: z.enum(["vegas", "sleeper"]).nullable(),
  actualScore: z.number().nullable(),
  gamePhase: z.enum(["pregame", "live", "final"]).nullable(),
  gameTime: z.string().nullable(),
  components: defenseProjectionComponentsSchema.nullable(),
  rank: z.number().int().nullable(),
});

export const seasonLongRankingSchema = z.object({
  formatKey: z.string(),
  playerId: z.string(),
  name: z.string(),
  team: z.string().nullable(),
  position: z.enum(["QB", "RB", "WR", "TE", "PICK"]),
  overallRank: z.number().int(),
  positionRank: z.number().int(),
  value: z.number().int(),
  trend30Day: z.number().int().nullable(),
  isRookie: z.boolean(),
});

export const seasonLongFormatSchema = z.object({
  key: z.string(),
  isDynasty: z.boolean(),
  numQbs: z.number().int(),
  numTeams: z.number().int(),
  ppr: z.number(),
  label: z.string(),
});

export const powerRankingSchema = z.object({
  rosterId: z.number().int(),
  teamName: z.string(),
  record: z.object({ wins: z.number().int(), losses: z.number().int(), ties: z.number().int() }),
  rank: z.number().int(),
  totalValue: z.number(),
  futurePickValue: z.number(),
  positionValues: z.object({
    QB: z.number(),
    RB: z.number(),
    WR: z.number(),
    TE: z.number(),
    FLEX: z.number(),
    K: z.number(),
    DEF: z.number(),
  }),
  isUser: z.boolean(),
});

export const rosterPlayerSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  team: z.string().nullable(),
  position: z.string(),
  lineupSlot: z.string().nullable(),
  isStarter: z.boolean(),
  rank: z.number().int().nullable(),
  projection: z.number().nullable(),
  projectionSource: z.enum(["vegas", "first_down", "fallback", "sleeper"]).nullable(),
  actual: z.number().nullable(),
  gamePhase: z.enum(["pregame", "live", "final"]).nullable(),
  gameTime: z.string().nullable(),
  /** ESPN quarter / OT period when the game is in progress. */
  gamePeriod: z.number().int().nullable().optional(),
  /** ESPN seconds remaining in the current period. */
  gameClockSeconds: z.number().nullable().optional(),
  opponent: z.string().nullable(),
  isAway: z.boolean().nullable(),
  isBye: z.boolean(),
  injuryStatus: z.string().nullable(),
  defenseComponents: defenseProjectionComponentsSchema.nullable(),
  projectionComponents: z.record(z.string(), z.number()).nullable(),
});

export const suggestionSchema = z.object({
  inPlayer: z.string(),
  outPlayer: z.string(),
  delta: z.number(),
  slot: z.string(),
}).nullable();

export const matchupTeamSchema = z.object({
  name: z.string(),
  teamActual: z.number().nullable(),
  teamProjection: z.number().nullable(),
  starters: z.array(rosterPlayerSchema),
  bench: z.array(rosterPlayerSchema),
});

export const rosterAssignmentSchema = z.object({
  playerId: z.string(),
  teamName: z.string(),
  isUser: z.boolean(),
});

export const tradeValuationSchema = z.object({
  unsupportedSettings: z.array(z.string()),
  projectionAsOf: z.string().nullable(),
  optimizerVersion: z.literal("lineup-dp-v1"),
});

export const tradeTeamSchema = z.object({
  rosterId: z.number().int(),
  ownerId: z.string().nullable(),
  teamName: z.string(),
  isUser: z.boolean(),
  players: z.array(rosterPlayerSchema),
  ownedPicks: z.array(seasonLongRankingSchema),
  record: z.object({
    wins: z.number().int(),
    losses: z.number().int(),
    ties: z.number().int(),
  }).optional(),
});

export const leagueSchema = z.object({
  id: z.string(),
  name: z.string(),
  scoringLabel: z.string(),
  rankingField: z.enum(["ppr", "halfPpr"]),
  record: z.object({ wins: z.number().int(), losses: z.number().int(), ties: z.number().int() }),
  teamActual: z.number().nullable(),
  teamProjection: z.number().nullable(),
  starters: z.array(rosterPlayerSchema),
  bench: z.array(rosterPlayerSchema),
  opponentTeam: matchupTeamSchema.nullable(),
  suggestion: suggestionSchema,
  rosteredPlayerIds: z.array(z.string()),
  rosterAssignments: z.array(rosterAssignmentSchema),
  rankingPositions: z.array(z.enum(["QB", "RB", "WR", "TE", "K", "DEF"])),
  showSuperFilter: z.boolean(),
  seasonLongFormat: seasonLongFormatSchema,
  tradeValuation: tradeValuationSchema,
  tradeTeams: z.array(tradeTeamSchema),
  tradeWaiverPool: z.array(rosterPlayerSchema),
  tradeStarterSlots: z.array(z.string()),
  powerRankingsWeek: z.array(powerRankingSchema),
  powerRankingsSeasonLong: z.array(powerRankingSchema),
  powerRankingsDynasty: z.array(powerRankingSchema),
});

export const analyticsEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.string(),
  position: z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]),
  seasonGames: z.number().int(),
  rollingGames: z.number().int(),
  season: z.record(z.string(), z.number()),
  rolling17: z.record(z.string(), z.number()),
});

export const teamUsageSchema = z.object({
  team: z.string(),
  games: z.number().int(),
  pointsScored: z.number().int().default(0),
  totalYards: z.number().int().default(0),
  passingYards: z.number().int().default(0),
  rushingYards: z.number().int().default(0),
  offensiveTouchdowns: z.number().int().default(0),
  turnovers: z.number().int().default(0),
  playsPerGame: z.number(),
  passPct: z.number(),
  runPct: z.number(),
});

export const nflTeamRecordSchema = z.object({
  team: z.string(),
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
});

export const analyticsSchema = z.object({
  asOf: z.string().nullable(),
  throughWeek: z.number().int().nullable(),
  sourceUrl: z.string(),
  entities: z.array(analyticsEntitySchema),
  teamUsage: z.array(teamUsageSchema),
  teamRecords: z.array(nflTeamRecordSchema).default([]),
});

export const strengthOfScheduleCellSchema = z.object({
  avg: z.number(),
  weeks: z.number().int(),
  rank: z.number().int(),
});

export const strengthOfScheduleEntrySchema = z.object({
  leagueId: z.string(),
  season: z.number().int(),
  throughWeek: z.number().int(),
  computedAt: z.string(),
  table: z.record(z.string(), z.record(z.enum(["QB", "RB", "WR", "TE"]), strengthOfScheduleCellSchema)),
});

export const dashboardResponse = z.object({
  status: z.enum(["ok", "partial"]),
  season: z.number().int(),
  week: z.number().int(),
  asOf: z.string(),
  rankingsAsOf: z.string().nullable(),
  fantasyCalcAsOf: z.string().nullable(),
  leagues: z.array(leagueSchema),
  rankings: z.array(rankingSchema),
  weeklyChartRankings: z.array(rankingSchema),
  seasonLongRankings: z.array(seasonLongRankingSchema),
  defenses: z.array(defenseSchema),
  analytics: analyticsSchema,
  strengthOfSchedule: z.array(strengthOfScheduleEntrySchema),
  sourceErrors: z.array(z.string()),
});

export type Dashboard = z.infer<typeof dashboardResponse>;

// --- Dashboard section schemas (for getDashboardSection) ---

export const leagueIdentitySchema = leagueSchema.pick({
  id: true,
  name: true,
  scoringLabel: true,
  rankingField: true,
  rosteredPlayerIds: true,
  rosterAssignments: true,
  rankingPositions: true,
  showSuperFilter: true,
  seasonLongFormat: true,
  tradeValuation: true,
});

export const leagueTeamSchema = leagueSchema.pick({
  id: true,
  record: true,
  teamActual: true,
  teamProjection: true,
  starters: true,
  bench: true,
  opponentTeam: true,
  suggestion: true,
  tradeTeams: true,
  tradeWaiverPool: true,
  tradeStarterSlots: true,
});

export const leaguePowerSchema = leagueSchema.pick({
  id: true,
  powerRankingsWeek: true,
  powerRankingsSeasonLong: true,
  powerRankingsDynasty: true,
});

export const dashboardMetaSchema = dashboardResponse.pick({
  status: true,
  season: true,
  week: true,
  asOf: true,
  rankingsAsOf: true,
  fantasyCalcAsOf: true,
  sourceErrors: true,
}).extend({ leagues: z.array(leagueIdentitySchema) });

export const dashboardPlayersSchema = dashboardResponse.pick({
  rankings: true,
  weeklyChartRankings: true,
  seasonLongRankings: true,
  defenses: true,
  strengthOfSchedule: true,
});

export const leagueTradeSchema = leagueSchema.pick({
  id: true,
  tradeTeams: true,
  tradeWaiverPool: true,
  tradeStarterSlots: true,
});

export const dashboardTradeSchema = z.object({
  leagues: z.array(leagueTradeSchema),
});

export const dashboardSectionResponse = z.discriminatedUnion("section", [
  z.object({ section: z.literal("meta"), data: dashboardMetaSchema.nullable() }),
  z.object({ section: z.literal("team"), data: z.object({ leagues: z.array(leagueTeamSchema) }).nullable() }),
  z.object({ section: z.literal("players"), data: dashboardPlayersSchema.nullable() }),
  z.object({ section: z.literal("league"), data: z.object({ leagues: z.array(leaguePowerSchema) }).nullable() }),
  z.object({ section: z.literal("analytics"), data: z.object({ analytics: analyticsSchema }).nullable() }),
  z.object({ section: z.literal("trade"), data: dashboardTradeSchema.nullable() }),
]);

export type DashboardSection = z.infer<typeof dashboardSectionResponse>;

export const CACHE_KEY = "dashboard-live-projections-v25";

/**
 * Cached rows store `rankings` once. `weeklyChartRankings` is optional so
 * older rows that still duplicated it continue to parse; readers always
 * reconstruct it from `rankings` (they are byte-identical by construction).
 */
export const dashboardCachePayloadSchema = dashboardResponse
  .omit({ weeklyChartRankings: true })
  .extend({
    weeklyChartRankings: z.array(rankingSchema).optional(),
  });

export type DashboardCachePayload = z.infer<typeof dashboardCachePayloadSchema>;

/** Drop the duplicate weekly chart array before writing `source_cache` (gzip when large). */
export function serializeDashboardForCache(dashboard: Dashboard): string {
  const { weeklyChartRankings: _omit, ...cacheable } = dashboard;
  return encodeSourceCachePayload(cacheable);
}

/**
 * Rebuild the API/UI shape from a cache payload. Always sets
 * `weeklyChartRankings` from `rankings` so new and legacy rows behave the same.
 */
export function hydrateDashboardFromCache(payload: unknown): Dashboard | null {
  try {
    const parsed = dashboardCachePayloadSchema.parse(payload);
    if (parsed.leagues.length === 0) return null;
    const { weeklyChartRankings: _stored, ...rest } = parsed;
    return dashboardResponse.parse({
      ...rest,
      weeklyChartRankings: rest.rankings,
    });
  } catch {
    return null;
  }
}

/**
 * Parse a cached dashboard payload (plain JSON or `gz1:` compressed). Returns
 * null when the payload is malformed OR when it contains no leagues (a refresh
 * can produce a schema-valid shell when every per-league Sleeper request fails
 * — never promote that shell over a previously usable snapshot).
 */
export function parseUsableDashboard(payload: string): Dashboard | null {
  try {
    return hydrateDashboardFromCache(decodeSourceCachePayload(payload));
  } catch {
    return null;
  }
}
