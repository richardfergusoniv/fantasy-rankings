import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, inArray, isNull, like, lte, or } from "drizzle-orm";
import { Privileged } from "@space/privileged";
import * as schema from "./schema";

const SLEEPER_USER_ID = "739931264659927040";
const SLEEPER_BASE = "https://api.sleeper.app/v1";
const SLEEPER_PROJECTIONS_BASE = "https://api.sleeper.com";
const FANTASY_CALC_VALUES_URL = "https://api.fantasycalc.com/values/current";
const FANTASY_CALC_HISTORY_URL = "https://api.fantasycalc.com/trades/implied";
const NFLVERSE_PLAYER_STATS_2026_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv";
const NFLVERSE_PLAYER_STATS_2025_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv";
const TEAM_SITUATIONAL_STATS_URL = "https://hindi3.sportskeeda.com/nfl/team-stat/third-down-percentage-leaders?season=2026&type=regular";
const TEAM_SITUATIONAL_CACHE_KEY = "team-situational-stats-2026";
const TEAM_SITUATIONAL_CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = "dashboard-live-projections-v25";
const MIN_VEGAS_PLAYER_COVERAGE = 200;
const SOURCE_TIMEOUT_MS = 15_000;
const REFRESH_TIMEOUT_MS = 110_000;
const PLAYER_NEWS_SNAPSHOT_KEY = "player-news-injury-snapshot-v1";
const PLAYER_NEWS_CHECK_KEY = "player-news-last-check-v1";
const DRAFT_MARKET_CACHE_KEY = "draft-market-signals-v1";
const DRAFT_MARKET_CACHE_MS = 24 * 60 * 60 * 1000;
const FFC_BASE_URL = "https://fantasyfootballcalculator.com/api/v1/adp";
const MFL_ADP_URL = "https://api.myfantasyleague.com/2026/export?TYPE=adp&JSON=1";
const MFL_PLAYERS_URL = "https://api.myfantasyleague.com/2026/export?TYPE=players&JSON=1";
const POLYMARKET_URL = "https://gamma-api.polymarket.com/markets?active=true&closed=false&archived=false&limit=100&order=volume24hr&ascending=false";
const KALSHI_URL = "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=1000";
const KALSHI_TOTAL_EVENTS_URL = "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXNFLTOTAL&status=open&limit=200&with_nested_markets=true";
const KALSHI_SPREAD_EVENTS_URL = "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXNFLSPREAD&status=open&limit=200&with_nested_markets=true";
const ACTION_NETWORK_URL = "https://www.actionnetwork.com/nfl/public-betting";
const DYNASTICAL_CUCKS_LEAGUE_ID = "1306489414548979712";
const PLAYER_NEWS_LEAGUES = [
  { id: "1389344450517430272", name: "NY Sack Exchange II" },
  { id: "1355920300633513984", name: "Tits Out for The Ladz XII" },
  { id: "1317270144682070016", name: "C2C superconference" },
  { id: "1312127020972404736", name: "Hoe Ass Dynasty" },
  { id: "1311470531635052544", name: "Tainticklers" },
  { id: "1306489414548979712", name: "Dynastical Cucks" },
] as const;

const rankingSchema = z.object({
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

const defenseProjectionComponentsSchema = z.record(z.string(), z.number());

const defenseSchema = z.object({
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

const seasonLongRankingSchema = z.object({
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

const seasonLongFormatSchema = z.object({
  key: z.string(),
  isDynasty: z.boolean(),
  numQbs: z.number().int(),
  numTeams: z.number().int(),
  ppr: z.number(),
  label: z.string(),
});

const powerRankingSchema = z.object({
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

const rosterPlayerSchema = z.object({
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
  opponent: z.string().nullable(),
  isAway: z.boolean().nullable(),
  isBye: z.boolean(),
  injuryStatus: z.string().nullable(),
  defenseComponents: defenseProjectionComponentsSchema.nullable(),
  projectionComponents: z.record(z.string(), z.number()).nullable(),
});

const suggestionSchema = z.object({
  inPlayer: z.string(),
  outPlayer: z.string(),
  delta: z.number(),
  slot: z.string(),
}).nullable();

const matchupTeamSchema = z.object({
  name: z.string(),
  teamActual: z.number().nullable(),
  teamProjection: z.number().nullable(),
  starters: z.array(rosterPlayerSchema),
  bench: z.array(rosterPlayerSchema),
});

const rosterAssignmentSchema = z.object({
  playerId: z.string(),
  teamName: z.string(),
  isUser: z.boolean(),
});

const tradeValuationSchema = z.object({
  unsupportedSettings: z.array(z.string()),
  projectionAsOf: z.string().nullable(),
  optimizerVersion: z.literal("lineup-dp-v1"),
});

const tradeTeamSchema = z.object({
  rosterId: z.number().int(),
  ownerId: z.string().nullable(),
  teamName: z.string(),
  isUser: z.boolean(),
  players: z.array(rosterPlayerSchema),
  ownedPicks: z.array(seasonLongRankingSchema),
});

const leagueSchema = z.object({
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

const analyticsEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.string(),
  position: z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]),
  seasonGames: z.number().int(),
  rollingGames: z.number().int(),
  season: z.record(z.string(), z.number()),
  rolling17: z.record(z.string(), z.number()),
});

const teamUsageSchema = z.object({
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

const nflTeamRecordSchema = z.object({
  team: z.string(),
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
});

const analyticsSchema = z.object({
  asOf: z.string().nullable(),
  throughWeek: z.number().int().nullable(),
  sourceUrl: z.string(),
  entities: z.array(analyticsEntitySchema),
  teamUsage: z.array(teamUsageSchema),
  teamRecords: z.array(nflTeamRecordSchema).default([]),
});

const chartDatasetSchema = z.enum(["advanced", "projections"]);
const chartPositionSchema = z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]);
const chartWindowSchema = z.enum(["season", "rolling17"]);
const chartPlotLimitSchema = z.enum(["24", "40", "all"]);
const savedChartViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataset: chartDatasetSchema,
  position: chartPositionSchema,
  xMetric: z.string(),
  yMetric: z.string(),
  window: chartWindowSchema,
  showQuadrants: z.boolean(),
  xPercentile: z.number().int().min(1).max(99),
  yPercentile: z.number().int().min(1).max(99),
  plotLimit: chartPlotLimitSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const savedChartViewInputSchema = savedChartViewSchema.pick({
  dataset: true,
  position: true,
  xMetric: true,
  yMetric: true,
  window: true,
  showQuadrants: true,
  xPercentile: true,
  yPercentile: true,
  plotLimit: true,
}).extend({ name: z.string().trim().min(1).max(80) });
const savedChartViewsResponse = z.object({ views: z.array(savedChartViewSchema) });
const saveChartViewResponse = z.object({ view: savedChartViewSchema });
const deleteChartViewResponse = z.object({ ok: z.literal(true), deleted: z.boolean() });

// Strength of Schedule: per-league defense-vs-position table built from this
// season's completed-week actuals. Rank 1 = softest defense vs that position
// (most fantasy points allowed per week); rank 32 = toughest (fewest allowed).
const strengthOfScheduleCellSchema = z.object({
  avg: z.number(),
  weeks: z.number().int(),
  rank: z.number().int(),
});
const strengthOfScheduleEntrySchema = z.object({
  leagueId: z.string(),
  season: z.number().int(),
  throughWeek: z.number().int(),
  computedAt: z.string(),
  table: z.record(z.string(), z.record(z.enum(["QB", "RB", "WR", "TE"]), strengthOfScheduleCellSchema)),
});
const stagedMatchupGradesSchema = z.object({
  source: z.literal("matchup-grades"),
  season: z.number().int(),
  through_week: z.number().int(),
  built_at: z.string(),
  leagues: z.array(z.object({
    league_id: z.string(),
    league_name: z.string(),
    through_week: z.number().int(),
    completed_weeks: z.array(z.number().int()),
    computed_at: z.string(),
    table: z.record(z.string(), z.record(z.enum(["QB", "RB", "WR", "TE"]), strengthOfScheduleCellSchema)),
  })),
});
const ingestStagedMatchupGradesResponse = z.object({
  ok: z.literal(true),
  status: z.enum(["committed", "ignored"]),
  season: z.number().int(),
  throughWeek: z.number().int(),
  leagues: z.number().int(),
});

const pfnTableKeys = ["offensive-line", "offense", "defense", "team-overall"] as const;
const pfnTableKeySchema = z.enum(pfnTableKeys);
const pfnMetricValueSchema = z.union([z.number(), z.string(), z.null()]);
const pfnRowSchema = z.object({
  rank: z.number().int(),
  team: z.string(),
  team_name: z.string(),
}).catchall(pfnMetricValueSchema);
const pfnTableSchema = z.object({
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(pfnRowSchema),
});
const stagedPfnTablesSchema = z.object({
  source: z.literal("pfn-nfl-hq"),
  fetched_at: z.string(),
  tables: z.object({
    "offensive-line": pfnTableSchema,
    offense: pfnTableSchema,
    defense: pfnTableSchema,
    "team-overall": pfnTableSchema,
  }),
});
const storedPfnTableSchema = pfnTableSchema.extend({ fetched_at: z.string() });
const storedPfnTableEnvelopeSchema = z.object({
  fetched_at: z.string(),
  label: z.string(),
  columns: z.array(z.string()),
  column_labels: z.record(z.string(), z.string()),
  rows: z.array(z.unknown()),
});
const ingestStagedPfnTablesResponse = z.union([
  z.object({ ok: z.literal(false), error: z.literal("staged PFN file not found") }),
  z.object({
    ok: z.literal(true),
    status: z.literal("committed"),
    fetched_at: z.string(),
    tables: z.array(pfnTableKeySchema),
  }),
]);
const teamSituationalStatSchema = z.object({
  team: z.string(),
  games: z.number().int(),
  thirdDownPct: z.number(),
  redZoneTdPct: z.number(),
});
const teamSituationalSnapshotSchema = z.object({
  fetchedAt: z.string(),
  sourceUrl: z.literal(TEAM_SITUATIONAL_STATS_URL),
  rows: z.array(teamSituationalStatSchema),
});
const getPfnTablesResponse = z.object({
  tables: z.object({
    "offensive-line": storedPfnTableSchema.nullable(),
    offense: storedPfnTableSchema.nullable(),
    defense: storedPfnTableSchema.nullable(),
    "team-overall": storedPfnTableSchema.nullable(),
  }),
  teamSituational: teamSituationalSnapshotSchema.nullable(),
});

const matchupBoxScoreResponse = z.object({
  status: z.enum(["available", "not_final", "unavailable", "owner_required"]),
  game: z.object({
    title: z.string(),
    score: z.string(),
    state: z.string().nullable(),
    startsAt: z.string().nullable(),
    home: z.string().nullable(),
    away: z.string().nullable(),
    sourceLabel: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    fetchedAt: z.string(),
  }).nullable(),
});

const dashboardResponse = z.object({
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

const leagueIdentitySchema = leagueSchema.pick({
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
const leagueTeamSchema = leagueSchema.pick({
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
const leaguePowerSchema = leagueSchema.pick({
  id: true,
  powerRankingsWeek: true,
  powerRankingsSeasonLong: true,
  powerRankingsDynasty: true,
});
const dashboardMetaSchema = dashboardResponse.pick({
  status: true,
  season: true,
  week: true,
  asOf: true,
  rankingsAsOf: true,
  fantasyCalcAsOf: true,
  sourceErrors: true,
}).extend({ leagues: z.array(leagueIdentitySchema) });
const dashboardPlayersSchema = dashboardResponse.pick({ rankings: true, weeklyChartRankings: true, seasonLongRankings: true, defenses: true, strengthOfSchedule: true });
const dashboardSectionResponse = z.discriminatedUnion("section", [
  z.object({ section: z.literal("meta"), data: dashboardMetaSchema.nullable() }),
  z.object({ section: z.literal("team"), data: z.object({ leagues: z.array(leagueTeamSchema) }).nullable() }),
  z.object({ section: z.literal("players"), data: dashboardPlayersSchema.nullable() }),
  z.object({ section: z.literal("league"), data: z.object({ leagues: z.array(leaguePowerSchema) }).nullable() }),
  z.object({ section: z.literal("analytics"), data: z.object({ analytics: analyticsSchema }).nullable() }),
]);

const valueHistoryResponse = z.object({
  series: z.array(z.object({
    playerId: z.string(),
    name: z.string(),
    position: z.string(),
    points: z.array(z.object({ date: z.string(), value: z.number().int() })),
  })),
});

const historicalTradePlayerSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  position: z.string(),
  fromRosterId: z.number().int().nullable(),
});
const historicalTradePickSchema = z.object({
  season: z.number().int(),
  round: z.number().int(),
  description: z.string(),
  fromRosterId: z.number().int().nullable(),
  draftedPlayerId: z.string().nullable(),
  draftedPlayerName: z.string().nullable(),
});
const historicalTradeTeamSchema = z.object({
  rosterId: z.number().int(),
  ownerId: z.string().nullable(),
  teamName: z.string(),
  isUserTeam: z.boolean(),
  assets: z.object({
    players: z.array(historicalTradePlayerSchema),
    picks: z.array(historicalTradePickSchema),
    faabReceived: z.number().int(),
  }),
});
const historicalTradeSchema = z.object({
  id: z.string(),
  season: z.number().int(),
  week: z.number().int(),
  createdAt: z.string().datetime(),
  teams: z.array(historicalTradeTeamSchema),
});
const historicalTradesResponse = z.object({
  trades: z.array(historicalTradeSchema),
  seasons: z.array(z.number().int()),
  asOf: z.string(),
  isStale: z.boolean(),
  sourceErrors: z.array(z.string()),
});

const boomBustSeriesSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  weeklyScores: z.array(z.object({ season: z.number().int(), week: z.number().int(), points: z.number() })),
  floor: z.number().nullable(),
  firstQuartile: z.number().nullable(),
  median: z.number().nullable(),
  mean: z.number().nullable(),
  thirdQuartile: z.number().nullable(),
  ceiling: z.number().nullable(),
});

const boomBustHistoryResponse = boomBustSeriesSchema.extend({
  view: z.enum(["season", "last3"]),
  season: z.literal(2026),
  leagueId: z.string(),
  playerId: z.string(),
  gameLog: z.array(z.object({
    season: z.number().int(),
    week: z.number().int(),
    opponent: z.string().nullable(),
    team: z.string().nullable(),
    points: z.number(),
    stats: z.record(z.string(), z.number()),
  })),
  seasonTotals: z.record(z.string(), z.number()),
  coverageNote: z.string().nullable(),
});

const boomBustRangesResponse = z.object({
  rows: z.array(z.object({
    playerId: z.string(),
    floor: z.number(),
    ceiling: z.number(),
    range: z.number(),
    games: z.number().int(),
  })),
  unavailablePlayerIds: z.array(z.string()),
});

const playerNewsInjurySnapshotSchema = z.record(z.string().min(1).max(80), z.string().nullable());

const playerNewsItemInputSchema = z.object({
  playerId: z.string().min(1).max(80),
  player: z.string().min(1).max(120),
  team: z.string().min(1).max(12),
  change: z.string().min(1).max(800),
  leagueIds: z.array(z.string()).max(6),
  newsType: z.enum(["roster", "waiver", "headline"]).default("roster"),
  roleContext: z.string().min(1).max(800),
  sourceLabel: z.string().min(1).max(120),
  sourceUrl: z.string().url().max(2000),
  sourcePublishedAt: z.string().datetime().nullable(),
});

const playerNewsAvailabilitySchema = z.object({
  leagueId: z.string(),
  league: z.string(),
  status: z.enum(["available", "your_roster", "other_roster", "unknown"]),
});

const savePlayerNewsResponse = z.object({
  ok: z.literal(true),
  savedItems: z.number().int(),
});

const playerNewsItemSchema = playerNewsItemInputSchema.extend({
  id: z.string(),
  leagues: z.array(z.string()),
  availability: z.array(playerNewsAvailabilitySchema),
});

const playerNewsRunSchema = z.object({
  id: z.string(),
  checkedAt: z.string(),
  items: z.array(playerNewsItemSchema),
});

const playerNewsResponse = z.object({
  lastCheckedAt: z.string().nullable(),
  runs: z.array(playerNewsRunSchema),
});

const refreshPlayerNewsResponse = z.object({
  started: z.boolean(),
  taskId: z.string().nullable(),
  message: z.string(),
});

const adpRowSchema = z.object({
  format: z.string(),
  pool: z.enum(["all", "rookie"]),
  playerId: z.string().nullable(),
  name: z.string(),
  team: z.string().nullable(),
  position: z.string(),
  adp: z.number(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  timesDrafted: z.number().int().nullable(),
  mflAdp: z.number().nullable(),
});
const trendingRowSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  team: z.string().nullable(),
  position: z.string(),
  count: z.number().int(),
  rank: z.number().int(),
});
const marketSignalSchema = z.object({
  source: z.enum(["Polymarket", "Kalshi", "Action Network"]),
  scope: z.enum(["game", "season"]),
  title: z.string(),
  detail: z.string(),
  probability: z.number().nullable(),
  move: z.number().nullable().default(null),
  quote: z.string().nullable().default(null),
  betPct: z.number().nullable(),
  moneyPct: z.number().nullable(),
});
const vegasLineSchema = z.object({
  source: z.enum(["Polymarket", "Kalshi"]),
  matchupCode: z.string(),
  marketType: z.enum(["total", "spread"]),
  team: z.string().nullable(),
  line: z.number(),
  probability: z.number().nullable(),
});
const draftPickSchema = z.object({
  pickNo: z.number().int(),
  round: z.number().int(),
  draftSlot: z.number().int(),
  rosterId: z.number().int().nullable(),
  playerId: z.string(),
  playerName: z.string(),
  position: z.string(),
  team: z.string().nullable(),
});
const liveDraftSchema = z.object({
  draftId: z.string(),
  leagueId: z.string().nullable(),
  status: z.string(),
  type: z.string(),
  startTime: z.string().nullable(),
  rounds: z.number().int().nullable(),
  teams: z.number().int().nullable(),
  ownDraftSlot: z.number().int().nullable(),
  ownRosterId: z.number().int().nullable(),
  picks: z.array(draftPickSchema),
});
const vegasProjectionLeagueSchema = z.object({
  league_id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
});

const vegasPlayerProjectionSchema = z.object({
  player: z.string().min(1).max(160),
  team: z.string().min(1).max(12),
  position: z.string().min(1).max(12),
  opponent: z.string().max(12).nullable(),
  expected_stats: z.record(z.string(), z.number()),
  td_probability: z.union([z.number(), z.record(z.string(), z.number())]).nullable(),
  coverage: z.object({
    stats: z.union([z.number(), z.array(z.string()), z.record(z.string(), z.number())]),
    provider_count: z.number().int().nonnegative(),
    book_count: z.number().int().nonnegative(),
  }),
  leagues: z.record(z.string(), z.number()),
  components: z.record(z.string(), z.record(z.string(), z.number())),
});

const vegasProjectionPayloadSchema = z.object({
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(25),
  built_at: z.string().datetime(),
  source: z.string().min(1).max(160),
  leagues: z.array(vegasProjectionLeagueSchema).max(32),
  projections: z.array(vegasPlayerProjectionSchema).max(2500),
});

const vegasProjectionChunkPayloadSchema = vegasProjectionPayloadSchema.extend({
  chunk_index: z.number().int().min(0).max(999),
  chunk_count: z.number().int().min(1).max(1000),
}).superRefine((payload, ctx) => {
  if (payload.chunk_index >= payload.chunk_count) {
    ctx.addIssue({ code: "custom", path: ["chunk_index"], message: "chunk_index must be less than chunk_count" });
  }
});

const setVegasProjectionsResponse = z.object({
  ok: z.literal(true),
  season: z.number().int(),
  week: z.number().int(),
  savedProjections: z.number().int(),
});

const setVegasProjectionsChunkResponse = z.object({
  ok: z.boolean(),
  status: z.enum(["buffered", "committed", "ignored", "rejected"]),
  season: z.number().int(),
  week: z.number().int(),
  receivedChunks: z.number().int(),
  chunkCount: z.number().int(),
  savedProjections: z.number().int(),
  message: z.string().nullable(),
});

const ingestStagedProjectionsResponse = z.object({
  ok: z.literal(true),
  status: z.enum(["committed", "ignored"]),
  season: z.number().int(),
  week: z.number().int(),
  savedProjections: z.number().int(),
});

const draftBoardModeSchema = z.object({
  leagueId: z.string(),
  mode: z.enum(["redraft", "startup", "rookie"]),
});

const draftCenterResponse = z.object({
  asOf: z.string(),
  adpAsOf: z.string().nullable(),
  adp: z.array(adpRowSchema),
  trending: z.array(trendingRowSchema),
  trendingDrops: z.array(trendingRowSchema),
  drafts: z.array(liveDraftSchema),
  boardModes: z.array(draftBoardModeSchema),
  markets: z.array(marketSignalSchema),
  vegasLines: z.array(vegasLineSchema),
  sourceStatus: z.object({
    ffc: z.boolean(),
    mfl: z.boolean(),
    sleeperTrending: z.boolean(),
    sleeperTrendingDrops: z.boolean(),
    polymarket: z.boolean(),
    kalshi: z.boolean(),
    actionNetwork: z.boolean(),
    fantasyProsLive: z.boolean(),
  }),
  sourceErrors: z.array(z.string()),
});

type Dashboard = z.infer<typeof dashboardResponse>;
type RosterPlayer = z.infer<typeof rosterPlayerSchema>;
type Ranking = z.infer<typeof rankingSchema>;
type VegasProjectionPayload = z.infer<typeof vegasProjectionPayloadSchema>;

type SleeperLeague = {
  league_id: string;
  name: string;
  season?: string;
  previous_league_id?: string | null;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: { type?: number; reserve_slots?: number; taxi_slots?: number; draft_rounds?: number };
  total_rosters?: number;
};

type SleeperRoster = {
  roster_id: number;
  owner_id?: string;
  players?: string[];
  starters?: string[];
  settings?: { wins?: number; losses?: number; ties?: number };
  metadata?: { team_name?: string };
};

type SleeperMatchup = {
  roster_id: number;
  matchup_id?: number | null;
  points?: number;
  players_points?: Record<string, number>;
};

type SleeperTradedPick = {
  season?: string;
  round?: number;
  roster_id?: number;
  owner_id?: number;
  previous_owner_id?: number;
};

type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};

type SleeperTransaction = {
  transaction_id?: string;
  type?: string;
  status?: string;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  draft_picks?: Array<{
    season?: string;
    round?: number;
    roster_id?: number;
    previous_owner_id?: number;
    owner_id?: number;
  }> | null;
  waiver_budget?: Array<{ sender?: number; receiver?: number; amount?: number }> | null;
  created?: number;
  leg?: number;
};

type SleeperProjection = {
  player_id?: string;
  team?: string;
  player?: { position?: string };
  stats?: Record<string, number> & { pts_ppr?: number; pts_half_ppr?: number; pts_std?: number };
};

type SleeperGame = {
  status?: string;
  week?: number;
  home?: string;
  away?: string;
  date?: string;
};

type EspnScoreboard = {
  events?: Array<{
    date?: string;
    competitions?: Array<{
      competitors?: Array<{
        team?: { abbreviation?: string };
        records?: Array<{ type?: string; summary?: string }>;
      }>;
    }>;
  }>;
};

type SleeperPlayer = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
  injury_status?: string | null;
  injury_notes?: string | null;
  status?: string | null;
  years_exp?: number | null;
};

type FantasyCalcRow = {
  player?: {
    id?: number;
    sleeperId?: string | null;
    name?: string;
    position?: string;
    maybeTeam?: string | null;
  };
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number | null;
};

type FantasyCalcHistoryResponse = {
  historicalValues?: Array<{ date?: string; value?: number }>;
};

type SeasonLongFormat = z.infer<typeof seasonLongFormatSchema>;
type SeasonLongRanking = z.infer<typeof seasonLongRankingSchema>;
type AnalyticsEntity = z.infer<typeof analyticsEntitySchema>;

type StatRow = {
  id: string;
  name: string;
  team: string;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  season: number;
  week: number;
  gameId: string;
  values: Record<string, number>;
};

async function withDeadline<T>(operation: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error("Source request timed out"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  return await withDeadline((async () => {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.json() as T;
  })(), SOURCE_TIMEOUT_MS, () => controller.abort());
}

async function fetchText(url: string, timeoutMs = SOURCE_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  return await withDeadline((async () => {
    const response = await fetch(url, { headers: { Accept: "text/html" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.text();
  })(), timeoutMs, () => controller.abort());
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const RATE_METRICS = new Set(["completion_pct", "cpoe", "epa_per_play", "target_share", "air_yards_share", "wopr", "racr", "fg_pct"]);

function numeric(row: Record<string, string>, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function optionalNumeric(row: Record<string, string>, key: string): number | null {
  const raw = row[key];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function csvRecords(source: string): Record<string, string>[] {
  const rows = parseCsv(source);
  const headers = rows[0] ?? [];
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function playerValues(row: Record<string, string>, position: "QB" | "RB" | "WR" | "TE" | "K"): Record<string, number> {
  const completions = numeric(row, "completions");
  const attempts = numeric(row, "attempts");
  const passingTds = numeric(row, "passing_tds");
  const rushingTds = numeric(row, "rushing_tds");
  const receivingTds = numeric(row, "receiving_tds");
  const fantasyStandard = numeric(row, "fantasy_points");
  const fantasyPpr = numeric(row, "fantasy_points_ppr");
  const values: Record<string, number> = {
    fantasy_ppr: fantasyPpr,
    fantasy_half_ppr: (fantasyStandard + fantasyPpr) / 2,
    fantasy_standard: fantasyStandard,
    total_tds: passingTds + rushingTds + receivingTds,
    passing_first_downs: numeric(row, "passing_first_downs"),
    rushing_first_downs: numeric(row, "rushing_first_downs"),
    receiving_first_downs: numeric(row, "receiving_first_downs"),
    passing_2pt_conversions: numeric(row, "passing_2pt_conversions"),
    rushing_2pt_conversions: numeric(row, "rushing_2pt_conversions"),
    receiving_2pt_conversions: numeric(row, "receiving_2pt_conversions"),
    fumbles: numeric(row, "sack_fumbles") + numeric(row, "rushing_fumbles") + numeric(row, "receiving_fumbles"),
    fumbles_lost: numeric(row, "sack_fumbles_lost") + numeric(row, "rushing_fumbles_lost") + numeric(row, "receiving_fumbles_lost"),
    punt_return_yards: numeric(row, "punt_return_yards"),
    kickoff_return_yards: numeric(row, "kickoff_return_yards"),
    punt_return_tds: numeric(row, "punt_return_tds"),
    kickoff_return_tds: numeric(row, "kickoff_return_tds"),
  };
  if (position === "QB") {
    const passingEpa = numeric(row, "passing_epa");
    const passingSacks = numeric(row, "sacks");
    const passingPlays = attempts + passingSacks;
    Object.assign(values, {
      completions,
      pass_attempts: attempts,
      completion_pct: attempts > 0 ? (completions / attempts) * 100 : 0,
      passing_yards: numeric(row, "passing_yards"),
      passing_tds: passingTds,
      interceptions: numeric(row, "passing_interceptions"),
      passing_air_yards: numeric(row, "passing_air_yards"),
      passing_epa: passingEpa,
      epa_per_play: passingPlays > 0 ? passingEpa / passingPlays : 0,
      passing_sacks: passingSacks,
      sack_yards: numeric(row, "sack_yards"),
      carries: numeric(row, "carries"),
      rushing_yards: numeric(row, "rushing_yards"),
      rushing_tds: rushingTds,
    });
    const cpoe = optionalNumeric(row, "passing_cpoe");
    if (cpoe !== null) values.cpoe = cpoe;
  } else if (position === "RB") {
    const carries = numeric(row, "carries");
    const targets = numeric(row, "targets");
    const receptions = numeric(row, "receptions");
    const rushingYards = numeric(row, "rushing_yards");
    const receivingYards = numeric(row, "receiving_yards");
    Object.assign(values, {
      carries,
      targets,
      touches: carries + receptions,
      receptions,
      rushing_yards: rushingYards,
      receiving_yards: receivingYards,
      scrimmage_yards: rushingYards + receivingYards,
      rushing_tds: rushingTds,
      receiving_tds: receivingTds,
      rushing_epa: numeric(row, "rushing_epa"),
      receiving_epa: numeric(row, "receiving_epa"),
    });
    const targetShare = optionalNumeric(row, "target_share");
    if (targetShare !== null) values.target_share = targetShare * 100;
  } else if (position === "WR" || position === "TE") {
    Object.assign(values, {
      carries: numeric(row, "carries"),
      rushing_yards: numeric(row, "rushing_yards"),
      rushing_tds: rushingTds,
      targets: numeric(row, "targets"),
      receptions: numeric(row, "receptions"),
      receiving_yards: numeric(row, "receiving_yards"),
      receiving_air_yards: numeric(row, "receiving_air_yards"),
      receiving_tds: receivingTds,
      receiving_epa: numeric(row, "receiving_epa"),
      yards_after_catch: numeric(row, "receiving_yards_after_catch"),
    });
    const ratios: Array<[string, string, number]> = [
      ["target_share", "target_share", 100],
      ["air_yards_share", "air_yards_share", 100],
      ["wopr", "wopr", 1],
      ["racr", "racr", 1],
    ];
    for (const [metric, field, multiplier] of ratios) {
      const value = optionalNumeric(row, field);
      if (value !== null) values[metric] = value * multiplier;
    }
  } else {
    const fgMade = numeric(row, "fg_made");
    const fgAtt = numeric(row, "fg_att");
    const patMade = numeric(row, "pat_made");
    const patAtt = numeric(row, "pat_att");
    Object.assign(values, {
      fg_made: fgMade,
      fg_attempts: fgAtt,
      fg_pct: fgAtt > 0 ? (fgMade / fgAtt) * 100 : 0,
      fg_made_0_19: numeric(row, "fg_made_0_19"),
      fg_made_20_29: numeric(row, "fg_made_20_29"),
      fg_made_30_39: numeric(row, "fg_made_30_39"),
      fg_made_40_49: numeric(row, "fg_made_40_49"),
      fg_made_50_59: numeric(row, "fg_made_50_59"),
      fg_made_60_plus: numeric(row, "fg_made_60_"),
      fg_attempts_0_19: numeric(row, "fg_att_0_19"),
      fg_attempts_20_29: numeric(row, "fg_att_20_29"),
      fg_attempts_30_39: numeric(row, "fg_att_30_39"),
      fg_attempts_40_49: numeric(row, "fg_att_40_49"),
      fg_attempts_50_59: numeric(row, "fg_att_50_59"),
      fg_attempts_60_plus: numeric(row, "fg_att_60_"),
      fg_40_plus: numeric(row, "fg_made_40_49") + numeric(row, "fg_made_50_59") + numeric(row, "fg_made_60_"),
      fg_50_plus: numeric(row, "fg_made_50_59") + numeric(row, "fg_made_60_"),
      pat_made: patMade,
      pat_attempts: patAtt,
      kicks_made: fgMade + patMade,
    });
  }
  const snapShare = optionalNumeric(row, "snap_share");
  if (snapShare !== null) values.snap_share = snapShare * 100;
  return values;
}

function parseAnalyticsRows(csv: string): StatRow[] {
  const rows = csvRecords(csv).filter((row) => row.season_type === "REG");
  const output: StatRow[] = [];
  const defenses = new Map<string, StatRow>();
  const offenseYardsByGameTeam = new Map<string, number>();
  const teamsByGame = new Map<string, Set<string>>();
  for (const row of rows) {
    const season = Number(row.season);
    const week = Number(row.week);
    const gameId = row.game_id ?? "";
    const team = canonicalTeam(row.team ?? row.recent_team ?? "");
    if (!Number.isFinite(season) || !Number.isFinite(week) || !gameId || !team) continue;
    const gameKey = `${season}:${gameId}`;
    const gameTeams = teamsByGame.get(gameKey) ?? new Set<string>();
    gameTeams.add(team);
    teamsByGame.set(gameKey, gameTeams);
    const offenseKey = `${gameKey}:${team}`;
    offenseYardsByGameTeam.set(offenseKey, (offenseYardsByGameTeam.get(offenseKey) ?? 0) + numeric(row, "passing_yards") + numeric(row, "rushing_yards"));
    const position = row.position;
    if (position === "QB" || position === "RB" || position === "WR" || position === "TE" || position === "K") {
      const id = row.player_id ?? "";
      const name = row.player_display_name ?? row.player_name ?? "";
      if (id && name) output.push({ id, name, team, position, season, week, gameId, values: playerValues(row, position) });
    }

    const defenseKey = `${season}:${gameId}:${team}`;
    const defense = defenses.get(defenseKey) ?? {
      id: team,
      name: `${team} Defense`,
      team,
      position: "DEF" as const,
      season,
      week,
      gameId,
      values: {
        sacks: 0,
        interceptions: 0,
        forced_fumbles: 0,
        fumble_recoveries: 0,
        takeaways: 0,
        tackles_for_loss: 0,
        qb_hits: 0,
        passes_defended: 0,
        defensive_tds: 0,
        blocked_kicks: 0,
        safeties: 0,
        defensive_two_point_returns: 0,
        return_tds: 0,
        return_yards: 0,
      },
    };
    const interceptions = numeric(row, "def_interceptions");
    const recoveries = numeric(row, "fumble_recovery_opp");
    defense.values.sacks = (defense.values.sacks ?? 0) + numeric(row, "def_sacks");
    defense.values.interceptions = (defense.values.interceptions ?? 0) + interceptions;
    defense.values.forced_fumbles = (defense.values.forced_fumbles ?? 0) + numeric(row, "def_fumbles_forced");
    defense.values.fumble_recoveries = (defense.values.fumble_recoveries ?? 0) + recoveries;
    defense.values.takeaways = (defense.values.takeaways ?? 0) + interceptions + recoveries;
    defense.values.tackles_for_loss = (defense.values.tackles_for_loss ?? 0) + numeric(row, "def_tackles_for_loss");
    defense.values.qb_hits = (defense.values.qb_hits ?? 0) + numeric(row, "def_qb_hits");
    defense.values.passes_defended = (defense.values.passes_defended ?? 0) + numeric(row, "def_pass_defended");
    defense.values.defensive_tds = (defense.values.defensive_tds ?? 0) + numeric(row, "def_tds");
    defense.values.blocked_kicks = (defense.values.blocked_kicks ?? 0) + numeric(row, "def_punt_blocks") + numeric(row, "def_pat_blocks") + numeric(row, "def_fg_blocks");
    defense.values.safeties = (defense.values.safeties ?? 0) + numeric(row, "def_safeties");
    defense.values.defensive_two_point_returns = (defense.values.defensive_two_point_returns ?? 0) + numeric(row, "def_2pt");
    defense.values.return_tds = (defense.values.return_tds ?? 0) + numeric(row, "punt_return_tds") + numeric(row, "kickoff_return_tds");
    defense.values.return_yards = (defense.values.return_yards ?? 0) + numeric(row, "punt_return_yards") + numeric(row, "kickoff_return_yards");
    defenses.set(defenseKey, defense);
  }
  for (const defense of defenses.values()) {
    const gameKey = `${defense.season}:${defense.gameId}`;
    const opponent = [...(teamsByGame.get(gameKey) ?? [])].find((team) => team !== defense.team);
    if (!opponent) continue;
    const yardsAllowed = offenseYardsByGameTeam.get(`${gameKey}:${opponent}`);
    if (yardsAllowed !== undefined) defense.values.yards_allowed = yardsAllowed;
  }
  return [...output, ...defenses.values()];
}

function averageMetrics(rows: StatRow[]): Record<string, number> {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.values)) {
      totals.set(key, (totals.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const output: Record<string, number> = {};
  for (const [key, total] of totals) {
    const divisor = RATE_METRICS.has(key) ? (counts.get(key) ?? rows.length) : rows.length;
    if (divisor > 0) output[key] = Number((total / divisor).toFixed(3));
  }
  return output;
}

type TeamGameProduction = {
  passAttempts: number;
  rushAttempts: number;
  passingYards: number;
  sackYards: number;
  rushingYards: number;
  receivingTouchdowns: number;
  rushingTouchdowns: number;
  returnTouchdowns: number;
  defensiveTouchdowns: number;
  fieldGoals: number;
  extraPoints: number;
  twoPointConversions: number;
  safeties: number;
  defensiveTwoPointReturns: number;
  interceptionsThrown: number;
  fumblesLost: number;
};

function emptyTeamGameProduction(): TeamGameProduction {
  return {
    passAttempts: 0,
    rushAttempts: 0,
    passingYards: 0,
    sackYards: 0,
    rushingYards: 0,
    receivingTouchdowns: 0,
    rushingTouchdowns: 0,
    returnTouchdowns: 0,
    defensiveTouchdowns: 0,
    fieldGoals: 0,
    extraPoints: 0,
    twoPointConversions: 0,
    safeties: 0,
    defensiveTwoPointReturns: 0,
    interceptionsThrown: 0,
    fumblesLost: 0,
  };
}

function buildTeamUsage(rows: StatRow[]): z.infer<typeof teamUsageSchema>[] {
  const byTeam = new Map<string, Map<string, TeamGameProduction>>();
  for (const row of rows) {
    const teamGames = byTeam.get(row.team) ?? new Map<string, TeamGameProduction>();
    const game = teamGames.get(row.gameId) ?? emptyTeamGameProduction();
    if (row.position === "QB") {
      game.passAttempts += row.values.pass_attempts ?? 0;
      game.passingYards += row.values.passing_yards ?? 0;
      game.sackYards += row.values.sack_yards ?? 0;
      game.interceptionsThrown += row.values.interceptions ?? 0;
    }
    if ((["QB", "RB", "WR", "TE"] as string[]).includes(row.position)) {
      game.rushAttempts += row.values.carries ?? 0;
      game.rushingYards += row.values.rushing_yards ?? 0;
      game.receivingTouchdowns += row.values.receiving_tds ?? 0;
      game.rushingTouchdowns += row.values.rushing_tds ?? 0;
      game.twoPointConversions += (row.values.rushing_2pt_conversions ?? 0) + (row.values.receiving_2pt_conversions ?? 0);
      game.fumblesLost += row.values.fumbles_lost ?? 0;
    }
    if (row.position !== "DEF") {
      game.returnTouchdowns += (row.values.punt_return_tds ?? 0) + (row.values.kickoff_return_tds ?? 0);
    }
    if (row.position === "K") {
      game.fieldGoals += row.values.fg_made ?? 0;
      game.extraPoints += row.values.pat_made ?? 0;
    }
    if (row.position === "DEF") {
      game.defensiveTouchdowns += row.values.defensive_tds ?? 0;
      game.safeties += row.values.safeties ?? 0;
      game.defensiveTwoPointReturns += row.values.defensive_two_point_returns ?? 0;
    }
    teamGames.set(row.gameId, game);
    byTeam.set(row.team, teamGames);
  }
  return [...byTeam.entries()].flatMap(([team, games]) => {
    if (games.size === 0) return [];
    const totals = emptyTeamGameProduction();
    for (const game of games.values()) {
      for (const key of Object.keys(totals) as Array<keyof TeamGameProduction>) {
        totals[key] += game[key];
      }
    }
    const plays = totals.passAttempts + totals.rushAttempts;
    if (plays <= 0) return [];
    const passingYards = Math.max(0, Math.round(totals.passingYards - totals.sackYards));
    const rushingYards = Math.round(totals.rushingYards);
    const offensiveTouchdowns = Math.round(totals.receivingTouchdowns + totals.rushingTouchdowns);
    const pointsScored = Math.round(
      (offensiveTouchdowns + totals.returnTouchdowns + totals.defensiveTouchdowns) * 6
      + totals.fieldGoals * 3
      + totals.extraPoints
      + (totals.twoPointConversions + totals.safeties + totals.defensiveTwoPointReturns) * 2,
    );
    return [{
      team,
      games: games.size,
      pointsScored,
      totalYards: passingYards + rushingYards,
      passingYards,
      rushingYards,
      offensiveTouchdowns,
      turnovers: Math.round(totals.interceptionsThrown + totals.fumblesLost),
      playsPerGame: Number((plays / games.size).toFixed(1)),
      passPct: Number(((totals.passAttempts / plays) * 100).toFixed(1)),
      runPct: Number(((totals.rushAttempts / plays) * 100).toFixed(1)),
    }];
  }).sort((a, b) => a.team.localeCompare(b.team));
}

function nflTeamRecordsFromScoreboard(scoreboard: EspnScoreboard): z.infer<typeof nflTeamRecordSchema>[] {
  const records = new Map<string, z.infer<typeof nflTeamRecordSchema>>();
  for (const event of scoreboard.events ?? []) {
    for (const competition of event.competitions ?? []) {
      for (const competitor of competition.competitors ?? []) {
        const abbreviation = competitor.team?.abbreviation;
        if (!abbreviation) continue;
        const summary = competitor.records?.find((record) => record.type === "total")?.summary
          ?? competitor.records?.[0]?.summary;
        if (!summary) continue;
        const parts = summary.split("-").map(Number);
        const wins = parts[0];
        const losses = parts[1];
        const ties = parts[2] ?? 0;
        if (wins === undefined || losses === undefined || !Number.isInteger(wins) || !Number.isInteger(losses) || !Number.isInteger(ties)) continue;
        records.set(canonicalTeam(abbreviation), { team: canonicalTeam(abbreviation), wins, losses, ties });
      }
    }
  }
  return [...records.values()].sort((a, b) => a.team.localeCompare(b.team));
}

function buildAnalytics(previousCsv: string, currentCsv: string, season: number): { throughWeek: number | null; entities: AnalyticsEntity[]; teamUsage: z.infer<typeof teamUsageSchema>[] } {
  const allRows = [...parseAnalyticsRows(previousCsv), ...parseAnalyticsRows(currentCsv)];
  const currentRows = allRows.filter((row) => row.season === season);
  const activeKeys = new Set(currentRows.map((row) => `${row.position}:${row.id}`));
  const byKey = new Map<string, StatRow[]>();
  for (const row of allRows) {
    const key = `${row.position}:${row.id}`;
    if (!activeKeys.has(key)) continue;
    const group = byKey.get(key) ?? [];
    group.push(row);
    byKey.set(key, group);
  }
  const entities: AnalyticsEntity[] = [];
  for (const [key, rowsForEntity] of byKey) {
    const ordered = rowsForEntity.slice().sort((a, b) => b.season - a.season || b.week - a.week);
    const latest = ordered[0];
    if (!latest) continue;
    const seasonRows = ordered.filter((row) => row.season === season);
    const rollingRows = ordered.slice(0, 17);
    if (seasonRows.length === 0) continue;
    entities.push({
      id: key,
      name: latest.name,
      team: latest.team,
      position: latest.position,
      seasonGames: seasonRows.length,
      rollingGames: rollingRows.length,
      season: averageMetrics(seasonRows),
      rolling17: averageMetrics(rollingRows),
    });
  }
  entities.sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
  const throughWeek = currentRows.reduce<number | null>((maximum, row) => maximum === null ? row.week : Math.max(maximum, row.week), null);
  return { throughWeek, entities, teamUsage: buildTeamUsage(currentRows) };
}

function normalizePosition(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "DST") return "DEF";
  return value;
}

function normalizedAvailabilityStatus(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
}

function isUnavailableForCurrentWeek(status: string | null | undefined): boolean {
  if (!status) return false;
  return new Set([
    "out",
    "inactive",
    "ir",
    "injured reserve",
    "pup",
    "physically unable to perform",
    "nfi",
    "non football injury",
    "non football illness",
    "suspended",
    "suspension",
    "reserve suspended",
  ]).has(normalizedAvailabilityStatus(status));
}

function weeklyAvailabilityStatus(player: SleeperPlayer | undefined): string | null {
  if (!player) return null;
  const injuryStatus = player.injury_status?.trim() || null;
  if (isUnavailableForCurrentWeek(injuryStatus)) return injuryStatus;
  const rosterStatus = player.status?.trim() || null;
  if (isUnavailableForCurrentWeek(rosterStatus)) return rosterStatus;
  const injuryNotes = player.injury_notes?.trim() || null;
  if (injuryNotes && /\b(out for (?:the )?(?:week|season|year)|ruled out|season[ -]ending|miss (?:the )?rest of (?:the )?(?:season|year)|placed on injured reserve)\b/i.test(injuryNotes)) {
    return injuryStatus ?? "Out";
  }
  return injuryStatus;
}

function isEligible(position: string, slot: string): boolean {
  if (slot === position) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
  if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
  return false;
}

const FLEX_LINEUP_SLOTS = new Set(["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"]);

function relabelOptimizedLineup(players: RosterPlayer[], slots: string[]): RosterPlayer[] {
  if (players.length !== slots.length || players.length === 0) return players;
  type LabelState = { flexTotal: number; flexValues: number[]; exactCount: number; assignments: number[] };
  const compareFlexValues = (left: number[], right: number[]) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const leftValue = left[index] ?? 0;
      const rightValue = right[index] ?? 0;
      if (leftValue !== rightValue) return leftValue - rightValue;
    }
    return left.length - right.length;
  };
  let states = new Map<number, LabelState>([[0, { flexTotal: 0, flexValues: [], exactCount: 0, assignments: [] }]]);

  slots.forEach((slot) => {
    const next = new Map<number, LabelState>();
    for (const [mask, state] of states) {
      players.forEach((player, playerIndex) => {
        const bit = 2 ** playerIndex;
        if ((mask & bit) !== 0 || !isEligible(player.position, slot)) return;
        const flexValue = player.projection ?? -1000;
        const isFlexSlot = FLEX_LINEUP_SLOTS.has(slot);
        const candidate: LabelState = {
          flexTotal: state.flexTotal + (isFlexSlot ? flexValue : 0),
          flexValues: isFlexSlot ? [...state.flexValues, flexValue] : state.flexValues,
          exactCount: state.exactCount + (slot === player.position ? 1 : 0),
          assignments: [...state.assignments, playerIndex],
        };
        const nextMask = mask | bit;
        const existing = next.get(nextMask);
        const flexOrder = existing ? compareFlexValues(candidate.flexValues, existing.flexValues) : -1;
        if (
          !existing
          || candidate.flexTotal < existing.flexTotal
          || (candidate.flexTotal === existing.flexTotal && flexOrder < 0)
          || (candidate.flexTotal === existing.flexTotal && flexOrder === 0 && candidate.exactCount > existing.exactCount)
        ) {
          next.set(nextMask, candidate);
        }
      });
    }
    states = next;
  });

  const fullMask = 2 ** players.length - 1;
  const best = states.get(fullMask);
  if (!best) return players;
  const assignments = best.assignments.map((playerIndex) => players[playerIndex]).filter((player): player is RosterPlayer => Boolean(player));
  return assignments.map((player, index) => ({ ...player, isStarter: true, lineupSlot: slots[index] ?? player.position }));
}

function effectiveOptimizerValue(player: RosterPlayer): number {
  return player.gamePhase === "final"
    ? (player.actual ?? player.projection ?? -1000)
    : (player.projection ?? -1000);
}

function optimizeWeeklyPowerLineup(startersInput: RosterPlayer[], benchInput: RosterPlayer[]): RosterPlayer[] {
  // Keep this in lockstep with the Matchup view's optimizer. In particular,
  // derive slots from the submitted lineup (so an empty Sleeper slot stays
  // empty), optimize on the same displayed values (final actuals once games
  // are final), and prefer the submitted starter when two choices are equal.
  const slots = startersInput.map((player) => player.lineupSlot ?? player.position);
  const roster = [...startersInput, ...benchInput];
  const currentStarterIds = new Set(startersInput.map((player) => player.playerId));
  type State = { score: number; currentCount: number; assignments: Array<RosterPlayer | undefined> };
  let states = new Map<number, State>([[0, { score: 0, currentCount: 0, assignments: Array.from({ length: slots.length }) }]]);

  for (const player of roster) {
    const next = new Map(states);
    for (const [mask, state] of states) {
      slots.forEach((slot, slotIndex) => {
        const bit = 2 ** slotIndex;
        if ((mask & bit) !== 0 || !isEligible(player.position, slot)) return;
        const nextMask = mask | bit;
        const contender: State = {
          score: state.score + effectiveOptimizerValue(player),
          currentCount: state.currentCount + (currentStarterIds.has(player.playerId) ? 1 : 0),
          assignments: state.assignments.map((assigned, index) => index === slotIndex ? player : assigned),
        };
        const existing = next.get(nextMask);
        if (!existing || contender.score > existing.score || (contender.score === existing.score && contender.currentCount > existing.currentCount)) {
          next.set(nextMask, contender);
        }
      });
    }
    states = next;
  }

  const countBits = (value: number): number => value.toString(2).replaceAll("0", "").length;
  let bestMask = 0;
  let bestState = states.get(0) ?? { score: 0, currentCount: 0, assignments: [] };
  for (const [mask, state] of states) {
    const filled = countBits(mask);
    const bestFilled = countBits(bestMask);
    if (filled > bestFilled || (filled === bestFilled && (state.score > bestState.score || (state.score === bestState.score && state.currentCount > bestState.currentCount)))) {
      bestMask = mask;
      bestState = state;
    }
  }

  const optimized = bestState.assignments.flatMap((player) => player ? [player] : []);
  const filledSlots = bestState.assignments.flatMap((player, index) => player ? [slots[index] ?? player.position] : []);
  return relabelOptimizedLineup(optimized, filledSlots);
}

function makeSuggestion(starters: RosterPlayer[], bench: RosterPlayer[]): z.infer<typeof suggestionSchema> {
  let best: z.infer<typeof suggestionSchema> = null;
  for (const reserve of bench) {
    if (reserve.projection === null && (reserve.gamePhase !== "final" || reserve.actual === null)) continue;
    for (const starter of starters) {
      if (
        !starter.lineupSlot
        || (starter.projection === null && (starter.gamePhase !== "final" || starter.actual === null))
        || !isEligible(reserve.position, starter.lineupSlot)
      ) continue;
      const delta = effectiveOptimizerValue(reserve) - effectiveOptimizerValue(starter);
      if (delta >= 0.5 && (!best || delta > best.delta)) {
        best = { inPlayer: reserve.name, outPlayer: starter.name, delta, slot: starter.lineupSlot };
      }
    }
  }
  return best;
}

function isDynasticalPpfdLeague(league: Pick<SleeperLeague, "league_id" | "name">): boolean {
  return league.league_id === DYNASTICAL_CUCKS_LEAGUE_ID || league.name.toLowerCase().includes("dynastical cucks");
}

function seasonLongFormatForLeague(league: SleeperLeague): SeasonLongFormat {
  const rosterPositions = league.roster_positions ?? [];
  const numQbs = rosterPositions.includes("SUPER_FLEX") || rosterPositions.filter((slot) => slot === "QB").length > 1 ? 2 : 1;
  const isPpfdLeague = isDynasticalPpfdLeague(league);
  // FantasyCalc has no points-per-first-down format. Use its nearest fetched
  // dynasty PPR preset for market values without pretending those values are PPFD.
  const ppr = isPpfdLeague ? 1 : league.scoring_settings?.rec === 1 ? 1 : league.scoring_settings?.rec === 0 ? 0 : 0.5;
  const isDynasty = league.settings?.type === 2 || league.name.toLowerCase().includes("dynasty");
  const numTeams = Math.max(2, Math.min(32, league.total_rosters ?? 12));
  const key = `${isDynasty ? "dynasty" : "redraft"}-${numQbs}qb-${numTeams}t-${ppr}ppr`;
  const scoring = isPpfdLeague ? "PPR proxy · PPFD league" : ppr === 1 ? "PPR" : ppr === 0.5 ? "Half PPR" : "Standard";
  return {
    key,
    isDynasty,
    numQbs,
    numTeams,
    ppr,
    label: `${isDynasty ? "Dynasty" : "Redraft"} · ${numTeams}-team · ${numQbs === 2 ? "Superflex / 2QB" : "1QB"} · ${scoring}`,
  };
}

const FANTASY_CALC_PRESETS: Array<{ format: SeasonLongFormat; url: string }> = [
  {
    format: { key: "redraft-1qb-12t-0.5ppr", isDynasty: false, numQbs: 1, numTeams: 12, ppr: 0.5, label: "Redraft · 12-team · 1QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5`,
  },
  {
    format: { key: "redraft-1qb-10t-0.5ppr", isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, label: "Redraft · 10-team · 1QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=10&ppr=0.5`,
  },
  {
    format: { key: "redraft-1qb-12t-1ppr", isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, label: "Redraft · 12-team · 1QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=1&numTeams=12&ppr=1`,
  },
  {
    format: { key: "redraft-2qb-14t-1ppr", isDynasty: false, numQbs: 2, numTeams: 14, ppr: 1, label: "Redraft · 14-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=14&ppr=1`,
  },
  {
    format: { key: "redraft-2qb-12t-0.5ppr", isDynasty: false, numQbs: 2, numTeams: 12, ppr: 0.5, label: "Redraft · 12-team · Superflex / 2QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=12&ppr=0.5`,
  },
  {
    format: { key: "redraft-2qb-12t-1ppr", isDynasty: false, numQbs: 2, numTeams: 12, ppr: 1, label: "Redraft · 12-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=false&numQbs=2&numTeams=12&ppr=1`,
  },
  {
    format: { key: "dynasty-1qb-10t-0.5ppr", isDynasty: true, numQbs: 1, numTeams: 10, ppr: 0.5, label: "Dynasty · 10-team · 1QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=1&numTeams=10&ppr=0.5`,
  },
  {
    format: { key: "dynasty-1qb-12t-1ppr", isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1, label: "Dynasty · 12-team · 1QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=1&numTeams=12&ppr=1`,
  },
  {
    format: { key: "dynasty-2qb-14t-1ppr", isDynasty: true, numQbs: 2, numTeams: 14, ppr: 1, label: "Dynasty · 14-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=14&ppr=1`,
  },
  {
    format: { key: "dynasty-2qb-12t-0.5ppr", isDynasty: true, numQbs: 2, numTeams: 12, ppr: 0.5, label: "Dynasty · 12-team · Superflex / 2QB · Half PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5`,
  },
  {
    format: { key: "dynasty-2qb-12t-1ppr", isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, label: "Dynasty · 12-team · Superflex / 2QB · PPR" },
    url: `${FANTASY_CALC_VALUES_URL}?isDynasty=true&numQbs=2&numTeams=12&ppr=1`,
  },
];

async function loadPreset(
  { format, url }: (typeof FANTASY_CALC_PRESETS)[number],
  sleeperPlayers: Record<string, SleeperPlayer>,
): Promise<SeasonLongRanking[]> {
  const rows = await fetchJson<FantasyCalcRow[]>(url);
  const positions = new Set(format.isDynasty ? ["QB", "RB", "WR", "TE", "PICK"] : ["QB", "RB", "WR", "TE"]);
  return rows.flatMap((row) => {
    const playerId = row.player?.sleeperId;
    const position = row.player?.position;
    if (!playerId || !position || !positions.has(position) || typeof row.player?.name !== "string" || typeof row.value !== "number" || typeof row.overallRank !== "number" || typeof row.positionRank !== "number") return [];
    return [{
      formatKey: format.key,
      playerId,
      name: row.player.name,
      team: row.player.maybeTeam ?? null,
      position: position as "QB" | "RB" | "WR" | "TE" | "PICK",
      overallRank: row.overallRank,
      positionRank: row.positionRank,
      value: Math.round(row.value),
      trend30Day: typeof row.trend30Day === "number" ? Math.round(row.trend30Day) : null,
      isRookie: position !== "PICK" && sleeperPlayers[playerId]?.years_exp === 0,
    }];
  });
}

async function fetchFantasyCalcRankings(sleeperPlayers: Record<string, SleeperPlayer>): Promise<{ rows: SeasonLongRanking[]; failedPresets: number }> {
  const results = await Promise.allSettled(FANTASY_CALC_PRESETS.map((preset) => loadPreset(preset, sleeperPlayers)));
  const rowsByPreset: Array<SeasonLongRanking[] | undefined> = results.map((result) => result.status === "fulfilled" ? result.value : undefined);
  const failedPresetIndexes = results.flatMap((result, index) => result.status === "rejected" ? [index] : []);
  let failedPresets = 0;

  for (const index of failedPresetIndexes) {
    const preset = FANTASY_CALC_PRESETS[index];
    if (!preset) {
      failedPresets += 1;
      continue;
    }

    let recoveredRows: SeasonLongRanking[] | undefined;
    for (let retry = 0; retry < 2; retry += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      try {
        recoveredRows = await loadPreset(preset, sleeperPlayers);
        break;
      } catch {
        // Retry this preset once more before marking it unavailable.
      }
    }

    if (recoveredRows) rowsByPreset[index] = recoveredRows;
    else failedPresets += 1;
  }

  return {
    rows: rowsByPreset.flatMap((rows) => rows ?? []),
    failedPresets,
  };
}

function canonicalTeam(team: string): string {
  if (team === "JAC") return "JAX";
  if (team === "LA") return "LAR";
  if (team === "LVR") return "LV";
  if (team === "OAK") return "LV";
  if (team === "WSH") return "WAS";
  return team;
}

const NFL_TEAM_NAME_TO_CODE: Record<string, string> = {
  ARIZONACARDINALS: "ARI", CARDINALS: "ARI",
  ATLANTAFALCONS: "ATL", FALCONS: "ATL",
  BALTIMORERAVENS: "BAL", RAVENS: "BAL",
  BUFFALOBILLS: "BUF", BILLS: "BUF",
  CAROLINAPANTHERS: "CAR", PANTHERS: "CAR",
  CHICAGOBEARS: "CHI", BEARS: "CHI",
  CINCINNATIBENGALS: "CIN", BENGALS: "CIN",
  CLEVELANDBROWNS: "CLE", BROWNS: "CLE",
  DALLASCOWBOYS: "DAL", COWBOYS: "DAL",
  DENVERBRONCOS: "DEN", BRONCOS: "DEN",
  DETROITLIONS: "DET", LIONS: "DET",
  GREENBAYPACKERS: "GB", PACKERS: "GB",
  HOUSTONTEXANS: "HOU", TEXANS: "HOU",
  INDIANAPOLISCOLTS: "IND", COLTS: "IND",
  JACKSONVILLEJAGUARS: "JAX", JAGUARS: "JAX",
  KANSASCITYCHIEFS: "KC", CHIEFS: "KC",
  LASVEGASRAIDERS: "LV", RAIDERS: "LV",
  LOSANGELESCHARGERS: "LAC", CHARGERS: "LAC",
  LOSANGELESRAMS: "LAR", RAMS: "LAR",
  MIAMIDOLPHINS: "MIA", DOLPHINS: "MIA",
  MINNESOTAVIKINGS: "MIN", VIKINGS: "MIN",
  NEWENGLANDPATRIOTS: "NE", PATRIOTS: "NE",
  NEWORLEANSSAINTS: "NO", SAINTS: "NO",
  NEWYORKGIANTS: "NYG", GIANTS: "NYG",
  NEWYORKJETS: "NYJ", JETS: "NYJ",
  PHILADELPHIAEAGLES: "PHI", EAGLES: "PHI",
  PITTSBURGHSTEELERS: "PIT", STEELERS: "PIT",
  SANFRANCISCO49ERS: "SF", "49ERS": "SF",
  SEATTLESEAHAWKS: "SEA", SEAHAWKS: "SEA",
  TAMPABAYBUCCANEERS: "TB", BUCCANEERS: "TB",
  TENNESSEETITANS: "TEN", TITANS: "TEN",
  WASHINGTONCOMMANDERS: "WAS", COMMANDERS: "WAS",
};

function sportsTeamCodes(value: string | null | undefined): string[] {
  if (!value) return [];
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2,3}$/.test(normalized)) return [canonicalTeam(normalized)];
  const exact = NFL_TEAM_NAME_TO_CODE[normalized];
  if (exact) return [exact];
  return [...new Set(Object.entries(NFL_TEAM_NAME_TO_CODE)
    .filter(([name]) => normalized.includes(name))
    .map(([, code]) => code))];
}

function htmlCellText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSituationalPercentage(value: string): number | null {
  const parsed = Number(value.replace("%", "").trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function parseTeamSituationalStats(html: string): z.infer<typeof teamSituationalStatSchema>[] {
  const output = new Map<string, z.infer<typeof teamSituationalStatSchema>>();
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    if (!rowHtml) continue;
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => htmlCellText(cell[1] ?? ""));
    if (cells.length < 15) continue;
    const [teamName = "", gamesText = ""] = cells;
    const team = sportsTeamCodes(teamName)[0];
    const games = Number(gamesText);
    const thirdDownPct = parseSituationalPercentage(cells[8] ?? "");
    const redZoneTdPct = parseSituationalPercentage(cells[14] ?? "");
    if (!team || !Number.isInteger(games) || games < 0 || thirdDownPct === null || redZoneTdPct === null) continue;
    output.set(team, { team, games, thirdDownPct, redZoneTdPct });
  }
  return [...output.values()].sort((a, b) => a.team.localeCompare(b.team));
}

async function loadTeamSituationalSnapshot(ctx: Ctx): Promise<z.infer<typeof teamSituationalSnapshotSchema> | null> {
  const db = ctx.db<typeof schema>();
  const [cached] = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, TEAM_SITUATIONAL_CACHE_KEY)).limit(1);
  let cachedSnapshot: z.infer<typeof teamSituationalSnapshotSchema> | null = null;
  if (cached) {
    try {
      const parsed = teamSituationalSnapshotSchema.safeParse(JSON.parse(cached.payload));
      cachedSnapshot = parsed.success ? parsed.data : null;
    } catch { /* malformed cache is treated as a miss */ }
    if (cachedSnapshot && Date.now() - cached.fetchedAt.getTime() < TEAM_SITUATIONAL_CACHE_MS) return cachedSnapshot;
  }

  try {
    const rows = parseTeamSituationalStats(await fetchText(TEAM_SITUATIONAL_STATS_URL));
    if (rows.length < 30) throw new Error("Situational feed did not contain a complete NFL table");
    const snapshot: z.infer<typeof teamSituationalSnapshotSchema> = {
      fetchedAt: new Date().toISOString(),
      sourceUrl: TEAM_SITUATIONAL_STATS_URL,
      rows,
    };
    await db.insert(schema.sourceCache).values({
      cacheKey: TEAM_SITUATIONAL_CACHE_KEY,
      payload: JSON.stringify(snapshot),
      fetchedAt: new Date(snapshot.fetchedAt),
    }).onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload: JSON.stringify(snapshot), fetchedAt: new Date(snapshot.fetchedAt) },
    });
    return snapshot;
  } catch {
    return cachedSnapshot;
  }
}

function localKickoffIso(year: number, month: number, day: number, hour: number, minute: number, period: string, zone: string): string | null {
  const timeZone = zone === "PT" ? "America/Los_Angeles" : zone === "MT" ? "America/Denver" : zone === "CT" ? "America/Chicago" : "America/New_York";
  const hour24 = (hour % 12) + (period.toLowerCase() === "pm" ? 12 : 0);
  let instant = Date.UTC(year, month - 1, day, hour24, minute);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    instant += Date.UTC(year, month - 1, day, hour24, minute) - displayed;
  }
  const value = new Date(instant);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function kickoffTimesFromSearch(results: Array<{ title: string; snippet: string | null }>): Map<string, string> {
  const output = new Map<string, string>();
  const months: Record<string, number> = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  const source = results.map((result) => `${result.title}\n${result.snippet ?? ""}`).join("\n");
  const pattern = /([A-Z][A-Za-z .'-]+?)\s+(?:at|vs\.?)\s+([A-Z][A-Za-z .'-]+?)\s*[|—-]\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})(am|pm)\s+(ET|CT|MT|PT)/g;
  for (const match of source.matchAll(pattern)) {
    const [, awayName = "", homeName = "", monthName = "", dayText = "", yearText = "", hourText = "", minuteText = "", period = "", zone = ""] = match;
    const month = months[monthName];
    if (!month) continue;
    const startsAt = localKickoffIso(Number(yearText), month, Number(dayText), Number(hourText), Number(minuteText), period, zone);
    if (!startsAt) continue;
    for (const teamName of [awayName, homeName]) {
      for (const team of sportsTeamCodes(teamName)) output.set(team, startsAt);
    }
  }
  return output;
}

function normalizeGamePhase(status: string | undefined): "pregame" | "live" | "final" | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (["complete", "final", "post_game"].includes(normalized)) return "final";
  if (["pre_game", "pregame", "scheduled"].includes(normalized)) return "pregame";
  return "live";
}

function sumActualsAndRemainingProjections(players: RosterPlayer[]): number | null {
  const values = players.flatMap((player) => {
    const value = player.gamePhase === "final" ? player.actual : player.projection;
    return value === null ? [] : [value];
  });
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0);
}

function settingValue(settings: Record<string, number> | undefined, key: string): number {
  const value = settings?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function adaptVegasStatsForScorer(
  position: Ranking["position"],
  stats: Record<string, number>,
  tdProbability: number | Record<string, number> | null,
): Record<string, number> {
  const sourcesBySleeperKey: Record<string, readonly string[]> = {
    pass_yd: ["pass_yd", "pass_yards"],
    pass_td: ["pass_td", "pass_tds", "passing_tds", "passing_touchdowns"],
    pass_int: ["pass_int", "pass_interceptions", "interceptions"],
    pass_cmp: ["pass_cmp", "pass_completions", "completions"],
    pass_att: ["pass_att", "pass_attempts"],
    pass_inc: ["pass_inc", "pass_incompletions", "incompletions"],
    pass_sack: ["pass_sack", "pass_sacks", "sacks_taken"],
    pass_fd: ["pass_fd", "pass_first_downs"],
    pass_2pt: ["pass_2pt", "pass_two_point_conversions"],
    rush_yd: ["rush_yd", "rush_yards", "rushing_yards"],
    rush_td: ["rush_td", "rush_tds", "rushing_tds", "rushing_touchdowns"],
    rush_att: ["rush_att", "rush_attempts", "carries"],
    rush_fd: ["rush_fd", "rush_first_downs"],
    rush_2pt: ["rush_2pt", "rush_two_point_conversions"],
    rec: ["rec", "receptions"],
    rec_yd: ["rec_yd", "rec_yards", "receiving_yards"],
    rec_td: ["rec_td", "rec_tds", "receiving_tds", "receiving_touchdowns"],
    rec_fd: ["rec_fd", "rec_first_downs", "receiving_first_downs"],
    rec_2pt: ["rec_2pt", "rec_two_point_conversions", "receiving_two_point_conversions"],
    fum: ["fum", "fumbles"],
    fum_lost: ["fum_lost", "fumbles_lost"],
    pr_yd: ["pr_yd", "punt_return_yards"],
    kr_yd: ["kr_yd", "kick_return_yards"],
    pr_td: ["pr_td", "punt_return_tds"],
    kr_td: ["kr_td", "kick_return_tds"],
    fgm: ["fgm", "field_goals_made"],
    fgmiss: ["fgmiss", "field_goals_missed"],
    fgm_0_19: ["fgm_0_19"],
    fgm_20_29: ["fgm_20_29"],
    fgm_30_39: ["fgm_30_39"],
    fgm_40_49: ["fgm_40_49"],
    fgm_50_59: ["fgm_50_59"],
    fgm_60p: ["fgm_60p"],
    fgm_50p: ["fgm_50p"],
    xpm: ["xpm", "extra_points_made"],
    xpmiss: ["xpmiss", "extra_points_missed"],
  };
  const normalized: Record<string, number> = {};
  for (const [sleeperKey, sourceKeys] of Object.entries(sourcesBySleeperKey)) {
    const value = sourceKeys
      .map((sourceKey) => stats[sourceKey])
      .find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
    if (typeof value === "number") normalized[sleeperKey] = value;
  }

  const hasExplicitSkillTouchdown = typeof normalized.rush_td === "number" || typeof normalized.rec_td === "number";
  if (!hasExplicitSkillTouchdown) {
    const fallbackTouchdownProbability = typeof tdProbability === "number"
      ? tdProbability
      : tdProbability
        ? (tdProbability.anytime_td ?? tdProbability.anytime ?? tdProbability.touchdown ?? tdProbability.td ?? null)
        : null;
    if (typeof fallbackTouchdownProbability === "number" && Number.isFinite(fallbackTouchdownProbability)) {
      if (position === "WR" || position === "TE") normalized.rec_td = fallbackTouchdownProbability;
      else if (position === "QB" || position === "RB") normalized.rush_td = fallbackTouchdownProbability;
    }
  }
  return normalized;
}

function scoreProjectedPlayerStats(
  position: Ranking["position"],
  stats: Record<string, number>,
  settings: Record<string, number> | undefined,
  opts?: { recFdProxy?: boolean },
): number {
  const directKeys = [
    "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
    "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td",
  ];
  let total = directKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0);
  if (position === "TE") total += (stats.rec ?? 0) * settingValue(settings, "bonus_rec_te");

  const bonuses: Array<[string, string, number]> = [
    ["bonus_pass_yd_300", "pass_yd", 300], ["bonus_pass_yd_400", "pass_yd", 400],
    ["bonus_pass_td_5", "pass_td", 5], ["bonus_pass_cmp_25", "pass_cmp", 25],
    ["bonus_rush_yd_100", "rush_yd", 100], ["bonus_rush_yd_200", "rush_yd", 200], ["bonus_rush_att_20", "rush_att", 20],
    ["bonus_rec_yd_100", "rec_yd", 100], ["bonus_rec_yd_200", "rec_yd", 200], ["bonus_rec_10", "rec", 10],
  ];
  for (const [settingKey, statKey, threshold] of bonuses) {
    if ((stats[statKey] ?? 0) >= threshold) total += settingValue(settings, settingKey);
  }

  if (opts?.recFdProxy) {
    // PPR proxy for point-per-first-down leagues (approved by Richard 2026-09-23):
    // prop markets don't price first downs, so each projected reception proxies
    // one receiving first down and earns rec_fd on top of rec. rush_fd stays
    // omitted: no rushing-attempts market exists. Only the Vegas weekly path
    // passes this flag — Sleeper projections and historical actuals carry real
    // first-down stats and must not double-count.
    const recFd = settingValue(settings, "rec_fd");
    if (recFd) total += (stats.rec ?? 0) * recFd;
  }

  if (position === "K") {
    const distanceKeys = ["fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p"];
    const missKeys = ["fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_60p"];
    const hasDistanceScoring = distanceKeys.some((key) => settingValue(settings, key) !== 0);
    const hasDistanceMissScoring = missKeys.some((key) => settingValue(settings, key) !== 0);
    total += hasDistanceScoring
      ? distanceKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgm ?? 0) * settingValue(settings, "fgm");
    total += hasDistanceMissScoring
      ? missKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgmiss ?? 0) * settingValue(settings, "fgmiss");
    total += (stats.fgm_50p ?? 0) * settingValue(settings, "fgm_50p");
    total += (stats.xpm ?? 0) * settingValue(settings, "xpm");
    total += (stats.xpmiss ?? 0) * settingValue(settings, "xpmiss");
    const estimatedMadeYards = (stats.fgm_0_19 ?? 0) * 19 + (stats.fgm_20_29 ?? 0) * 25 + (stats.fgm_30_39 ?? 0) * 35
      + (stats.fgm_40_49 ?? 0) * 45 + (stats.fgm_50_59 ?? 0) * 55 + (stats.fgm_60p ?? 0) * 62;
    total += estimatedMadeYards * settingValue(settings, "fgm_yds");
  }
  return Number(total.toFixed(2));
}

function scoreSleeperPlayerProjection(position: Ranking["position"], stats: Record<string, number> | undefined, settings: Record<string, number> | undefined): number | null {
  if (!stats) return null;
  const projectionKeys = [
    "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
    "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt", "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td", "fgm", "fgmiss", "fgm_0_19", "fgm_20_29",
    "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p", "fgm_50p", "xpm", "xpmiss",
  ];
  if (!projectionKeys.some((key) => typeof stats[key] === "number")) return null;
  return scoreProjectedPlayerStats(position, stats, settings);
}

const BOOM_BUST_SEASONS = [2024, 2025, 2026] as const;
const SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS = 30 * 60 * 1000;
const SLEEPER_WEEKLY_STATS_ARCHIVE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

type SleeperWeeklyStatRow = Record<string, unknown>;

async function loadSleeperPlayerWeeklySeason(ctx: Ctx, playerId: string, season: number): Promise<SleeperWeeklyStatRow[]> {
  const db = ctx.db<typeof schema>();
  const cacheKey = `sleeper-player-weekly-stats-v1:${playerId}:${season}`;
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  const maxAge = season === 2026 ? SLEEPER_WEEKLY_STATS_CURRENT_CACHE_MS : SLEEPER_WEEKLY_STATS_ARCHIVE_CACHE_MS;
  if (cached && Date.now() - cached.fetchedAt.getTime() < maxAge) {
    const parsed: unknown = JSON.parse(cached.payload);
    return normalizeSleeperWeeklyRows(parsed);
  }
  try {
    const payload = await fetchJson<unknown>(`${SLEEPER_PROJECTIONS_BASE}/stats/nfl/player/${encodeURIComponent(playerId)}?season_type=regular&season=${season}&grouping=week`);
    const rows = normalizeSleeperWeeklyRows(payload);
    await db.insert(schema.sourceCache).values({ cacheKey, payload: JSON.stringify(payload), fetchedAt: new Date() })
      .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(payload), fetchedAt: new Date() } });
    return rows;
  } catch (error) {
    if (cached) {
      const parsed: unknown = JSON.parse(cached.payload);
      return normalizeSleeperWeeklyRows(parsed);
    }
    throw error;
  }
}

function flattenSleeperWeeklyRow(row: SleeperWeeklyStatRow, week?: number): SleeperWeeklyStatRow {
  const nestedStats = typeof row.stats === "object" && row.stats !== null && !Array.isArray(row.stats)
    ? row.stats as SleeperWeeklyStatRow
    : {};
  return { ...row, ...nestedStats, week: row.week ?? week };
}

function normalizeSleeperWeeklyRows(payload: unknown): SleeperWeeklyStatRow[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
      return [flattenSleeperWeeklyRow(value as SleeperWeeklyStatRow)];
    });
  }
  if (typeof payload !== "object" || payload === null) return [];
  return Object.entries(payload).flatMap(([weekKey, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return [flattenSleeperWeeklyRow(value as SleeperWeeklyStatRow, Number(weekKey))];
  });
}

function sleeperActualStats(row: SleeperWeeklyStatRow): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
  }
  return stats;
}

function sleeperGameLogStats(position: "QB" | "RB" | "WR" | "TE", row: SleeperWeeklyStatRow): Record<string, number> {
  const fields: Record<"QB" | "RB" | "WR" | "TE", Array<[string, string[]]>> = {
    QB: [
      ["passCmp", ["pass_cmp"]], ["passAtt", ["pass_att"]], ["passYds", ["pass_yd"]],
      ["passTd", ["pass_td"]], ["interceptions", ["pass_int"]], ["rushAtt", ["rush_att"]],
      ["rushYds", ["rush_yd"]], ["rushTd", ["rush_td"]],
    ],
    RB: [
      ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]], ["rushTd", ["rush_td"]],
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]],
    ],
    WR: [
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]], ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]],
      ["rushTd", ["rush_td"]],
    ],
    TE: [
      ["targets", ["rec_tgt", "targets"]], ["receptions", ["rec"]], ["recYds", ["rec_yd"]],
      ["recTd", ["rec_td"]], ["rushAtt", ["rush_att"]], ["rushYds", ["rush_yd"]],
      ["rushTd", ["rush_td"]],
    ],
  };
  const stats: Record<string, number> = {};
  for (const [outputKey, sourceKeys] of fields[position]) {
    const value = sourceKeys.map((key) => row[key]).find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
    if (typeof value === "number") stats[outputKey] = value;
  }
  return stats;
}

function hasSleeperGameParticipation(row: SleeperWeeklyStatRow): boolean {
  if (typeof row.game_id !== "string" || row.game_id.length === 0) return false;
  const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
  if (status === "inactive" || status === "out" || status === "dnp") return false;
  const participationFields = [
    "pass_att", "rush_att", "targets", "rec", "off_snp", "snp", "snap_count", "snap_pct",
    "pass_yd", "rush_yd", "rec_yd", "pass_td", "rush_td", "rec_td", "fum", "fum_lost",
    "pr_yd", "kr_yd", "pr_td", "kr_td", "two_pt_conv", "pass_2pt", "rush_2pt", "rec_2pt",
  ];
  return participationFields.some((key) => typeof row[key] === "number" && Number(row[key]) > 0);
}

function buildBoomBustSeries(
  games: Array<{ season: number; week: number; points: number }>,
  status: "ok" | "unavailable",
): z.infer<typeof boomBustSeriesSchema> {
  const weeklyScores = games.slice().sort((a, b) => a.season - b.season || a.week - b.week);
  const values = weeklyScores.map((score) => score.points);
  return {
    status,
    weeklyScores,
    floor: values.length >= 5 ? percentile(values, 0.1) : values.length ? Math.min(...values) : null,
    firstQuartile: values.length >= 8 ? percentile(values, 0.25) : null,
    median: median(values),
    mean: mean(values),
    thirdQuartile: values.length >= 8 ? percentile(values, 0.75) : null,
    ceiling: values.length ? Math.max(...values) : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) return null;
  if (ordered.length % 2 === 1) return upper;
  const lower = ordered[middle - 1];
  return lower === undefined ? upper : Number(((lower + upper) / 2).toFixed(2));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const rank = (ordered.length - 1) * quantile;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = ordered[lowerIndex];
  const upper = ordered[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  return Number((lower + (upper - lower) * (rank - lowerIndex)).toFixed(2));
}

type TradeValuation = z.infer<typeof tradeValuationSchema>;

function deriveTradeValuation(
  league: SleeperLeague,
  projectionAsOf: string | null,
): TradeValuation {
  const settings = league.scoring_settings ?? {};
  const warnings: string[] = [];
  const rosterPositions = league.roster_positions ?? [];
  const addWarning = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  const reception = settingValue(settings, "rec");
  if (![0, 0.5, 1].includes(reception)) addWarning(`${reception}-point receptions are not a FantasyCalc market preset.`);
  if (settingValue(settings, "pass_td") !== 4) addWarning(`${settingValue(settings, "pass_td")}-point passing TDs are not reflected in the FantasyCalc market price.`);
  const tePremium = settingValue(settings, "bonus_rec_te");
  if (tePremium !== 0) addWarning(`TE premium (+${tePremium} per catch) is not reflected in the FantasyCalc market price.`);
  const firstDownKeys = ["pass_fd", "rush_fd", "rec_fd"];
  if (firstDownKeys.some((key) => settingValue(settings, key) !== 0)) addWarning("Points per first down are not supported by FantasyCalc's closest format.");
  const bonusKeys = Object.keys(settings).filter((key) => key.startsWith("bonus_") && key !== "bonus_rec_te" && settingValue(settings, key) !== 0);
  if (bonusKeys.length > 0) addWarning("Custom yardage or milestone bonuses are not reflected in the FantasyCalc market price.");
  if (rosterPositions.includes("K") || rosterPositions.includes("DEF")) addWarning("Kicker and defense assets are not priced by FantasyCalc.");

  return { unsupportedSettings: warnings, projectionAsOf, optimizerVersion: "lineup-dp-v1" };
}

function tierScore(value: number, settings: Record<string, number> | undefined, tiers: Array<[number, string]>): number {
  const tier = tiers.find(([upperBound]) => value <= upperBound) ?? tiers[tiers.length - 1];
  return tier ? settingValue(settings, tier[1]) : 0;
}

function scoreProjectedDefenseStats(stats: Record<string, number>, settings: Record<string, number> | undefined): number | null {
  const directKeys = ["sack", "int", "fum_rec", "def_td", "safe", "blk_kick", "def_2pt", "st_td", "st_fum_rec", "pr_yd", "kr_yd", "pr_td", "kr_td"];
  let matched = false;
  let total = 0;
  for (const key of directKeys) {
    if (typeof stats[key] !== "number") continue;
    matched = true;
    total += (stats[key] ?? 0) * settingValue(settings, key);
  }
  const pointsAllowed = stats.pts_allow;
  if (typeof pointsAllowed === "number") {
    matched = true;
    total += tierScore(pointsAllowed, settings, [
      [0, "pts_allow_0"], [6, "pts_allow_1_6"], [13, "pts_allow_7_13"], [20, "pts_allow_14_20"],
      [27, "pts_allow_21_27"], [34, "pts_allow_28_34"], [Infinity, "pts_allow_35p"],
    ]) + pointsAllowed * settingValue(settings, "pts_allow");
  }
  const yardsAllowed = stats.yds_allow;
  if (typeof yardsAllowed === "number") {
    matched = true;
    total += tierScore(yardsAllowed, settings, [
      [100, "yds_allow_0_100"], [199, "yds_allow_100_199"], [299, "yds_allow_200_299"], [349, "yds_allow_300_349"],
      [399, "yds_allow_350_399"], [449, "yds_allow_400_449"], [499, "yds_allow_450_499"], [Infinity, "yds_allow_500p"],
    ]) + yardsAllowed * settingValue(settings, "yds_allow");
  }
  return matched ? Number(total.toFixed(2)) : null;
}

function buildDefenses(
  leagueId: string,
  scoringSettings: Record<string, number> | undefined,
  schedule: SleeperGame[],
  week: number,
  vegasTeamTotals: Map<string, number>,
  gamePhaseByTeam: Map<string, "pregame" | "live" | "final">,
  gameTimeByTeam: Map<string, string>,
  sleeperProjections: Map<string, SleeperProjection>,
): z.infer<typeof defenseSchema>[] {
  const opponents = new Map<string, string>();
  const awayTeams = new Set<string>();
  for (const game of schedule) {
    if (game.week !== week || !game.home || !game.away) continue;
    const home = canonicalTeam(game.home);
    const away = canonicalTeam(game.away);
    opponents.set(home, away);
    opponents.set(away, home);
    awayTeams.add(away);
  }
  const base = [...opponents.entries()].map(([team, opponent]) => {
    const opponentProjectedPoints = vegasTeamTotals.get(opponent) ?? null;
    const gamePhase = gamePhaseByTeam.get(team) ?? null;
    const sleeperStats = sleeperProjections.get(team)?.stats;
    const leagueProjection = sleeperStats ? scoreProjectedDefenseStats(sleeperStats, scoringSettings) : null;
    const fallbackProjection = sleeperStats?.pts_ppr ?? sleeperStats?.pts_half_ppr ?? sleeperStats?.pts_std ?? null;
    const pregameProjection = leagueProjection ?? fallbackProjection;
    return {
      leagueId,
      team,
      opponent,
      isAway: awayTeams.has(team),
      opponentProjectedPoints,
      projectedPointsSource: opponentProjectedPoints === null ? "unavailable" as const : "vegas" as const,
      pregameProjection,
      displayProjection: gamePhase === "final" ? null : pregameProjection,
      projectionSource: gamePhase === "final" || pregameProjection === null ? null : "sleeper" as const,
      actualScore: null,
      gamePhase,
      gameTime: gameTimeByTeam.get(team) ?? null,
      components: sleeperStats ?? null,
      rank: null as number | null,
    };
  });
  const ranked = base.filter((row) => row.pregameProjection !== null)
    .sort((a, b) => (b.pregameProjection ?? -Infinity) - (a.pregameProjection ?? -Infinity) || a.team.localeCompare(b.team));
  ranked.forEach((row, index) => { row.rank = index + 1; });
  return base.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.team.localeCompare(b.team));
}

function matchupCodeVariants(away: string, home: string): string[] {
  const aliases = (team: string): string[] => {
    const canonical = canonicalTeam(team);
    if (canonical === "JAX") return ["JAX", "JAC"];
    if (canonical === "WSH") return ["WSH", "WAS"];
    if (canonical === "LV") return ["LV", "LVR"];
    return [canonical];
  };
  return aliases(away).flatMap((awayCode) => aliases(home).flatMap((homeCode) => [`${awayCode}${homeCode}`, `${homeCode}${awayCode}`]));
}

function selectConsensusLine(lines: z.infer<typeof vegasLineSchema>[]): z.infer<typeof vegasLineSchema> | null {
  if (lines.length === 0) return null;
  return [...lines].sort((a, b) => {
    const aDistance = a.probability === null ? 100 : Math.abs(a.probability - 50);
    const bDistance = b.probability === null ? 100 : Math.abs(b.probability - 50);
    return aDistance - bDistance || a.source.localeCompare(b.source);
  })[0] ?? null;
}

function buildVegasTeamTotals(lines: z.infer<typeof vegasLineSchema>[], schedule: SleeperGame[], week: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const game of schedule) {
    if (game.week !== week || !game.away || !game.home) continue;
    const away = canonicalTeam(game.away);
    const home = canonicalTeam(game.home);
    const codes = new Set(matchupCodeVariants(away, home));
    const gameLines = lines.filter((line) => codes.has(line.matchupCode));
    const totalLine = selectConsensusLine(gameLines.filter((line) => line.marketType === "total"));
    if (!totalLine) continue;
    const spreadLine = selectConsensusLine(gameLines.filter((line) => line.marketType === "spread" && line.team));
    const favoredTeam = spreadLine?.team ? canonicalTeam(spreadLine.team) : null;
    const margin = spreadLine && favoredTeam && (favoredTeam === away || favoredTeam === home) ? spreadLine.line : 0;
    const awayTotal = favoredTeam === away ? (totalLine.line + margin) / 2 : favoredTeam === home ? (totalLine.line - margin) / 2 : totalLine.line / 2;
    totals.set(away, Number(awayTotal.toFixed(2)));
    totals.set(home, Number((totalLine.line - awayTotal).toFixed(2)));
  }
  return totals;
}

async function loadVegasProjectionSnapshot(ctx: Ctx, season: number, week: number): Promise<VegasProjectionPayload | null> {
  const rows = await ctx.db<typeof schema>()
    .select()
    .from(schema.vegasProjectionSnapshots)
    .where(and(eq(schema.vegasProjectionSnapshots.season, season), eq(schema.vegasProjectionSnapshots.week, week)))
    .orderBy(desc(schema.vegasProjectionSnapshots.builtAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return vegasProjectionPayloadSchema.parse(JSON.parse(row.payload));
  } catch {
    return null;
  }
}

const STRENGTH_OF_SCHEDULE_CACHE_PREFIX = "strength-of-schedule-v1";

async function loadStrengthOfSchedule(
  ctx: Ctx,
  leagueIds: string[],
): Promise<z.infer<typeof strengthOfScheduleEntrySchema>[]> {
  if (leagueIds.length === 0) return [];
  const db = ctx.db<typeof schema>();
  const keys = leagueIds.map((leagueId) => `${STRENGTH_OF_SCHEDULE_CACHE_PREFIX}:${leagueId}`);
  const rows = await db.select().from(schema.sourceCache)
    .where(inArray(schema.sourceCache.cacheKey, keys));
  const entries: z.infer<typeof strengthOfScheduleEntrySchema>[] = [];
  for (const row of rows) {
    try {
      entries.push(strengthOfScheduleEntrySchema.parse(JSON.parse(row.payload)));
    } catch { /* skip malformed rows */ }
  }
  return entries;
}

// Canonical full-PPR scoring for the league-independent Vegas baseline shown in
// the player comparison tool. Deliberately excludes league quirks (yardage/TD
// bonuses, TE premium, the PPFD rec_fd proxy) so "Vegas projection" is a neutral
// number comparable across leagues and distinct from the league-scored projection.
const VEGAS_CANONICAL_PPR_SCORING: Record<string, number> = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

function mergeVegasPlayerProjections(
  leagueId: string,
  rankingField: "ppr" | "halfPpr",
  baseRows: Ranking[],
  snapshot: VegasProjectionPayload | null,
  useVegasPrimary: boolean,
  sleeperProjectionsByPlayerId: Map<string, SleeperProjection>,
  scoringSettings: Record<string, number> | undefined,
  defenseRankByTeam: Map<string, number>,
): Ranking[] {
  const feedByPlayer = new Map<string, VegasProjectionPayload["projections"][number]>();
  const feedByNamePosition = new Map<string, VegasProjectionPayload["projections"][number]>();
  for (const projection of snapshot?.projections ?? []) {
    const position = normalizePosition(projection.position);
    const exactKey = `${normalizedPlayerName(projection.player)}:${canonicalTeam(projection.team)}:${position}`;
    feedByPlayer.set(exactKey, projection);
    const namePositionKey = `${normalizedPlayerName(projection.player)}:${position}`;
    if (!feedByNamePosition.has(namePositionKey)) feedByNamePosition.set(namePositionKey, projection);
  }

  const merged = baseRows.flatMap((base): Ranking[] => {
    // Weekly availability overrides every numeric source. Consensus and Sleeper
    // feeds can lag official out/IR designations and otherwise leave a ruled-out
    // player with a non-zero projection.
    if (isUnavailableForCurrentWeek(base.injuryStatus)) {
      return [{
        ...base,
        leagueId,
        ppr: 0,
        halfPpr: 0,
        standard: 0,
        leagueProjection: 0,
        vegasProjection: null,
        sleeperProjection: null,
        projectionSource: "fallback",
        projectionComponents: null,
      }];
    }
    const sleeperStats = sleeperProjectionsByPlayerId.get(base.playerId)?.stats;
    const sleeperPoints = scoreSleeperPlayerProjection(base.position, sleeperStats, scoringSettings)
      ?? (rankingField === "ppr" ? sleeperStats?.pts_ppr : sleeperStats?.pts_half_ppr)
      ?? sleeperStats?.pts_ppr
      ?? sleeperStats?.pts_half_ppr
      ?? sleeperStats?.pts_std
      ?? null;
    const validSleeperPoints = typeof sleeperPoints === "number" && Number.isFinite(sleeperPoints) ? sleeperPoints : null;
    if (base.position === "K") {
      if (validSleeperPoints !== null) {
        return [{
          ...base,
          leagueId,
          ppr: rankingField === "ppr" ? validSleeperPoints : base.ppr,
          halfPpr: rankingField === "halfPpr" ? validSleeperPoints : base.halfPpr,
          leagueProjection: validSleeperPoints,
          vegasProjection: null,
          sleeperProjection: validSleeperPoints,
          projectionSource: "sleeper",
          projectionComponents: sleeperStats ?? null,
        }];
      }
      return [{
        ...base,
        leagueId,
        leagueProjection: null,
        vegasProjection: null,
        sleeperProjection: null,
        projectionSource: "fallback",
        projectionComponents: null,
      }];
    }

    const exactKey = `${normalizedPlayerName(base.name)}:${canonicalTeam(base.team)}:${base.position}`;
    const feed = feedByPlayer.get(exactKey) ?? feedByNamePosition.get(`${normalizedPlayerName(base.name)}:${base.position}`);
    const feedTeam = feed?.team ? canonicalTeam(feed.team) : null;
    const baseTeam = canonicalTeam(base.team ?? "");
    const teamCompatible = feedTeam !== null && feedTeam === baseTeam;
    // The consensus feed supplies projected football stats. Score those stats
    // here through this league's exact Sleeper scoring rules so weekly roster
    // utility never falls back to FantasyCalc market value or a generic PPR total.
    let leaguePoints: number | null = null;
    let vegasPoints: number | null = null;
    let projectionComponents: Record<string, number> | null = null;
    if (useVegasPrimary && feed) {
      const scorerStats = adaptVegasStatsForScorer(base.position, feed.expected_stats, feed.td_probability);
      leaguePoints = scoreProjectedPlayerStats(base.position, scorerStats, scoringSettings, { recFdProxy: true });
      // League-independent Vegas baseline: same stats through canonical PPR so
      // the comparison tool's "Vegas projection" never duplicates the
      // league-scored number.
      const canonicalPoints = scoreProjectedPlayerStats(base.position, scorerStats, VEGAS_CANONICAL_PPR_SCORING);
      vegasPoints = Number.isFinite(canonicalPoints) ? canonicalPoints : null;
      projectionComponents = scorerStats;
    }
    if (typeof leaguePoints === "number" && Number.isFinite(leaguePoints)) {
      return [{
        ...base,
        leagueId,
        team: teamCompatible ? feedTeam : base.team,
        opponent: teamCompatible && feed?.opponent ? canonicalTeam(feed.opponent) : base.opponent,
        ppr: rankingField === "ppr" ? leaguePoints : base.ppr,
        halfPpr: rankingField === "halfPpr" ? leaguePoints : base.halfPpr,
        leagueProjection: leaguePoints,
        vegasProjection: vegasPoints,
        sleeperProjection: validSleeperPoints,
        projectionSource: "vegas",
        projectionComponents,
      }];
    }

    // Keep the player visible with schedule context when the saved Vegas feed
    // does not contain a projection. Never revive a prior-week row.
    return [{
      ...base,
      leagueId,
      leagueProjection: null,
      vegasProjection: null,
      sleeperProjection: validSleeperPoints,
      projectionSource: "fallback",
      projectionComponents: null,
    }];
  });

  for (const position of ["QB", "RB", "WR", "TE", "K"] as const) {
    const group = merged
      .filter((row) => row.position === position)
      .sort((a, b) => {
        if (position === "K") {
          const aOpponentDefenseRank = a.opponent ? defenseRankByTeam.get(canonicalTeam(a.opponent)) : undefined;
          const bOpponentDefenseRank = b.opponent ? defenseRankByTeam.get(canonicalTeam(b.opponent)) : undefined;
          if (aOpponentDefenseRank !== bOpponentDefenseRank) {
            return (bOpponentDefenseRank ?? -1) - (aOpponentDefenseRank ?? -1);
          }
        }
        return (b.leagueProjection ?? -1) - (a.leagueProjection ?? -1) || a.name.localeCompare(b.name);
      });
    group.forEach((row, index) => {
      row.leagueRank = index + 1;
      if (rankingField === "ppr") row.pprRank = index + 1;
      else row.halfPprRank = index + 1;
    });
  }
  return merged;
}

async function buildDashboard(ctx: Ctx, forceMarketRefresh = false): Promise<Dashboard> {
  const sourceErrors: string[] = [];
  const state = await fetchJson<{ season: string; week: number }>(`${SLEEPER_BASE}/state/nfl`);
  const season = Number(state.season);
  const week = state.week;
  const vegasProjectionSnapshot = await loadVegasProjectionSnapshot(ctx, season, week);

  const [leagueResult, playersResult, sleeperProjectionResult, scheduleResult, currentStatsResult, previousStatsResult, kickoffResult, kickoffSearchResult] = await Promise.allSettled([
    fetchJson<SleeperLeague[]>(`${SLEEPER_BASE}/user/${SLEEPER_USER_ID}/leagues/nfl/${season}`),
    fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`),
    fetchJson<SleeperProjection[]>(`${SLEEPER_PROJECTIONS_BASE}/projections/nfl/${season}/${week}?season_type=regular&order_by=pts_ppr`),
    fetchJson<SleeperGame[]>(`${SLEEPER_BASE.replace("/v1", "")}/schedule/nfl/regular/${season}`),
    fetchText(NFLVERSE_PLAYER_STATS_2026_URL),
    fetchText(NFLVERSE_PLAYER_STATS_2025_URL),
    fetchJson<EspnScoreboard>(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`),
    ctx.viewer && !ctx.viewer.isOwner
      ? Promise.reject(new Error("Owner-only schedule enrichment skipped for this viewer."))
      : ctx.tool.web_search(`FantasyPros NFL Week ${week} ${season} schedule kickoff times`, { timeout_secs: SOURCE_TIMEOUT_MS / 1000 }),
  ]);

  if (leagueResult.status === "rejected") throw new Error("Sleeper leagues are unavailable");
  if (playersResult.status === "rejected") throw new Error("Sleeper player data is unavailable");

  const vegasTeamTotals = new Map<string, number>();

  const sleeperProjectionsByPlayerId = new Map<string, SleeperProjection>();
  const sleeperDefenseProjections = new Map<string, SleeperProjection>();
  if (sleeperProjectionResult.status === "fulfilled") {
    for (const row of sleeperProjectionResult.value) {
      if (row.player_id) sleeperProjectionsByPlayerId.set(row.player_id, row);
      const defenseTeam = row.team ?? row.player_id;
      if (row.player?.position === "DEF" && defenseTeam && row.stats) {
        sleeperDefenseProjections.set(canonicalTeam(defenseTeam), row);
      }
    }
  } else sourceErrors.push("Sleeper projections are unavailable; kicker and DST rankings cannot update, and in-progress players may show their pregame projection.");

  // FantasyCalc and the per-league Sleeper requests are independent once the
  // shared player dictionary is available. Start this now so a slow source
  // does not create another serial network phase in the refresh action.
  const fantasyCalcPromise = fetchFantasyCalcRankings(playersResult.value);
  const draftMarketPromise = loadDraftMarketSnapshot(ctx, forceMarketRefresh, leagueResult.value, playersResult.value);

  const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
  const gamePhaseByTeam = new Map<string, "pregame" | "live" | "final">();
  const gameTimeByTeam = new Map<string, string>();
  const teamRecords = kickoffResult.status === "fulfilled" ? nflTeamRecordsFromScoreboard(kickoffResult.value) : [];
  if (kickoffResult.status === "fulfilled") {
    for (const event of kickoffResult.value.events ?? []) {
      if (!event.date || Number.isNaN(new Date(event.date).getTime())) continue;
      const competitors = event.competitions?.flatMap((competition) => competition.competitors ?? []) ?? [];
      for (const competitor of competitors) {
        const abbreviation = competitor.team?.abbreviation;
        if (abbreviation) gameTimeByTeam.set(canonicalTeam(abbreviation), event.date);
      }
    }
  }
  if (gameTimeByTeam.size === 0 && kickoffSearchResult.status === "fulfilled") {
    for (const [team, startsAt] of kickoffTimesFromSearch(kickoffSearchResult.value.content.results)) {
      gameTimeByTeam.set(team, startsAt);
    }
  }
  if (gameTimeByTeam.size === 0) sourceErrors.push("NFL kickoff times are temporarily unavailable.");
  if (scheduleResult.status === "fulfilled") {
    for (const game of schedule) {
      if (game.week !== week) continue;
      const phase = normalizeGamePhase(game.status);
      if (phase) {
        if (game.home) gamePhaseByTeam.set(canonicalTeam(game.home), phase);
        if (game.away) gamePhaseByTeam.set(canonicalTeam(game.away), phase);
      }
      if (game.date) {
        if (game.home && !gameTimeByTeam.has(canonicalTeam(game.home))) gameTimeByTeam.set(canonicalTeam(game.home), game.date);
        if (game.away && !gameTimeByTeam.has(canonicalTeam(game.away))) gameTimeByTeam.set(canonicalTeam(game.away), game.date);
      }
    }
  } else sourceErrors.push("NFL game status is unavailable; player rows are showing projections.");

  const vegasProjectionCount = vegasProjectionSnapshot?.projections.length ?? 0;
  const useVegasPrimary = vegasProjectionCount >= MIN_VEGAS_PLAYER_COVERAGE;
  let defenses: z.infer<typeof defenseSchema>[] = [];
  let analytics: z.infer<typeof analyticsSchema> = {
    asOf: null,
    throughWeek: null,
    sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL,
    entities: [],
    teamUsage: [],
    teamRecords,
  };
  if (season !== 2026) {
    sourceErrors.push("Advanced stats are awaiting the nflverse file for the current season.");
  } else if (currentStatsResult.status === "fulfilled" && previousStatsResult.status === "fulfilled") {
    try {
      const built = buildAnalytics(previousStatsResult.value, currentStatsResult.value, season);
      analytics = { asOf: new Date().toISOString(), throughWeek: built.throughWeek, sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL, entities: built.entities, teamUsage: built.teamUsage, teamRecords };
      if (built.entities.length === 0) sourceErrors.push("nflverse advanced stats did not include any current-season games.");
    } catch {
      sourceErrors.push("nflverse advanced stats could not be read.");
    }
  } else {
    sourceErrors.push("nflverse advanced stats are temporarily unavailable.");
  }
  let vegasLines: z.infer<typeof vegasLineSchema>[] = [];
  try {
    vegasLines = (await draftMarketPromise).vegasLines;
  } catch {
    sourceErrors.push("Prediction-market game lines are temporarily unavailable.");
  }
  for (const [team, total] of buildVegasTeamTotals(vegasLines, schedule, week)) vegasTeamTotals.set(team, total);
  const opponentByTeam = new Map<string, string>();
  const isAwayByTeam = new Map<string, boolean>();
  for (const game of schedule) {
    if (game.week !== week || !game.home || !game.away) continue;
    const home = canonicalTeam(game.home);
    const away = canonicalTeam(game.away);
    opponentByTeam.set(home, away);
    opponentByTeam.set(away, home);
    isAwayByTeam.set(home, false);
    isAwayByTeam.set(away, true);
  }
  const scheduleWeekAvailable = opponentByTeam.size >= 24;
  const vegasBaseRows: Ranking[] = Object.entries(playersResult.value).flatMap(([playerId, player]) => {
    const position = normalizePosition(player.position);
    const team = player.team ? canonicalTeam(player.team) : "";
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name || !team || !["QB", "RB", "WR", "TE", "K"].includes(position)) return [];
    return [{
      leagueId: "",
      playerId,
      name,
      team,
      opponent: opponentByTeam.get(team) ?? null,
      isAway: isAwayByTeam.get(team) ?? null,
      isBye: scheduleWeekAvailable && !opponentByTeam.has(team),
      position: position as Ranking["position"],
      pprRank: 999,
      halfPprRank: 999,
      leagueRank: 999,
      ppr: null,
      halfPpr: null,
      standard: null,
      leagueProjection: null,
      vegasProjection: null,
      sleeperProjection: null,
      projectionSource: "fallback",
      projectionComponents: null,
      injuryStatus: weeklyAvailabilityStatus(player),
      gameTime: gameTimeByTeam.get(team) ?? null,
    }];
  });
  const rankingsByLeagueId = new Map<string, Ranking[]>();
  // Weekly charts use the same source rows as the rest of the artifact so the
  // retired opportunity-weight projection model cannot reappear in tools.
  const weeklyChartRankingsByLeagueId = new Map<string, Ranking[]>();
  const defensesByLeagueId = new Map<string, z.infer<typeof defenseSchema>[]>();
  for (const league of leagueResult.value) {
    const rankingField: "ppr" | "halfPpr" = isDynasticalPpfdLeague(league) || (league.scoring_settings?.rec ?? 0) >= 1 ? "ppr" : "halfPpr";
    const leagueDefenses = buildDefenses(
      league.league_id,
      league.scoring_settings,
      schedule,
      week,
      vegasTeamTotals,
      gamePhaseByTeam,
      gameTimeByTeam,
      sleeperDefenseProjections,
    );
    const defenseRankByTeam = new Map(leagueDefenses.flatMap((row) => row.rank === null ? [] : [[row.team, row.rank] as const]));
    const mergedRankings = mergeVegasPlayerProjections(
      league.league_id,
      rankingField,
      vegasBaseRows,
      vegasProjectionSnapshot,
      useVegasPrimary,
      sleeperProjectionsByPlayerId,
      league.scoring_settings,
      defenseRankByTeam,
    );
    weeklyChartRankingsByLeagueId.set(league.league_id, mergedRankings);
    rankingsByLeagueId.set(league.league_id, mergedRankings);
    defensesByLeagueId.set(league.league_id, leagueDefenses);
  }
  const rankings = [...rankingsByLeagueId.values()].flat();
  const weeklyChartRankings = [...weeklyChartRankingsByLeagueId.values()].flat();
  defenses = [...defensesByLeagueId.values()].flat();
  if (!useVegasPrimary) {
    sourceErrors.push(`Vegas player coverage is ${vegasProjectionCount}/${MIN_VEGAS_PLAYER_COVERAGE} required; weekly skill-position projections are unavailable in this snapshot.`);
  }
  const missingDefenseProjections = defenses.filter((row) => row.pregameProjection === null).length;
  if (missingDefenseProjections > 0) {
    sourceErrors.push(`${missingDefenseProjections} defense projection${missingDefenseProjections === 1 ? " is" : "s are"} unavailable from Sleeper.`);
  }
  const players = playersResult.value;
  const fantasyCalcResult = await fantasyCalcPromise;
  const seasonLongRankings = fantasyCalcResult.rows;
  if (fantasyCalcResult.failedPresets > 0) sourceErrors.push("FantasyCalc season-long rankings are unavailable for one or more league formats.");
  const fantasyCalcAsOf = seasonLongRankings.length > 0 ? new Date().toISOString() : null;
  const defenseActuals = new Map<string, number>();

  // Fetch the required roster before optional league enrichments and bound
  // concurrency. The previous 24-request fan-out could throttle every roster
  // request, yielding a schema-valid dashboard with zero usable leagues.
  const leagues = await mapWithConcurrency(leagueResult.value, 2, async (league) => {
    let rosters: SleeperRoster[];
    try {
      rosters = await fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`);
    } catch {
      sourceErrors.push(`${league.name}: roster unavailable.`);
      return null;
    }
    const [matchupsResult, usersResult, tradedPicksResult] = await Promise.allSettled([
      fetchJson<SleeperMatchup[]>(`${SLEEPER_BASE}/league/${league.league_id}/matchups/${week}`),
      fetchJson<SleeperUser[]>(`${SLEEPER_BASE}/league/${league.league_id}/users`),
      fetchJson<SleeperTradedPick[]>(`${SLEEPER_BASE}/league/${league.league_id}/traded_picks`),
    ]);
    const ownRoster = rosters.find((roster) => roster.owner_id === SLEEPER_USER_ID);
    if (!ownRoster) {
      sourceErrors.push(`${league.name}: your roster was not found.`);
      return null;
    }
    const matchups = matchupsResult.status === "fulfilled" ? matchupsResult.value : [];
    const matchup = matchups.find((item) => item.roster_id === ownRoster.roster_id);
    const opponentMatchup = matchup?.matchup_id == null
      ? undefined
      : matchups.find((item) => item.matchup_id === matchup.matchup_id && item.roster_id !== ownRoster.roster_id);
    const opponentRoster = opponentMatchup
      ? rosters.find((roster) => roster.roster_id === opponentMatchup.roster_id)
      : undefined;
    if (matchupsResult.status === "rejected") sourceErrors.push(`${league.name}: live scores unavailable.`);

    const isDynastical = isDynasticalPpfdLeague(league);
    const receptionPoints = league.scoring_settings?.rec ?? 0;
    const rankingField: "ppr" | "halfPpr" = isDynastical || receptionPoints >= 1 ? "ppr" : "halfPpr";
    const scoringLabel = isDynastical ? "PPR proxy · PPFD league" : rankingField === "ppr" ? "PPR" : "Half PPR";
    const rosterPositions = league.roster_positions ?? [];
    const starterSlots = rosterPositions.filter((slot) => !["BN", "IR", "TAXI"].includes(slot));
    const rankingPositions: Array<"QB" | "RB" | "WR" | "TE" | "K" | "DEF"> = ["QB", "RB", "WR", "TE"];
    if (rosterPositions.includes("K")) rankingPositions.push("K");
    if (rosterPositions.includes("DEF")) rankingPositions.push("DEF");
    const seasonLongFormat = seasonLongFormatForLeague(league);
    const tradeValuation = deriveTradeValuation(
      league,
      useVegasPrimary ? (vegasProjectionSnapshot?.built_at ?? null) : null,
    );
    if (seasonLongFormat.isDynasty) tradeValuation.unsupportedSettings.push("Future pick slots are unknown; owned picks use FantasyCalc's neutral mid-pick market row.");
    const normalizedLeagueName = league.name.toLowerCase();
    const showSuperFilter = normalizedLeagueName.includes("cucks") || normalizedLeagueName.includes("taint");
    const leagueRankings = rankingsByLeagueId.get(league.league_id) ?? [];
    const leagueDefenses = defensesByLeagueId.get(league.league_id) ?? [];
    const rankingById = new Map(leagueRankings.map((row) => [row.playerId, row]));
    const defenseByTeam = new Map(leagueDefenses.map((row) => [row.team, row]));

    const makePlayer = (playerId: string, isStarter: boolean, activeMatchup: SleeperMatchup | undefined, starterIndex?: number): RosterPlayer => {
      const meta = players[playerId];
      const position = normalizePosition(meta?.position ?? (playerId.length <= 3 ? "DEF" : null));
      const rankRow = rankingById.get(playerId);
      const defenseTeam = canonicalTeam(playerId);
      const defense = position === "DEF" ? defenseByTeam.get(defenseTeam) : undefined;
      const teamKey = position === "DEF" ? defenseTeam : canonicalTeam(meta?.team ?? "");
      const gamePhase = gamePhaseByTeam.get(teamKey) ?? null;
      const injuryStatus = rankRow?.injuryStatus ?? weeklyAvailabilityStatus(meta);
      const isUnavailable = position !== "DEF" && isUnavailableForCurrentWeek(injuryStatus);
      const pregameProjection = position === "DEF"
        ? (defense?.pregameProjection ?? null)
        : (rankRow?.leagueProjection ?? null);
      const sleeperProjection = sleeperProjectionsByPlayerId.get(playerId)?.stats;
      const customLiveProjection = ["QB", "RB", "WR", "TE", "K"].includes(position)
        ? scoreSleeperPlayerProjection(position as Ranking["position"], sleeperProjection, league.scoring_settings)
        : null;
      const fallbackLiveProjection = rankingField === "ppr"
        ? (sleeperProjection?.pts_ppr ?? sleeperProjection?.pts_half_ppr ?? sleeperProjection?.pts_std ?? null)
        : (sleeperProjection?.pts_half_ppr ?? sleeperProjection?.pts_ppr ?? sleeperProjection?.pts_std ?? null);
      const liveLeg = gamePhase === "live" && !isUnavailable ? (customLiveProjection ?? fallbackLiveProjection) : null;
      const resolvedIsBye = rankRow?.isBye ?? (teamKey !== "" && scheduleWeekAvailable && !opponentByTeam.has(teamKey));
      const pregameOrNull = resolvedIsBye ? null : isUnavailable ? 0 : pregameProjection;
      const projection = gamePhase === "live" ? (liveLeg ?? pregameOrNull) : pregameOrNull;
      const projectionSource = gamePhase === "final"
        ? null
        : position === "DEF"
          ? (defense?.projectionSource ?? null)
          : isUnavailable
            ? "fallback" as const
            : gamePhase === "live"
              ? (liveLeg !== null ? "sleeper" as const : (rankRow?.projectionSource ?? "fallback"))
              : (rankRow?.projectionSource ?? "fallback");
      const projectionComponents = gamePhase === "final" || position === "DEF" || projection === null || isUnavailable
        ? null
        : gamePhase === "live" && liveLeg !== null
          ? (sleeperProjection ?? null)
          : (rankRow?.projectionComponents ?? null);
      const actual = typeof activeMatchup?.players_points?.[playerId] === "number" ? activeMatchup.players_points[playerId] ?? null : null;
      if (position === "DEF" && actual !== null) defenseActuals.set(defenseTeam, actual);
      return {
        playerId,
        name: position === "DEF" ? `${defenseTeam} Defense` : (meta?.full_name ?? ([meta?.first_name, meta?.last_name].filter(Boolean).join(" ") || "Unknown player")),
        team: position === "DEF" ? defenseTeam : (meta?.team ?? null),
        position,
        lineupSlot: isStarter && starterIndex !== undefined ? (starterSlots[starterIndex] ?? position) : null,
        isStarter,
        rank: rankRow ? (rankRow.leagueProjection === null ? null : rankRow.leagueRank) : (defense?.rank ?? null),
        projection,
        projectionSource,
        actual,
        gamePhase,
        gameTime: rankRow?.gameTime ?? defense?.gameTime ?? gameTimeByTeam.get(teamKey) ?? null,
        opponent: rankRow?.opponent ?? defense?.opponent ?? opponentByTeam.get(teamKey) ?? null,
        isAway: rankRow?.isAway ?? defense?.isAway ?? isAwayByTeam.get(teamKey) ?? null,
        isBye: resolvedIsBye,
        injuryStatus,
        defenseComponents: defense?.components ?? null,
        projectionComponents,
      };
    };

    const starterIds = ownRoster.starters ?? [];
    const starters = starterIds.map((id, index) => ({ id, index })).filter(({ id }) => id && id !== "0").map(({ id, index }) => makePlayer(id, true, matchup, index));
    const starterSet = new Set(starterIds);
    const bench = (ownRoster.players ?? []).filter((id) => !starterSet.has(id)).map((id) => makePlayer(id, false, matchup));
    const opponentStarterIds = opponentRoster?.starters ?? [];
    const opponentStarters = opponentStarterIds.map((id, index) => ({ id, index })).filter(({ id }) => id && id !== "0").map(({ id, index }) => makePlayer(id, true, opponentMatchup, index));
    const opponentStarterSet = new Set(opponentStarterIds);
    const opponentBench = (opponentRoster?.players ?? []).filter((id) => !opponentStarterSet.has(id)).map((id) => makePlayer(id, false, opponentMatchup));
    const opponentOwner = usersResult.status === "fulfilled"
      ? usersResult.value.find((user) => user.user_id === opponentRoster?.owner_id)
      : undefined;
    const opponentName = opponentRoster?.metadata?.team_name
      ?? opponentOwner?.metadata?.team_name
      ?? opponentOwner?.display_name
      ?? "Opponent";
    const settings = ownRoster.settings ?? {};
    const usersById = new Map((usersResult.status === "fulfilled" ? usersResult.value : []).map((user) => [user.user_id, user]));
    const powerTeamName = (roster: SleeperRoster): string => {
      const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
      return roster.metadata?.team_name ?? owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`;
    };
    const powerTeamRecord = (roster: SleeperRoster): { wins: number; losses: number; ties: number } => ({
      wins: roster.settings?.wins ?? 0,
      losses: roster.settings?.losses ?? 0,
      ties: roster.settings?.ties ?? 0,
    });
    const normalizeRosterPlayerId = (id: string): string => /^[A-Z]{2,3}$/.test(id) ? canonicalTeam(id) : id;
    const rosterAssignments: z.infer<typeof rosterAssignmentSchema>[] = rosters.flatMap((roster) => {
      const teamName = powerTeamName(roster);
      return (roster.players ?? []).map((id) => ({
        playerId: normalizeRosterPlayerId(id),
        teamName,
        isUser: roster.roster_id === ownRoster.roster_id,
      }));
    });
    const rosteredPlayerIds = [...new Set(rosterAssignments.map((assignment) => assignment.playerId))];
    const matchupByRosterId = new Map(matchups.map((row) => [row.roster_id, row]));

    const pickTemplates = seasonLongRankings.filter((row) => row.formatKey === seasonLongFormat.key && row.position === "PICK");
    type PickTier = "early" | "mid" | "late";
    const pickTemplatesByTier = new Map<string, SeasonLongRanking>();
    const pickCoordinates = new Map<string, { season: string; round: number }>();
    for (const template of pickTemplates) {
      const seasonMatch = template.name.match(/\b(20\d{2})\b/);
      const roundMatch = template.name.match(/\b([1-9])(?:st|nd|rd|th)\b/i);
      const pickSeason = seasonMatch?.[1];
      const pickRound = Number(roundMatch?.[1]);
      if (!pickSeason || !Number.isInteger(pickRound)) continue;
      const tier: PickTier = /\bearly\b/i.test(template.name) ? "early" : /\blate\b/i.test(template.name) ? "late" : "mid";
      const coordinateKey = `${pickSeason}:${pickRound}`;
      pickTemplatesByTier.set(`${coordinateKey}:${tier}`, template);
      pickCoordinates.set(coordinateKey, { season: pickSeason, round: pickRound });
    }
    const tradedPicks = tradedPicksResult.status === "fulfilled" ? tradedPicksResult.value : [];
    const ordinal = (value: number): string => value === 1 ? "1st" : value === 2 ? "2nd" : value === 3 ? "3rd" : `${value}th`;
    // Season-long power rankings (roster-only values) drive pick-tier estimation:
    // a cellar team's future 1st is worth an "early" 1st, a contender's a "late" 1st.
    // Built here so both ownedPicks (trade calculator) and futurePickValue (power
    // rankings display) share the same rank source.
    const makePowerRankings = (formatKey: string): z.infer<typeof powerRankingSchema>[] => {
      const values = seasonLongRankings.filter((row) => row.formatKey === formatKey && row.position !== "PICK");
      if (values.length === 0) return [];
      const valuesByPlayerId = new Map(values.map((row) => [row.playerId, row]));
      return rosters
        .map((roster) => {
          const positionValues = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
          for (const playerId of roster.players ?? []) {
            const valueRow = valuesByPlayerId.get(playerId);
            if (!valueRow || valueRow.position === "PICK") continue;
            positionValues[valueRow.position] += valueRow.value;
          }
          const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
          return {
            rosterId: roster.roster_id,
            teamName: roster.metadata?.team_name ?? owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`,
            record: powerTeamRecord(roster),
            rank: 0,
            totalValue: positionValues.QB + positionValues.RB + positionValues.WR + positionValues.TE,
            futurePickValue: 0,
            positionValues,
            isUser: roster.roster_id === ownRoster.roster_id,
          };
        })
        .sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName))
        .map((row, index) => ({ ...row, rank: index + 1 }));
    };
    const seasonLongPowerFormatKey = `redraft-${seasonLongFormat.numQbs}qb-${seasonLongFormat.numTeams}t-${seasonLongFormat.ppr}ppr`;
    const powerRankingsSeasonLong = makePowerRankings(seasonLongPowerFormatKey);
    const rankByRosterId = new Map(powerRankingsSeasonLong.map((row) => [row.rosterId, row.rank]));
    const teamCount = rosters.length;
    const ownedPicksByRosterId = new Map<number, SeasonLongRanking[]>();
    if (seasonLongFormat.isDynasty) {
      for (const [coordinateKey, { season: pickSeason, round: pickRound }] of pickCoordinates) {
        for (const originalRoster of rosters) {
          const originalRank = rankByRosterId.get(originalRoster.roster_id);
          const tier: PickTier = originalRank === undefined ? "mid"
            : originalRank <= teamCount / 3 ? "late"
            : originalRank <= (2 * teamCount) / 3 ? "mid" : "early";
          const template = pickTemplatesByTier.get(`${coordinateKey}:${tier}`)
            ?? pickTemplatesByTier.get(`${coordinateKey}:mid`);
          if (!template) continue;
          const trade = tradedPicks.find((row) => row.season === pickSeason && row.round === pickRound && row.roster_id === originalRoster.roster_id);
          const ownerRosterId = trade?.owner_id ?? originalRoster.roster_id;
          const owner = rosters.find((roster) => roster.roster_id === ownerRosterId);
          if (!owner) continue;
          const originalTeamName = powerTeamName(originalRoster);
          const owned = ownedPicksByRosterId.get(ownerRosterId) ?? [];
          owned.push({
            ...template,
            playerId: `pick:${league.league_id}:${pickSeason}:${pickRound}:${originalRoster.roster_id}`,
            name: `${pickSeason} ${ordinal(pickRound)} · ${originalTeamName}`,
          });
          ownedPicksByRosterId.set(ownerRosterId, owned);
        }
      }
    }
    const tradeTeams: z.infer<typeof tradeTeamSchema>[] = rosters.map((roster) => {
      const rosterMatchup = matchupByRosterId.get(roster.roster_id);
      const submittedStarterIds = roster.starters ?? [];
      const submittedStarterSet = new Set(submittedStarterIds);
      const rosterPlayers = [
        ...submittedStarterIds.map((id, index) => ({ id, index })).filter(({ id }) => id && id !== "0").map(({ id, index }) => makePlayer(id, true, rosterMatchup, index)),
        ...(roster.players ?? []).filter((id) => !submittedStarterSet.has(id)).map((id) => makePlayer(id, false, rosterMatchup)),
      ];
      return {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id ?? null,
        teamName: powerTeamName(roster),
        isUser: roster.roster_id === ownRoster.roster_id,
        players: rosterPlayers,
        ownedPicks: ownedPicksByRosterId.get(roster.roster_id) ?? [],
      };
    });
    const rosteredSet = new Set(rosteredPlayerIds);
    const tradeWaiverPool: RosterPlayer[] = leagueRankings
      .filter((row) => ["QB", "RB", "WR", "TE"].includes(row.position) && !rosteredSet.has(row.playerId))
      .map((row) => ({
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        lineupSlot: null,
        isStarter: false,
        rank: row.leagueRank,
        projection: row.leagueProjection,
        projectionSource: row.projectionSource,
        actual: null,
        gamePhase: "pregame" as const,
        gameTime: row.gameTime,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: row.isBye,
        injuryStatus: row.injuryStatus,
        defenseComponents: null,
        projectionComponents: row.projectionComponents,
      }))
      .sort((a, b) => (b.projection ?? -1000) - (a.projection ?? -1000) || a.name.localeCompare(b.name));
    const powerRankingsWeek: z.infer<typeof powerRankingSchema>[] = leagueRankings.length === 0 ? [] : rosters
      .map((roster) => {
        const positionValues = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
        const rosterMatchup = matchupByRosterId.get(roster.roster_id);
        const rosterStarterIds = roster.starters ?? [];
        const powerStarters = rosterStarterIds
          .map((id, index) => ({ id, index }))
          .filter(({ id }) => id && id !== "0")
          .map(({ id, index }) => makePlayer(id, true, rosterMatchup, index));
        const powerStarterSet = new Set(rosterStarterIds);
        const powerBench = (roster.players ?? [])
          .filter((id) => !powerStarterSet.has(id))
          .map((id) => makePlayer(id, false, rosterMatchup));
        const optimizedLineup = optimizeWeeklyPowerLineup(powerStarters, powerBench);
        for (const player of optimizedLineup) {
          const position = ["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"].includes(player.lineupSlot ?? "")
            ? "FLEX"
            : player.position;
          if (!(position in positionValues)) continue;
          const value = player.gamePhase === "final" ? player.actual : player.projection;
          if (value !== null) positionValues[position as keyof typeof positionValues] += value;
        }
        for (const position of Object.keys(positionValues) as Array<keyof typeof positionValues>) {
          positionValues[position] = Number(positionValues[position].toFixed(2));
        }
        return {
          rosterId: roster.roster_id,
          teamName: powerTeamName(roster),
          record: powerTeamRecord(roster),
          rank: 0,
          totalValue: Number(Object.values(positionValues).reduce((total, value) => total + value, 0).toFixed(2)),
          futurePickValue: 0,
          positionValues,
          isUser: roster.roster_id === ownRoster.roster_id,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName))
      .map((row, index) => ({ ...row, rank: index + 1 }));
    // seasonLongPowerFormatKey / powerRankingsSeasonLong / rankByRosterId / teamCount
    // are defined above (before ownedPicks) so both the trade calculator and the
    // power-rankings display share the same rank source.
    const futurePickValueByRosterId = new Map<number, number>();
    if (seasonLongFormat.isDynasty && teamCount > 0) {
      for (const [coordinateKey, { season: pickSeason, round: pickRound }] of pickCoordinates) {
        if (Number(pickSeason) <= season) continue;
        for (const originalRoster of rosters) {
          const originalRank = rankByRosterId.get(originalRoster.roster_id);
          if (originalRank === undefined) continue;
          const tier: PickTier = originalRank <= teamCount / 3
            ? "late"
            : originalRank <= (2 * teamCount) / 3 ? "mid" : "early";
          const template = pickTemplatesByTier.get(`${coordinateKey}:${tier}`)
            ?? pickTemplatesByTier.get(`${coordinateKey}:mid`);
          if (!template) continue;
          const trade = tradedPicks.find((row) => row.season === pickSeason && row.round === pickRound && row.roster_id === originalRoster.roster_id);
          const ownerRosterId = trade?.owner_id ?? originalRoster.roster_id;
          if (!rosters.some((roster) => roster.roster_id === ownerRosterId)) continue;
          const currentValue = futurePickValueByRosterId.get(ownerRosterId) ?? 0;
          futurePickValueByRosterId.set(ownerRosterId, currentValue + template.value);
        }
      }
    }
    const powerRankingsDynasty = seasonLongFormat.isDynasty
      ? makePowerRankings(seasonLongFormat.key)
        .map((row) => {
          const futurePickValue = Number((futurePickValueByRosterId.get(row.rosterId) ?? 0).toFixed(2));
          return {
            ...row,
            futurePickValue,
            totalValue: Number((row.totalValue + futurePickValue).toFixed(2)),
          };
        })
        .sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName))
        .map((row, index) => ({ ...row, rank: index + 1 }))
      : [];
    return {
      id: league.league_id,
      name: league.name,
      scoringLabel,
      rankingField,
      record: { wins: settings.wins ?? 0, losses: settings.losses ?? 0, ties: settings.ties ?? 0 },
      teamActual: typeof matchup?.points === "number" ? matchup.points : null,
      teamProjection: sumActualsAndRemainingProjections(starters),
      starters,
      bench,
      opponentTeam: opponentRoster ? {
        name: opponentName,
        teamActual: typeof opponentMatchup?.points === "number" ? opponentMatchup.points : null,
        teamProjection: sumActualsAndRemainingProjections(opponentStarters),
        starters: opponentStarters,
        bench: opponentBench,
      } : null,
      suggestion: makeSuggestion(starters, bench),
      rosteredPlayerIds,
      rosterAssignments,
      rankingPositions,
      showSuperFilter,
      seasonLongFormat,
      tradeValuation,
      tradeTeams,
      tradeWaiverPool,
      tradeStarterSlots: starterSlots,
      powerRankingsWeek,
      powerRankingsSeasonLong,
      powerRankingsDynasty,
    };
  });

  for (const defense of defenses) {
    if (defense.gamePhase !== "final") continue;
    defense.actualScore = defenseActuals.get(defense.team) ?? null;
    defense.displayProjection = defense.actualScore;
  }

  const leagueIds = leagues.flatMap((league) => league ? [league.id] : []);
  const strengthOfSchedule = await loadStrengthOfSchedule(ctx, leagueIds);

  const dashboard = dashboardResponse.parse({
    status: sourceErrors.length > 0 ? "partial" : "ok",
    season,
    week,
    asOf: new Date().toISOString(),
    rankingsAsOf: useVegasPrimary ? (vegasProjectionSnapshot?.built_at ?? null) : null,
    fantasyCalcAsOf,
    leagues: leagues.filter((league): league is NonNullable<typeof league> => league !== null),
    rankings,
    weeklyChartRankings,
    seasonLongRankings,
    defenses,
    analytics,
    strengthOfSchedule,
    sourceErrors: [...new Set(sourceErrors)],
  });
  await saveProjectionAccuracy(ctx, dashboard);
  return dashboard;
}

function parseUsableDashboard(payload: string): Dashboard | null {
  try {
    const dashboard = dashboardResponse.parse(JSON.parse(payload));
    // A refresh can still produce a schema-valid shell when every per-league
    // Sleeper request fails. Never promote that shell over a previously usable
    // snapshot: without a league, the client has nothing it can render.
    return dashboard.leagues.length > 0 ? dashboard : null;
  } catch {
    return null;
  }
}

async function getCached(ctx: Ctx): Promise<Dashboard | null> {
  const db = ctx.db<typeof schema>();

  // Read the canonical snapshot directly. The previous query selected up to 24
  // historical dashboard payloads (each several MB) before parsing the newest
  // one. Loading only the saved snapshot keeps the dashboard render path free
  // of source fetching and projection merging.
  const currentRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, CACHE_KEY))
    .limit(1);
  const current = currentRows[0];
  if (current) {
    const dashboard = parseUsableDashboard(current.payload);
    if (dashboard) return dashboard;
  }

  // Preserve compatibility after a cache-key version bump, but only pay for
  // legacy payloads when the canonical snapshot is absent or unusable.
  const legacyRows = await db.select().from(schema.sourceCache)
    .where(like(schema.sourceCache.cacheKey, "dashboard-live-projections-v%"))
    .orderBy(desc(schema.sourceCache.fetchedAt))
    .limit(6);
  for (const row of legacyRows) {
    if (row.cacheKey === CACHE_KEY) continue;
    const dashboard = parseUsableDashboard(row.payload);
    if (dashboard) return dashboard;
  }
  return null;
}

type PlayerNewsRosterContext = {
  playerId: string;
  player: string;
  team: string;
  position: string;
  injuryStatus: string | null;
  leagues: Array<{ id: string; name: string }>;
};

async function buildPlayerNewsRosterContext(): Promise<{
  active: boolean;
  season: number;
  week: number;
  players: PlayerNewsRosterContext[];
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
      position: player.position ?? "—",
      injuryStatus: weeklyAvailabilityStatus(player),
      leagues,
    }];
  }).sort((a, b) => a.player.localeCompare(b.player));
  return { active: true, season, week: state.week, players: rosteredPlayers };
}

async function buildPlayerNewsAvailability(playerIds: string[]): Promise<Map<string, z.infer<typeof playerNewsAvailabilitySchema>[]>> {
  const requestedIds = [...new Set(playerIds)];
  const result = new Map<string, z.infer<typeof playerNewsAvailabilitySchema>[]>();
  for (const playerId of requestedIds) result.set(playerId, []);

  const leagueResults = await Promise.allSettled(PLAYER_NEWS_LEAGUES.map(async (league) => ({
    league,
    rosters: await fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.id}/rosters`),
  })));
  for (const [index, leagueResult] of leagueResults.entries()) {
    const league = PLAYER_NEWS_LEAGUES[index];
    if (!league) continue;
    for (const playerId of requestedIds) {
      const rows = result.get(playerId) ?? [];
      if (leagueResult.status === "rejected") {
        rows.push({ leagueId: league.id, league: league.name, status: "unknown" });
      } else {
        const owningRoster = leagueResult.value.rosters.find((roster) => (roster.players ?? []).includes(playerId));
        rows.push({
          leagueId: league.id,
          league: league.name,
          status: !owningRoster ? "available" : owningRoster.owner_id === SLEEPER_USER_ID ? "your_roster" : "other_roster",
        });
      }
      result.set(playerId, rows);
    }
  }
  return result;
}

function parseNewsAvailability(payload: string | null): z.infer<typeof playerNewsAvailabilitySchema>[] {
  if (!payload) return [];
  try {
    return z.array(playerNewsAvailabilitySchema).parse(JSON.parse(payload));
  } catch {
    return [];
  }
}

function parseInjurySnapshot(payload: string | undefined): Record<string, string | null> {
  if (!payload) return {};
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter((entry): entry is [string, string | null] => typeof entry[1] === "string" || entry[1] === null);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function saveProjectionAccuracy(ctx: Ctx, dashboard: Dashboard): Promise<void> {
  const db = ctx.db<typeof schema>();
  const vegasById = new Map(dashboard.rankings.map((row) => [`${row.leagueId}:${row.playerId}`, row]));
  for (const league of dashboard.leagues) {
    const playerRows = [
      ...league.starters,
      ...league.bench,
      ...(league.opponentTeam?.starters ?? []),
      ...(league.opponentTeam?.bench ?? []),
    ];
    const unique = new Map(playerRows.map((player) => [player.playerId, player]));
    const isPpfdLeague = league.id === DYNASTICAL_CUCKS_LEAGUE_ID;
    const values = [...unique.values()].flatMap((player) => {
      const vegas = vegasById.get(`${league.id}:${player.playerId}`);
      if (!vegas) return [];
      const vegasProjection = vegas.projectionSource === "vegas" ? vegas.leagueProjection : null;
      if (vegasProjection === null) return [];
      return [{
        id: `${dashboard.season}:${dashboard.week}:${league.id}:${player.playerId}`,
        season: dashboard.season,
        week: dashboard.week,
        leagueId: league.id,
        scoring: isPpfdLeague ? "ppfd" : league.rankingField,
        playerId: player.playerId,
        playerName: player.name,
        position: player.position,
        vegasProjection: Math.round(vegasProjection * 100),
        // Dynastical's projections are disclosed PPR proxies, while Sleeper's
        // actuals are PPFD. Keep the proxy snapshot, but exclude that mismatched
        // pair from MAE by leaving the actual leg empty. Sleeper reports zeroes
        // before kickoff, so keep pregame actuals null until play begins.
        actualScore: isPpfdLeague || player.gamePhase === "pregame" || player.actual === null
          ? null
          : Math.round(player.actual * 100),
        capturedAt: new Date(dashboard.asOf),
      }];
    });
    for (let index = 0; index < values.length; index += 100) {
      const chunk = values.slice(index, index + 100);
      if (!chunk.length) continue;
      for (const row of chunk) {
        const insert = db.insert(schema.projectionAccuracy).values(row);
        if (dashboard.week === 3) {
          // Week 3 is the pre-calibration baseline. Keep its identity and Vegas
          // projection frozen while allowing the outcome leg to fill in.
          await insert.onConflictDoUpdate({
            target: schema.projectionAccuracy.id,
            set: {
              actualScore: row.actualScore,
            },
          });
        } else {
          await insert.onConflictDoUpdate({
            target: schema.projectionAccuracy.id,
            set: {
              scoring: row.scoring,
              vegasProjection: row.vegasProjection,
              actualScore: row.actualScore,
              capturedAt: row.capturedAt,
            },
          });
        }
      }
    }
  }
}

async function saveFantasyCalcSnapshot(ctx: Ctx, dashboard: Dashboard): Promise<void> {
  if (!dashboard.fantasyCalcAsOf || dashboard.seasonLongRankings.length === 0) return;
  const db = ctx.db<typeof schema>();
  const snapshotDate = dashboard.fantasyCalcAsOf.slice(0, 10);
  const capturedAt = new Date(dashboard.fantasyCalcAsOf);
  const rows = dashboard.seasonLongRankings
    .filter((row) => row.position !== "PICK")
    .map((row) => ({
      id: `${snapshotDate}:${row.formatKey}:${row.playerId}`,
      snapshotDate,
      formatKey: row.formatKey,
      playerId: row.playerId,
      playerName: row.name,
      position: row.position,
      value: row.value,
      capturedAt,
    }));
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    if (chunk.length) await db.insert(schema.playerValueSnapshots).values(chunk).onConflictDoNothing();
  }
}


type FfcPlayer = {
  player_id?: string | number;
  name?: string;
  position?: string;
  team?: string;
  adp?: number;
  high?: number;
  low?: number;
  times_drafted?: number;
};
type FfcResponse = { players?: FfcPlayer[] };
type MflAdpResponse = { adp?: { player?: Array<{ id?: string; averagePick?: string | number }> } };
type MflPlayersResponse = { players?: { player?: Array<{ id?: string; name?: string; position?: string; team?: string }> } };
type SleeperTrend = { player_id?: string; count?: number };
type SleeperDraft = {
  draft_id?: string;
  league_id?: string | null;
  season?: string;
  status?: string;
  type?: string;
  start_time?: number | null;
  last_picked?: number | null;
  settings?: { rounds?: number; teams?: number };
  draft_order?: Record<string, number>;
  slot_to_roster_id?: Record<string, number | null>;
  metadata?: { name?: string };
};
type SleeperDraftPick = {
  pick_no?: number;
  round?: number;
  draft_slot?: number;
  roster_id?: number | null;
  picked_by?: string | number | null;
  player_id?: string;
  metadata?: { first_name?: string; last_name?: string; team?: string; position?: string; player_id?: string };
};
type PolyMarket = { question?: string; slug?: string; category?: string; outcomePrices?: string | string[]; lastTradePrice?: number | string; oneDayPriceChange?: number | string; sportsMarketType?: string; line?: number | string };
type KalshiMarket = { title?: string; subtitle?: string; ticker?: string; event_ticker?: string; floor_strike?: number | string; yes_bid_dollars?: string; yes_ask_dollars?: string; yes_bid?: number; yes_ask?: number; last_price_dollars?: string; previous_price_dollars?: string; last_price?: number; previous_price?: number };
type KalshiEvent = { event_ticker?: string; markets?: KalshiMarket[] };

type DraftCenter = z.infer<typeof draftCenterResponse>;
type CachedDraftMarket = Pick<DraftCenter, "adpAsOf" | "adp" | "trending" | "trendingDrops" | "markets" | "vegasLines" | "sourceStatus" | "sourceErrors">;

function normalizedPlayerName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/jr$|sr$|ii$|iii$|iv$/g, "");
  const aliases: Record<string, string> = {
    joshpalmer: "joshuapalmer",
    joshuapalmer: "joshuapalmer",
  };
  return aliases[normalized] ?? normalized;
}

function parseNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nflMarketScope(title: string): "game" | "season" {
  return /super bowl|champion|mvp|wins?|playoffs?|conference|division/i.test(title) ? "season" : "game";
}

function isNflMarket(title: string): boolean {
  return /\bNFL\b|Super Bowl|MVP|touchdown|passing|rushing|receiving|Chiefs|Bills|Eagles|Cowboys|49ers|Ravens|Bengals|Lions|Packers|Jets|Patriots|Dolphins|Steelers|Browns|Texans|Colts|Jaguars|Titans|Broncos|Raiders|Chargers|Commanders|Giants|Seahawks|Rams|Cardinals|Saints|Falcons|Panthers|Buccaneers|Vikings|Bears/i.test(title);
}

function parseOutcomeProbability(value: string | string[] | undefined, fallback: number | string | undefined): number | null {
  try {
    const values = Array.isArray(value) ? value : value ? JSON.parse(value) as unknown : [];
    if (Array.isArray(values)) {
      const first = parseNumber(values[0]);
      if (first !== null) return Math.round(first * 1000) / 10;
    }
  } catch {
    // A market without parseable prices can still be shown without a probability.
  }
  const fallbackValue = parseNumber(fallback);
  return fallbackValue === null ? null : Math.round(fallbackValue * 1000) / 10;
}

function kalshiProbability(row: KalshiMarket): number | null {
  const bid = parseNumber(row.yes_bid_dollars) ?? (parseNumber(row.yes_bid) === null ? null : (parseNumber(row.yes_bid) ?? 0) / 100);
  const ask = parseNumber(row.yes_ask_dollars) ?? (parseNumber(row.yes_ask) === null ? null : (parseNumber(row.yes_ask) ?? 0) / 100);
  const last = parseNumber(row.last_price_dollars) ?? (parseNumber(row.last_price) === null ? null : (parseNumber(row.last_price) ?? 0) / 100);
  const decimal = bid !== null && ask !== null && (bid > 0 || ask > 0) ? (bid + ask) / 2 : last;
  return decimal === null || decimal <= 0 ? null : Math.round(decimal * 1000) / 10;
}

function extractVegasLines(poly: PolyMarket[], kalshi: KalshiMarket[]): z.infer<typeof vegasLineSchema>[] {
  const lines: z.infer<typeof vegasLineSchema>[] = [];
  for (const row of kalshi) {
    const ticker = row.ticker ?? "";
    const match = ticker.match(/^KXNFL(TOTAL|SPREAD)-\d{2}[A-Z]{3}\d{2}([A-Z]+)-([A-Z]*)(\d+)$/);
    if (!match) continue;
    const marketType = match[1] === "TOTAL" ? "total" as const : "spread" as const;
    const title = [row.title, row.subtitle].filter(Boolean).join(" ");
    const floorStrike = parseNumber(row.floor_strike);
    const titleLine = Number(title.match(/(?:over|by over)\s+(\d+(?:\.\d+)?)/i)?.[1]);
    const encoded = Number(match[4]);
    const line = floorStrike ?? (Number.isFinite(titleLine) ? titleLine : Number.isFinite(encoded) ? encoded - 0.5 : Number.NaN);
    if (!Number.isFinite(line)) continue;
    lines.push({
      source: "Kalshi",
      matchupCode: match[2] ?? "",
      marketType,
      team: marketType === "spread" ? canonicalTeam(match[3] ?? "") : null,
      line,
      probability: kalshiProbability(row),
    });
  }
  for (const row of poly) {
    const marketType = row.sportsMarketType === "totals" ? "total" as const : row.sportsMarketType === "spreads" ? "spread" as const : null;
    const slug = row.slug ?? "";
    const match = slug.match(/^nfl-([a-z]{2,3})-([a-z]{2,3})-/i);
    const line = parseNumber(row.line);
    if (!marketType || !match || line === null) continue;
    lines.push({
      source: "Polymarket",
      matchupCode: `${match[1] ?? ""}${match[2] ?? ""}`.toUpperCase(),
      marketType,
      team: null,
      line: Math.abs(line),
      probability: parseOutcomeProbability(row.outcomePrices, row.lastTradePrice),
    });
  }
  return lines;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractActionNetworkSplits(html: string): z.infer<typeof marketSignalSchema>[] {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return [];
  let root: Record<string, unknown> | null = null;
  try { root = asRecord(JSON.parse(match[1])); } catch { return []; }
  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps);
  const scoreboard = asRecord(pageProps?.scoreboardResponse);
  const games = Array.isArray(scoreboard?.games) ? scoreboard.games : [];
  const results: z.infer<typeof marketSignalSchema>[] = [];

  const labelForTeam = (game: Record<string, unknown>, teamId: unknown, fallback: string): string => {
    for (const key of ["away_team", "home_team", "awayTeam", "homeTeam"]) {
      const team = asRecord(game[key]);
      if (!team) continue;
      if (teamId !== undefined && String(team.id ?? team.team_id ?? "") !== String(teamId)) continue;
      const label = team.abbr ?? team.abbreviation ?? team.short_name ?? team.full_name ?? team.name;
      if (typeof label === "string" && label.trim()) return label.trim();
    }
    return fallback;
  };

  const collectOutcomes = (value: unknown, path: string[], game: Record<string, unknown>, marketType: string) => {
    if (results.length >= 8) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectOutcomes(item, [...path, String(index)], game, marketType));
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const betInfo = asRecord(record.bet_info);
    const tickets = asRecord(betInfo?.tickets);
    const money = asRecord(betInfo?.money);
    const betPct = parseNumber(tickets?.percent);
    const moneyPct = parseNumber(money?.percent);
    if (betPct !== null && moneyPct !== null && betPct >= 0 && betPct <= 100 && moneyPct >= 0 && moneyPct <= 100) {
      const explicit = record.abbr ?? record.abbreviation ?? record.name ?? record.label ?? record.side;
      const side = typeof explicit === "string" && explicit.trim()
        ? explicit.trim()
        : labelForTeam(game, record.team_id ?? record.teamId, path.some((item) => /away/i.test(item)) ? "Away" : path.some((item) => /home/i.test(item)) ? "Home" : path.at(-1) ?? "Side");
      const marketLabel = marketType === "moneyline" ? "moneyline" : marketType === "total" ? "total" : "spread";
      const line = parseNumber(record.line ?? record.spread ?? record.value ?? record.odds);
      const quote = line === null ? null : `${line > 0 ? "+" : ""}${line}`;
      results.push({
        source: "Action Network",
        scope: "game",
        title: `${side} ${marketLabel} split`,
        detail: `${Math.round(betPct)}% tickets · ${Math.round(moneyPct)}% money`,
        probability: null,
        move: null,
        quote,
        betPct: Math.round(betPct),
        moneyPct: Math.round(moneyPct),
      });
      return;
    }
    for (const [key, child] of Object.entries(record)) collectOutcomes(child, [...path, key], game, marketType);
  };

  for (const rawGame of games) {
    const game = asRecord(rawGame);
    const markets = asRecord(game?.markets);
    if (!game || !markets) continue;
    const consensus = asRecord(markets["15"]) ?? Object.values(markets).map(asRecord).find((book) => Boolean(asRecord(book?.event))) ?? null;
    const event = asRecord(consensus?.event);
    if (!event) continue;
    for (const marketType of ["spread", "moneyline", "total"] as const) {
      if (event[marketType] !== undefined) collectOutcomes(event[marketType], [marketType], game, marketType);
    }
    if (results.length >= 8) break;
  }
  return results;
}

async function fetchDraftMarketSnapshot(leagues: SleeperLeague[], players: Record<string, SleeperPlayer>): Promise<CachedDraftMarket> {
  const sourceErrors: string[] = [];
  const sourceStatus = {
    ffc: false,
    mfl: false,
    sleeperTrending: false,
    sleeperTrendingDrops: false,
    polymarket: false,
    kalshi: false,
    actionNetwork: false,
    fantasyProsLive: false,
  };
  const nameToSleeper = new Map<string, string[]>();
  for (const [playerId, player] of Object.entries(players)) {
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name || !["QB", "RB", "WR", "TE"].includes(normalizePosition(player.position))) continue;
    const key = normalizedPlayerName(name);
    nameToSleeper.set(key, [...(nameToSleeper.get(key) ?? []), playerId]);
  }
  const leagueFormats = leagues.flatMap((league) => {
    const format = seasonLongFormatForLeague(league);
    const ffcFormat = format.numQbs === 2 ? "2qb" : format.isDynasty ? "dynasty" : format.ppr === 1 ? "ppr" : format.ppr === 0.5 ? "half-ppr" : "standard";
    const allPlayers = { formatKey: format.key, ffcFormat, teams: format.numTeams, pool: "all" as const };
    return format.isDynasty
      ? [allPlayers, { formatKey: format.key, ffcFormat: "rookie", teams: format.numTeams, pool: "rookie" as const }]
      : [allPlayers];
  });
  const uniqueRequests = [...new Map(leagueFormats.map((item) => [`${item.ffcFormat}:${item.teams}`, item])).values()];

  const [ffcSettled, mflAdpResult, mflPlayersResult, trendResult, trendDropResult, polyResult, kalshiResult, kalshiTotalEventsResult, kalshiSpreadEventsResult, actionResult] = await Promise.all([
    Promise.allSettled(uniqueRequests.map(async (request) => ({
      request,
      response: await fetchJson<FfcResponse>(`${FFC_BASE_URL}/${request.ffcFormat}?teams=${request.teams}&year=2026`),
    }))),
    fetchJson<MflAdpResponse>(MFL_ADP_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: null })),
    fetchJson<MflPlayersResponse>(MFL_PLAYERS_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: null })),
    fetchJson<SleeperTrend[]>(`${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=24&limit=50`).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] })),
    fetchJson<SleeperTrend[]>(`${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=24&limit=50`).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] })),
    fetchJson<PolyMarket[]>(POLYMARKET_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] })),
    fetchJson<{ markets?: KalshiMarket[] }>(KALSHI_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: {} })),
    fetchJson<{ events?: KalshiEvent[] }>(KALSHI_TOTAL_EVENTS_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: {} })),
    fetchJson<{ events?: KalshiEvent[] }>(KALSHI_SPREAD_EVENTS_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: {} })),
    fetchText(ACTION_NETWORK_URL).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: "" })),
  ]);

  const directKalshiLines = [
    ...(kalshiTotalEventsResult.ok ? (kalshiTotalEventsResult.value.events ?? []) : []),
    ...(kalshiSpreadEventsResult.ok ? (kalshiSpreadEventsResult.value.events ?? []) : []),
  ].flatMap((event) => event.markets ?? []);

  const mflByName = new Map<string, number>();
  if (mflAdpResult.ok && mflPlayersResult.ok) {
    const playerNames = new Map((mflPlayersResult.value?.players?.player ?? []).flatMap((row) => row.id && row.name ? [[row.id, row.name] as const] : []));
    for (const row of mflAdpResult.value?.adp?.player ?? []) {
      const name = row.id ? playerNames.get(row.id) : undefined;
      const adp = parseNumber(row.averagePick);
      if (name && adp !== null) mflByName.set(normalizedPlayerName(name.includes(",") ? name.split(",").reverse().join(" ") : name), adp);
    }
    sourceStatus.mfl = true;
  } else sourceErrors.push("MyFantasyLeague ADP cross-check is temporarily unavailable.");

  const fetchedByRequest = new Map<string, FfcPlayer[]>();
  for (const result of ffcSettled) {
    if (result.status !== "fulfilled") continue;
    fetchedByRequest.set(`${result.value.request.ffcFormat}:${result.value.request.teams}`, result.value.response.players ?? []);
  }
  sourceStatus.ffc = fetchedByRequest.size > 0;
  if (!sourceStatus.ffc) sourceErrors.push("Fantasy Football Calculator ADP is temporarily unavailable.");
  const adp = leagueFormats.flatMap(({ formatKey, ffcFormat, teams, pool }) => (fetchedByRequest.get(`${ffcFormat}:${teams}`) ?? []).flatMap((row) => {
    const name = row.name?.trim();
    const adpValue = parseNumber(row.adp);
    if (!name || adpValue === null) return [];
    const candidates = nameToSleeper.get(normalizedPlayerName(name)) ?? [];
    const sleeperId = candidates.find((candidate) => {
      const player = players[candidate];
      return normalizePosition(player?.position) === normalizePosition(row.position) && (!row.team || !player?.team || player.team === row.team);
    }) ?? candidates.find((candidate) => normalizePosition(players[candidate]?.position) === normalizePosition(row.position)) ?? candidates[0] ?? null;
    const sleeper = sleeperId ? players[sleeperId] : undefined;
    return [{
      format: formatKey,
      pool,
      playerId: sleeperId,
      name,
      team: sleeper?.team ?? row.team ?? null,
      position: normalizePosition(sleeper?.position ?? row.position),
      adp: adpValue,
      high: parseNumber(row.high),
      low: parseNumber(row.low),
      timesDrafted: parseNumber(row.times_drafted) === null ? null : Math.round(parseNumber(row.times_drafted) ?? 0),
      mflAdp: mflByName.get(normalizedPlayerName(name)) ?? null,
    }];
  }));

  const trending = trendResult.value.flatMap((row, index) => {
    const playerId = row.player_id;
    const count = parseNumber(row.count);
    const player = playerId ? players[playerId] : undefined;
    if (!playerId || !player || count === null) return [];
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name) return [];
    return [{ playerId, name, team: player.team ?? null, position: normalizePosition(player.position), count: Math.round(count), rank: index + 1 }];
  });
  sourceStatus.sleeperTrending = trendResult.ok;
  if (!trendResult.ok) sourceErrors.push("Sleeper trending adds are temporarily unavailable.");
  const trendingDrops = trendDropResult.value.flatMap((row, index) => {
    const playerId = row.player_id;
    const count = parseNumber(row.count);
    const player = playerId ? players[playerId] : undefined;
    if (!playerId || !player || count === null) return [];
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name) return [];
    return [{ playerId, name, team: player.team ?? null, position: normalizePosition(player.position), count: Math.round(count), rank: index + 1 }];
  });
  sourceStatus.sleeperTrendingDrops = trendDropResult.ok;
  if (!trendDropResult.ok) sourceErrors.push("Sleeper trending drops are temporarily unavailable.");

  const markets: z.infer<typeof marketSignalSchema>[] = [];
  if (polyResult.ok) {
    sourceStatus.polymarket = true;
    for (const row of polyResult.value) {
      const title = row.question?.trim();
      if (!title || !isNflMarket(title)) continue;
      const probability = parseOutcomeProbability(row.outcomePrices, row.lastTradePrice);
      const oneDayChange = parseNumber(row.oneDayPriceChange);
      markets.push({ source: "Polymarket", scope: nflMarketScope(title), title, detail: "Real-money prediction market", probability, move: oneDayChange === null ? null : Math.round(oneDayChange * 1000) / 10, quote: probability === null ? null : `${probability.toFixed(1)}¢`, betPct: null, moneyPct: null });
      if (markets.filter((item) => item.source === "Polymarket").length >= 8) break;
    }
  } else sourceErrors.push("Polymarket NFL markets are temporarily unavailable.");
  if (kalshiResult.ok) {
    sourceStatus.kalshi = true;
    for (const row of kalshiResult.value.markets ?? []) {
      const title = [row.title, row.subtitle].filter(Boolean).join(" — ").trim();
      if (!title || title.length > 180 || (title.match(/,/g)?.length ?? 0) > 2 || /runs? scored|innings?|home runs?/i.test(title) || !/\bNFL\b|Super Bowl|NFL MVP|\bAFC\b|\bNFC\b/i.test(title)) continue;
      const bid = parseNumber(row.yes_bid_dollars) ?? (parseNumber(row.yes_bid) === null ? null : (parseNumber(row.yes_bid) ?? 0) / 100);
      const ask = parseNumber(row.yes_ask_dollars) ?? (parseNumber(row.yes_ask) === null ? null : (parseNumber(row.yes_ask) ?? 0) / 100);
      const lastPrice = parseNumber(row.last_price_dollars) ?? (parseNumber(row.last_price) === null ? null : (parseNumber(row.last_price) ?? 0) / 100);
      const previousPrice = parseNumber(row.previous_price_dollars) ?? (parseNumber(row.previous_price) === null ? null : (parseNumber(row.previous_price) ?? 0) / 100);
      const probability = bid !== null && ask !== null ? Math.round(((bid + ask) / 2) * 1000) / 10 : lastPrice === null ? null : Math.round(lastPrice * 1000) / 10;
      const move = lastPrice !== null && previousPrice !== null ? Math.round((lastPrice - previousPrice) * 1000) / 10 : null;
      markets.push({ source: "Kalshi", scope: nflMarketScope(title), title, detail: "Real-money event contract", probability, move, quote: probability === null ? null : `${probability.toFixed(1)}¢`, betPct: null, moneyPct: null });
      if (markets.filter((item) => item.source === "Kalshi").length >= 8) break;
    }
  } else sourceErrors.push("Kalshi NFL markets are temporarily unavailable.");
  if (actionResult.ok) {
    const actionSplits = extractActionNetworkSplits(actionResult.value);
    markets.push(...actionSplits);
    sourceStatus.actionNetwork = actionSplits.length > 0;
    if (actionSplits.length === 0) sourceErrors.push("Action Network did not expose live NFL betting splits in its public page data.");
  } else sourceErrors.push("Action Network public betting splits are temporarily unavailable.");
  sourceErrors.push("FantasyPros was not enabled because no verified live-data free key was available.");
  const vegasLines = extractVegasLines(
    polyResult.ok ? polyResult.value : [],
    [
      ...(kalshiResult.ok ? (kalshiResult.value.markets ?? []) : []),
      ...directKalshiLines,
    ],
  );
  if (directKalshiLines.length > 0) sourceStatus.kalshi = true;
  if (!kalshiTotalEventsResult.ok || !kalshiSpreadEventsResult.ok) sourceErrors.push("Some direct Kalshi NFL game lines are temporarily unavailable.");

  return {
    adpAsOf: adp.length > 0 ? new Date().toISOString() : null,
    adp,
    trending,
    trendingDrops,
    markets,
    vegasLines,
    sourceStatus,
    sourceErrors,
  };
}

async function loadDraftMarketSnapshot(ctx: Ctx, force: boolean, leagues: SleeperLeague[], players: Record<string, SleeperPlayer>): Promise<CachedDraftMarket> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, DRAFT_MARKET_CACHE_KEY)).limit(1);
  const cached = rows[0];
  if (!force && cached && Date.now() - cached.fetchedAt.getTime() < DRAFT_MARKET_CACHE_MS) {
    try { return draftCenterResponse.pick({ adpAsOf: true, adp: true, trending: true, trendingDrops: true, markets: true, vegasLines: true, sourceStatus: true, sourceErrors: true }).parse(JSON.parse(cached.payload)); }
    catch { /* Refresh malformed or old cache below. */ }
  }
  try {
    const fresh = await withDeadline(fetchDraftMarketSnapshot(leagues, players), REFRESH_TIMEOUT_MS);
    await db.insert(schema.sourceCache).values({ cacheKey: DRAFT_MARKET_CACHE_KEY, payload: JSON.stringify(fresh), fetchedAt: new Date() })
      .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(fresh), fetchedAt: new Date() } });
    return fresh;
  } catch {
    if (cached) {
      try {
        const parsed = draftCenterResponse.pick({ adpAsOf: true, adp: true, trending: true, trendingDrops: true, markets: true, vegasLines: true, sourceStatus: true, sourceErrors: true }).parse(JSON.parse(cached.payload));
        return { ...parsed, sourceErrors: [...parsed.sourceErrors, "Market refresh failed; showing the last saved snapshot."] };
      } catch { /* Empty state below. */ }
    }
    return {
      adpAsOf: null,
      adp: [],
      trending: [],
      trendingDrops: [],
      markets: [],
      vegasLines: [],
      sourceStatus: { ffc: false, mfl: false, sleeperTrending: false, sleeperTrendingDrops: false, polymarket: false, kalshi: false, actionNetwork: false, fantasyProsLive: false },
      sourceErrors: ["Draft and market sources are temporarily unavailable."],
    };
  }
}

function draftBoardModesForLeagues(leagues: SleeperLeague[]): z.infer<typeof draftBoardModeSchema>[] {
  return leagues.map((league) => {
    const format = seasonLongFormatForLeague(league);
    if (!format.isDynasty) return { leagueId: league.league_id, mode: "redraft" as const };
    // Sleeper rotates league IDs each season. A 2026 league that points to any
    // previous league is established by definition; that previous node is from
    // a season before 2026, so its board is rookie-only. A dynasty without that
    // history is a newly added startup league.
    const hasPreviousLeague = typeof league.previous_league_id === "string"
      && league.previous_league_id.length > 0
      && league.previous_league_id !== "0";
    return { leagueId: league.league_id, mode: hasPreviousLeague ? "rookie" as const : "startup" as const };
  });
}

async function fetchLiveDrafts(players: Record<string, SleeperPlayer>): Promise<z.infer<typeof liveDraftSchema>[]> {
  const drafts = await fetchJson<SleeperDraft[]>(`${SLEEPER_BASE}/user/${SLEEPER_USER_ID}/drafts/nfl/2026`);
  // Keep completed league drafts in the sync as well as open rooms. Their picks
  // are still authoritative for availability even after Sleeper closes a room.
  const relevant = drafts.filter((draft) => draft.draft_id);
  const details = await Promise.allSettled(relevant.map(async (summary) => {
    const draftId = summary.draft_id ?? "";
    const [draft, picks] = await Promise.all([
      fetchJson<SleeperDraft>(`${SLEEPER_BASE}/draft/${draftId}`),
      fetchJson<SleeperDraftPick[]>(`${SLEEPER_BASE}/draft/${draftId}/picks`),
    ]);
    const userSlots = (draft as SleeperDraft & { metadata?: SleeperDraft["metadata"] & { user_id_to_draft_slot?: string } }).metadata?.user_id_to_draft_slot;
    let ownDraftSlot: number | null = parseNumber(draft.draft_order?.[SLEEPER_USER_ID]);
    if (ownDraftSlot === null && userSlots) {
      try {
        const parsed = JSON.parse(userSlots) as Record<string, number>;
        ownDraftSlot = parseNumber(parsed[SLEEPER_USER_ID]);
      } catch { /* Some drafts omit this mapping until the room opens. */ }
    }
    const ownRosterId = ownDraftSlot === null ? null : parseNumber(draft.slot_to_roster_id?.[String(ownDraftSlot)]);
    return {
      draftId,
      leagueId: draft.league_id ?? summary.league_id ?? null,
      status: draft.status ?? summary.status ?? "unknown",
      type: draft.type ?? summary.type ?? "snake",
      startTime: typeof draft.start_time === "number" ? new Date(draft.start_time).toISOString() : null,
      rounds: parseNumber(draft.settings?.rounds) === null ? null : Math.round(parseNumber(draft.settings?.rounds) ?? 0),
      teams: parseNumber(draft.settings?.teams) === null ? null : Math.round(parseNumber(draft.settings?.teams) ?? 0),
      ownDraftSlot: ownDraftSlot === null ? null : Math.round(ownDraftSlot),
      ownRosterId: ownRosterId === null ? null : Math.round(ownRosterId),
      picks: picks.map((pick) => {
        const playerId = pick.player_id ?? pick.metadata?.player_id ?? "";
        const player = players[playerId];
        const name = player?.full_name ?? ([pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ") || "Unknown player");
        return {
          pickNo: Math.round(parseNumber(pick.pick_no) ?? 0),
          round: Math.round(parseNumber(pick.round) ?? 0),
          draftSlot: Math.round(parseNumber(pick.draft_slot) ?? 0),
          rosterId: parseNumber(pick.roster_id) === null ? null : Math.round(parseNumber(pick.roster_id) ?? 0),
          playerId,
          playerName: name,
          position: normalizePosition(player?.position ?? pick.metadata?.position),
          team: player?.team ?? pick.metadata?.team ?? null,
        };
      }).filter((pick) => pick.playerId),
    };
  }));
  return details.flatMap((result) => result.status === "fulfilled" ? [result.value] : []).sort((a, b) => {
    const priority = (status: string) => status === "drafting" ? 0 : status === "pre_draft" ? 1 : status === "complete" ? 2 : 3;
    const statusOrder = priority(a.status) - priority(b.status);
    if (statusOrder !== 0) return statusOrder;
    return (b.startTime ?? "").localeCompare(a.startTime ?? "");
  });
}

const HISTORICAL_TRADES_CACHE_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_PLAYERS_CACHE_KEY = "sleeper-players-nfl";
const HISTORICAL_PLAYERS_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

function ordinalRound(value: number): string {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}

function sleeperTeamName(roster: SleeperRoster, usersById: Map<string, SleeperUser>): string {
  const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
  return roster.metadata?.team_name ?? owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`;
}

type KickerChainEntry = {
  /** Kicker ordinal by startup draft order (1-based). Maps 1:1 to rookie pick_no. */
  ordinal: number;
  /** Rookie round this ordinal belongs to (1-based). */
  round: number;
  /** Roster that drafted the kicker in the startup draft. */
  kickerDrafterRosterId: number;
  /** Roster that picked the rookie in the linear draft. */
  rookiePickerRosterId: number;
  /** Player drafted at this rookie pick. */
  rookiePlayerId: string;
};

type PlaceholderDraftResolution = {
  /** League season whose startup snake draft used kickers as rookie-pick placeholders. */
  season: number;
  /** Snake draft's last_picked (ms epoch); trades at/after this resolve the season's picks to rookies. */
  cutoffMs: number;
  /** Max round of the same-season linear (rookie) draft. */
  maxRound: number;
  /**
   * Fixed kicker chain: for each kicker ordinal, who drafted the kicker and who
   * picked the corresponding rookie. Post-cutoff pick assets resolve by matching
   * (trader, round) to kickers that left the trader — no team-position inference.
   */
  kickerChain: KickerChainEntry[];
};

type HistoricalDraftResolution = {
  byOriginalPick: Map<string, string>;
  placeholderByLeagueId: Map<string, PlaceholderDraftResolution>;
};

async function fetchHistoricalSeason(
  league: SleeperLeague,
  players: Record<string, SleeperPlayer>,
  draftResolution: HistoricalDraftResolution,
): Promise<z.infer<typeof historicalTradeSchema>[]> {
  const [rosters, users] = await Promise.all([
    fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`),
    fetchJson<SleeperUser[]>(`${SLEEPER_BASE}/league/${league.league_id}/users`),
  ]);
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const rostersById = new Map(rosters.map((roster) => [roster.roster_id, roster]));
  const draftedPlayersByOriginalPick = draftResolution.byOriginalPick;
  const placeholder = league.league_id ? draftResolution.placeholderByLeagueId.get(league.league_id) : undefined;
  const season = Number(league.season ?? 0);
  const trades = new Map<string, z.infer<typeof historicalTradeSchema>>();

  const weeklyTransactions = await Promise.all(
    Array.from({ length: 18 }, (_, index) => {
      const round = index + 1;
      return fetchJson<SleeperTransaction[]>(`${SLEEPER_BASE}/league/${league.league_id}/transactions/${round}`)
        .then((transactions) => ({ round, transactions }));
    }),
  );

  for (const { round, transactions } of weeklyTransactions) {
    for (const transaction of transactions) {
      if (transaction.type !== "trade" || transaction.status !== "complete") continue;
      const transactionId = transaction.transaction_id;
      const rosterIds = transaction.roster_ids ?? [];
      if (!transactionId || rosterIds.length < 2) continue;
      const adds = transaction.adds ?? {};
      const drops = transaction.drops ?? {};
      const picks = transaction.draft_picks ?? [];
      const waiverBudget = transaction.waiver_budget ?? [];
      const createdMs = typeof transaction.created === "number" ? transaction.created : 0;
      // Kicker placeholders only became rookie picks once the startup draft finished.
      // Post-cutoff trades of the placeholder season's picks resolve through the
      // kicker chain: group assets by season, round, and trader (previous_owner_id),
      // then match entries where that trader drafted the kicker and the corresponding
      // rookie was picked by a different roster, proving the kicker left the trader's
      // hands. Matching rookies are assigned in ascending ordinal order; extras stay
      // unresolved. No team-position fallback: the roster_id on pick assets does not
      // reliably indicate which kicker moved.
      const rookiePickByAsset = new Map<(typeof picks)[number], string | null>();
      if (placeholder) {
        type GroupEntry = { pick: (typeof picks)[number]; trader: number; round: number };
        const groups = new Map<string, GroupEntry[]>();
        for (const pick of picks) {
          const pickSeason = Number(pick.season);
          const pickRound = Number(pick.round);
          if (!Number.isInteger(pickSeason) || !Number.isInteger(pickRound)) continue;
          if (pickSeason !== placeholder.season) continue;
          if (createdMs < placeholder.cutoffMs) continue;
          // Every post-cutoff pick from the placeholder season is owned by the
          // kicker-chain path. Start unresolved so missing participants, rounds
          // outside the chain, and zero-match groups never fall through to the
          // original-slot map below.
          rookiePickByAsset.set(pick, null);
          if (pickRound > placeholder.maxRound) continue;
          const trader = pick.previous_owner_id ?? null;
          if (trader === null) continue;
          const groupKey = `${pickSeason}:${pickRound}:${trader}`;
          const entry: GroupEntry = { pick, trader, round: pickRound };
          const group = groups.get(groupKey);
          if (group) group.push(entry);
          else groups.set(groupKey, [entry]);
        }
        for (const group of groups.values()) {
          const first = group[0];
          if (!first) continue;
          const { trader, round } = first;
          const matches = placeholder.kickerChain
            .filter((entry) =>
              entry.round === round &&
              entry.kickerDrafterRosterId === trader &&
              entry.rookiePickerRosterId !== trader,
            )
            .sort((a, b) => a.ordinal - b.ordinal);
          group.forEach(({ pick }, index) => {
            rookiePickByAsset.set(pick, matches[index]?.rookiePlayerId ?? null);
          });
        }
      }
      const teams = rosterIds.map((rosterId) => {
        const roster = rostersById.get(rosterId);
        const ownerId = roster?.owner_id ?? null;
        const receivedPlayers = Object.entries(adds)
          .filter(([, destinationRosterId]) => destinationRosterId === rosterId)
          .map(([playerId]) => {
            const player = players[playerId];
            const name = player?.full_name ?? ([player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown player");
            return {
              playerId,
              name,
              position: player?.position ?? "N/A",
              fromRosterId: drops[playerId] ?? null,
            };
          });
        const receivedPicks = picks
          .filter((pick) => pick.owner_id === rosterId)
          .flatMap((pick) => {
            const pickSeason = Number(pick.season);
            const pickRound = Number(pick.round);
            if (!Number.isInteger(pickSeason) || !Number.isInteger(pickRound)) return [];
            const originalRosterId = pick.roster_id ?? pick.previous_owner_id ?? null;
            const draftedPlayerId = rookiePickByAsset.has(pick)
              ? rookiePickByAsset.get(pick) ?? null
              : originalRosterId === null
                ? null
                : draftedPlayersByOriginalPick.get(`${pickSeason}:${pickRound}:${originalRosterId}`) ?? null;
            const draftedPlayer = draftedPlayerId ? players[draftedPlayerId] : undefined;
            const draftedPlayerName = draftedPlayer
              ? draftedPlayer.full_name ?? ([draftedPlayer.first_name, draftedPlayer.last_name].filter(Boolean).join(" ") || null)
              : null;
            return [{
              season: pickSeason,
              round: pickRound,
              description: `${pickSeason} ${ordinalRound(pickRound)}-round pick`,
              fromRosterId: pick.previous_owner_id ?? pick.roster_id ?? null,
              draftedPlayerId,
              draftedPlayerName,
            }];
          });
        const faabReceived = waiverBudget
          .filter((entry) => entry.receiver === rosterId && typeof entry.amount === "number")
          .reduce((total, entry) => total + (entry.amount ?? 0), 0);
        return {
          rosterId,
          ownerId,
          teamName: roster ? sleeperTeamName(roster, usersById) : `Team ${rosterId}`,
          isUserTeam: ownerId === SLEEPER_USER_ID,
          assets: { players: receivedPlayers, picks: receivedPicks, faabReceived },
        };
      });
      const created = createdMs;
      trades.set(transactionId, historicalTradeSchema.parse({
        id: transactionId,
        season,
        week: transaction.leg ?? round,
        createdAt: new Date(created).toISOString(),
        teams,
      }));
    }
  }
  return [...trades.values()].sort((a, b) => b.week - a.week || b.createdAt.localeCompare(a.createdAt));
}

const historicalDraftPickMapEntriesSchema = z.array(z.tuple([z.string(), z.string()]));
const kickerChainEntrySchema = z.object({
  ordinal: z.number().int(),
  round: z.number().int(),
  kickerDrafterRosterId: z.number().int(),
  rookiePickerRosterId: z.number().int(),
  rookiePlayerId: z.string(),
});
const historicalDraftPickMapCacheSchema = z.object({
  entries: historicalDraftPickMapEntriesSchema,
  placeholders: z.array(z.object({
    leagueId: z.string(),
    season: z.number().int(),
    cutoffMs: z.number(),
    maxRound: z.number().int(),
    kickerChain: z.array(kickerChainEntrySchema),
  })),
});

async function loadHistoricalDraftPickMap(
  ctx: Ctx,
  rootLeagueId: string,
  leagueChain: SleeperLeague[],
  forceRefresh: boolean,
): Promise<HistoricalDraftResolution> {
  const db = ctx.db<typeof schema>();
  const cacheKey = `historical-draft-pick-map:${rootLeagueId}`;
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && !forceRefresh) {
    try {
      const parsed = historicalDraftPickMapCacheSchema.parse(JSON.parse(cached.payload));
      return {
        byOriginalPick: new Map(parsed.entries),
        placeholderByLeagueId: new Map(parsed.placeholders.map((placeholder) => [
          placeholder.leagueId,
          {
            season: placeholder.season,
            cutoffMs: placeholder.cutoffMs,
            maxRound: placeholder.maxRound,
            kickerChain: placeholder.kickerChain,
          } satisfies PlaceholderDraftResolution,
        ])),
      };
    } catch {
      try {
        // Legacy cache entries predate the kicker-placeholder disambiguation.
        return {
          byOriginalPick: new Map(historicalDraftPickMapEntriesSchema.parse(JSON.parse(cached.payload))),
          placeholderByLeagueId: new Map(),
        };
      } catch {
        // Rebuild a malformed cache entry from Sleeper's immutable draft history.
      }
    }
  }

  const draftedPlayersByOriginalPick = new Map<string, string>();
  const placeholderByLeagueId = new Map<string, PlaceholderDraftResolution>();
  for (const league of leagueChain) {
    try {
      const [rosters, drafts] = await Promise.all([
        fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`),
        fetchJson<SleeperDraft[]>(`${SLEEPER_BASE}/league/${league.league_id}/drafts`),
      ]);
      const rosterIdByOwnerId = new Map(rosters.flatMap((roster) =>
        roster.owner_id ? [[roster.owner_id, roster.roster_id] as const] : [],
      ));
      const draftsWithPicks: Array<{ draft: SleeperDraft; picks: SleeperDraftPick[] }> = [];
      for (const draft of drafts) {
        if (!draft.draft_id) continue;
        try {
          let resolvedDraft = draft;
          try {
            const draftDetail = await fetchJson<SleeperDraft>(`${SLEEPER_BASE}/draft/${draft.draft_id}`);
            resolvedDraft = { ...draft, ...draftDetail };
          } catch {
            // The league draft list still provides the legacy draft_order fallback when detail is unavailable.
          }
          const picks = await fetchJson<SleeperDraftPick[]>(`${SLEEPER_BASE}/draft/${draft.draft_id}/picks`);
          draftsWithPicks.push({ draft: resolvedDraft, picks });
        } catch {
          // An unreadable draft should not prevent other drafts in this league from contributing.
        }
      }

      const rookiePlayerBySnakePick = new Map<string, Map<number, string>>();
      for (const snake of draftsWithPicks) {
        if (snake.draft.type !== "snake" || !snake.draft.draft_id) continue;
        const draftSeason = Number(snake.draft.season ?? league.season);
        if (!Number.isInteger(draftSeason)) continue;
        const kickerPicks = snake.picks
          .filter((pick) => pick.metadata?.position === "K")
          .sort((a, b) => Number(a.pick_no ?? 0) - Number(b.pick_no ?? 0));
        if (kickerPicks.length === 0) continue;
        const linear = draftsWithPicks.find((candidate) =>
          candidate.draft.type === "linear"
          && Number(candidate.draft.season ?? league.season) === draftSeason
          && candidate.picks.length === kickerPicks.length
        );
        if (!linear) continue;
        const linearPickByNumber = new Map<number, SleeperDraftPick>();
        for (const pick of [...linear.picks].sort((a, b) => Number(a.pick_no ?? 0) - Number(b.pick_no ?? 0))) {
          const pickNo = Number(pick.pick_no);
          if (Number.isInteger(pickNo)) linearPickByNumber.set(pickNo, pick);
        }
        const rookieBySnakePickNo = new Map<number, string>();
        kickerPicks.forEach((kickerPick, index) => {
          const snakePickNo = Number(kickerPick.pick_no);
          const rookiePick = linearPickByNumber.get(index + 1);
          const rookiePlayerId = rookiePick?.player_id ?? rookiePick?.metadata?.player_id;
          if (Number.isInteger(snakePickNo) && rookiePlayerId) {
            rookieBySnakePickNo.set(snakePickNo, rookiePlayerId);
          }
        });
        rookiePlayerBySnakePick.set(snake.draft.draft_id, rookieBySnakePickNo);

        // Post-startup trades of this season's picks are rookie picks, not the
        // startup's veterans. Build the kicker chain: for each kicker ordinal,
        // record who drafted the kicker and who picked the corresponding rookie.
        // Trades at/after the snake draft's last_picked resolve through this chain
        // by matching round and kicker drafter, excluding kickers that drafter kept;
        // earlier trades keep the startup semantics (with the kicker -> rookie
        // substitution already applied).
        const linearMaxRound = Math.max(
          0,
          ...linear.picks.map((pick) => Number(pick.round)).filter(Number.isInteger),
        );
        const picksPerRound = linearMaxRound > 0 ? kickerPicks.length / linearMaxRound : 0;
        if (linearMaxRound > 0 && Number.isInteger(picksPerRound) && picksPerRound > 0) {
          const kickerChain: KickerChainEntry[] = [];
          kickerPicks.forEach((kickerPick, index) => {
            const ordinal = index + 1;
            const round = Math.ceil(ordinal / picksPerRound);
            const kickerPickedBy = kickerPick.picked_by;
            const kickerDrafterRosterId = kickerPickedBy === null || kickerPickedBy === undefined
              ? undefined
              : rosterIdByOwnerId.get(String(kickerPickedBy));
            const rookiePick = linearPickByNumber.get(ordinal);
            const rookiePickedBy = rookiePick?.picked_by;
            const rookiePickerRosterId = rookiePickedBy === null || rookiePickedBy === undefined
              ? undefined
              : rosterIdByOwnerId.get(String(rookiePickedBy));
            const rookiePlayerId = rookiePick?.player_id ?? rookiePick?.metadata?.player_id;
            if (
              kickerDrafterRosterId !== undefined &&
              rookiePickerRosterId !== undefined &&
              rookiePlayerId &&
              round >= 1 && round <= linearMaxRound
            ) {
              kickerChain.push({
                ordinal,
                round,
                kickerDrafterRosterId,
                rookiePickerRosterId,
                rookiePlayerId,
              });
            }
          });
          const cutoffMs = Number(snake.draft.last_picked);
          if (Number.isFinite(cutoffMs) && cutoffMs > 0 && kickerChain.length > 0) {
            const existing = placeholderByLeagueId.get(league.league_id);
            if (!existing || cutoffMs > existing.cutoffMs) {
              placeholderByLeagueId.set(league.league_id, {
                season: draftSeason,
                cutoffMs,
                maxRound: linearMaxRound,
                kickerChain,
              });
            }
          }
        }
      }

      for (const { draft, picks } of draftsWithPicks) {
        const rosterIdByDraftSlot = new Map<number, number>();
        for (const [rawSlot, rawRosterId] of Object.entries(draft.slot_to_roster_id ?? {})) {
          if (rawSlot.trim() === "" || rawRosterId === null) continue;
          const slot = Number(rawSlot);
          const rosterId = Number(rawRosterId);
          if (Number.isInteger(slot) && Number.isInteger(rosterId)) {
            rosterIdByDraftSlot.set(slot, rosterId);
          }
        }
        if (rosterIdByDraftSlot.size === 0) {
          for (const [ownerId, rawSlot] of Object.entries(draft.draft_order ?? {})) {
            const slot = Number(rawSlot);
            const rosterId = rosterIdByOwnerId.get(ownerId);
            if (Number.isInteger(slot) && rosterId !== undefined) {
              rosterIdByDraftSlot.set(slot, rosterId);
            }
          }
        }
        const draftSeason = Number(draft.season ?? league.season);
        if (!Number.isInteger(draftSeason)) continue;
        const rookieBySnakePickNo = draft.draft_id ? rookiePlayerBySnakePick.get(draft.draft_id) : undefined;
        for (const pick of picks) {
          const round = Number(pick.round);
          const draftSlot = Number(pick.draft_slot);
          const pickedPlayerId = pick.player_id ?? pick.metadata?.player_id;
          const mappedRookiePlayerId = draft.type === "snake" && pick.metadata?.position === "K"
            ? rookieBySnakePickNo?.get(Number(pick.pick_no))
            : undefined;
          const playerId = mappedRookiePlayerId ?? pickedPlayerId;
          const originalRosterId = rosterIdByDraftSlot.get(draftSlot);
          if (!Number.isInteger(round) || originalRosterId === undefined || !playerId) continue;
          draftedPlayersByOriginalPick.set(`${draftSeason}:${round}:${originalRosterId}`, playerId);
        }
      }
    } catch {
      // A league without readable rosters or drafts should not block the rest of the chain.
    }
  }

  const fetchedAt = new Date();
  const payload = JSON.stringify({
    entries: [...draftedPlayersByOriginalPick.entries()],
    placeholders: [...placeholderByLeagueId.entries()].map(([leagueId, placeholder]) => ({
      leagueId,
      season: placeholder.season,
      cutoffMs: placeholder.cutoffMs,
      maxRound: placeholder.maxRound,
      kickerChain: placeholder.kickerChain,
    })),
  });
  await db.insert(schema.sourceCache).values({ cacheKey, payload, fetchedAt })
    .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload, fetchedAt } });
  return { byOriginalPick: draftedPlayersByOriginalPick, placeholderByLeagueId };
}

function parseHistoricalPlayerMap(payload: string): Record<string, SleeperPlayer> {
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Sleeper player cache is malformed.");
  }
  return parsed as Record<string, SleeperPlayer>;
}

async function loadHistoricalPlayerMap(ctx: Ctx, forceRefresh: boolean): Promise<Record<string, SleeperPlayer>> {
  const db = ctx.db<typeof schema>();
  const cachedRows = await db.select().from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, HISTORICAL_PLAYERS_CACHE_KEY))
    .limit(1);
  const cached = cachedRows[0];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt.getTime() < HISTORICAL_PLAYERS_CACHE_MS) {
    try {
      return parseHistoricalPlayerMap(cached.payload);
    } catch {
      // Replace malformed cached player metadata below.
    }
  }

  try {
    const fresh = await fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`);
    const fetchedAt = new Date();
    const payload = JSON.stringify(fresh);
    await db.insert(schema.sourceCache).values({ cacheKey: HISTORICAL_PLAYERS_CACHE_KEY, payload, fetchedAt })
      .onConflictDoUpdate({
        target: schema.sourceCache.cacheKey,
        set: { payload, fetchedAt },
      });
    return fresh;
  } catch (error) {
    if (cached) {
      try {
        return parseHistoricalPlayerMap(cached.payload);
      } catch {
        // Preserve the original Sleeper fetch failure when no usable cache exists.
      }
    }
    throw error;
  }
}

async function loadHistoricalTrades(
  ctx: Ctx,
  leagueId: string,
  forceRefresh: boolean,
  requestedSeason?: number,
): Promise<z.infer<typeof historicalTradesResponse>> {
  const db = ctx.db<typeof schema>();
  const sourceErrors: string[] = [];
  const currentLeague = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${leagueId}`);
  const dynasty = seasonLongFormatForLeague(currentLeague).isDynasty;
  const leagueChain: SleeperLeague[] = [];
  const seen = new Set<string>();
  let cursor: SleeperLeague | null = currentLeague;
  while (cursor && !seen.has(cursor.league_id) && leagueChain.length < 20) {
    leagueChain.push(cursor);
    seen.add(cursor.league_id);
    if (!dynasty) break;
    const previousId: string | null | undefined = cursor.previous_league_id;
    if (!previousId || previousId === "0") break;
    try {
      cursor = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${previousId}`);
    } catch {
      sourceErrors.push("An older Sleeper season could not be loaded.");
      break;
    }
  }

  const draftResolution = await loadHistoricalDraftPickMap(ctx, leagueId, leagueChain, forceRefresh);

  const currentSeason = Number(currentLeague.season ?? 0);
  const seasons = [...new Set(leagueChain
    .map((league) => Number(league.season ?? 0))
    .filter((season) => Number.isInteger(season) && season > 0))]
    .sort((a, b) => b - a);
  const requestedLeagues = requestedSeason === undefined
    ? leagueChain
    : leagueChain.filter((league) => Number(league.season ?? 0) === requestedSeason);
  let playerMap: Record<string, SleeperPlayer> | null = null;
  const collected: z.infer<typeof historicalTradeSchema>[] = [];
  let newestFetch = new Date(0);
  let isStale = false;

  for (const league of requestedLeagues) {
    const season = Number(league.season ?? 0);
    if (!Number.isInteger(season) || season <= 0) continue;
    const cacheId = `${league.league_id}:${season}`;
    const cachedRows = await db.select().from(schema.historicalTrades).where(eq(schema.historicalTrades.id, cacheId)).limit(1);
    const cached = cachedRows[0];
    const isCurrentSeason = season === currentSeason;
    const cachedIsFresh = cached ? !isCurrentSeason || Date.now() - cached.fetchedAt.getTime() < HISTORICAL_TRADES_CACHE_MS : false;
    if (cached && !forceRefresh && (!isCurrentSeason || cachedIsFresh)) {
      try {
        collected.push(...z.array(historicalTradeSchema).parse(JSON.parse(cached.payload)));
        if (cached.fetchedAt > newestFetch) newestFetch = cached.fetchedAt;
        if (isCurrentSeason && !cachedIsFresh) isStale = true;
        continue;
      } catch {
        // Malformed cache is replaced by a fresh Sleeper snapshot below.
      }
    }
    try {
      playerMap ??= await loadHistoricalPlayerMap(ctx, forceRefresh);
      const fresh = await fetchHistoricalSeason(league, playerMap, draftResolution);
      const fetchedAt = new Date();
      await db.insert(schema.historicalTrades).values({
        id: cacheId,
        rootLeagueId: leagueId,
        sleeperLeagueId: league.league_id,
        season,
        payload: JSON.stringify(fresh),
        fetchedAt,
      }).onConflictDoUpdate({
        target: schema.historicalTrades.id,
        set: { rootLeagueId: leagueId, payload: JSON.stringify(fresh), fetchedAt },
      });
      collected.push(...fresh);
      if (fetchedAt > newestFetch) newestFetch = fetchedAt;
    } catch {
      if (cached) {
        try {
          collected.push(...z.array(historicalTradeSchema).parse(JSON.parse(cached.payload)));
          if (cached.fetchedAt > newestFetch) newestFetch = cached.fetchedAt;
          isStale = true;
          sourceErrors.push(`${season} could not refresh; showing the saved trade history.`);
          continue;
        } catch { /* Honest season-level empty state below. */ }
      }
      sourceErrors.push(`${season} trade history is temporarily unavailable.`);
    }
  }

  return historicalTradesResponse.parse({
    trades: collected.sort((a, b) => b.season - a.season || b.week - a.week || b.createdAt.localeCompare(a.createdAt)),
    seasons,
    asOf: (newestFetch.getTime() > 0 ? newestFetch : new Date()).toISOString(),
    isStale,
    sourceErrors,
  });
}

type SavedViewOwnerScope = {
  source: "owner" | "local" | "cloudflare";
  key: string;
  canClaimLegacy: boolean;
};

function savedViewOwnerScope(ctx: Ctx): SavedViewOwnerScope | null {
  const viewer = ctx.viewer;
  if (!viewer) return null;
  if (viewer.isOwner) {
    return { source: "owner", key: `owner:${ctx.slug}`, canClaimLegacy: true };
  }
  return viewer.source === "local"
    ? { source: "local", key: viewer.userId, canClaimLegacy: false }
    : { source: "cloudflare", key: viewer.viewerFbid, canClaimLegacy: false };
}

function savedViewOwnerFilter(scope: SavedViewOwnerScope) {
  const owned = and(
    eq(schema.savedChartViews.ownerSource, scope.source),
    eq(schema.savedChartViews.ownerKey, scope.key),
  );
  return scope.canClaimLegacy
    ? or(owned, and(isNull(schema.savedChartViews.ownerSource), isNull(schema.savedChartViews.ownerKey)))
    : owned;
}

function serializeSavedChartView(row: typeof schema.savedChartViews.$inferSelect): z.infer<typeof savedChartViewSchema> {
  return {
    id: row.id,
    name: row.name,
    dataset: row.dataset,
    position: row.position,
    xMetric: row.xMetric,
    yMetric: row.yMetric,
    window: row.window,
    showQuadrants: row.showQuadrants,
    xPercentile: row.xPercentile,
    yPercentile: row.yPercentile,
    plotLimit: row.plotLimit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const Actions = {
  getHistoricalTrades: defineAction({
    request: z.object({
      leagueId: z.string().min(1),
      refresh: z.boolean().optional().default(false),
      season: z.number().int().positive().optional(),
    }),
    response: historicalTradesResponse,
    async handler(ctx, args): Promise<z.infer<typeof historicalTradesResponse>> {
      return await loadHistoricalTrades(ctx, args.leagueId, args.refresh, args.season);
    },
  }),

  listSavedChartViews: defineAction({
    request: z.object({}),
    response: savedChartViewsResponse,
    async handler(ctx): Promise<z.infer<typeof savedChartViewsResponse>> {
      const scope = savedViewOwnerScope(ctx);
      if (!scope) return { views: [] };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.savedChartViews)
        .where(savedViewOwnerFilter(scope))
        .orderBy(asc(schema.savedChartViews.createdAt));
      return { views: rows.map(serializeSavedChartView) };
    },
  }),

  saveChartView: defineAction({
    request: savedChartViewInputSchema,
    response: saveChartViewResponse,
    async handler(ctx, args): Promise<z.infer<typeof saveChartViewResponse>> {
      const scope = savedViewOwnerScope(ctx);
      if (!scope) throw new Error("Saved views require an authenticated viewer.");
      const db = ctx.db<typeof schema>();
      const name = args.name.trim();
      const matches = await db.select().from(schema.savedChartViews).where(and(
        savedViewOwnerFilter(scope),
        eq(schema.savedChartViews.dataset, args.dataset),
        eq(schema.savedChartViews.name, name),
      )).limit(1);
      const existing = matches[0];
      const now = new Date();
      const id = existing?.id ?? crypto.randomUUID();
      const createdAt = existing?.createdAt ?? now;
      const values = {
        id,
        ownerSource: scope.source,
        ownerKey: scope.key,
        name,
        dataset: args.dataset,
        position: args.position,
        xMetric: args.xMetric,
        yMetric: args.yMetric,
        window: args.window,
        showQuadrants: args.showQuadrants,
        xPercentile: args.xPercentile,
        yPercentile: args.yPercentile,
        plotLimit: args.plotLimit,
        createdAt,
        updatedAt: now,
      };
      await db.insert(schema.savedChartViews).values(values).onConflictDoUpdate({
        target: schema.savedChartViews.id,
        set: {
          ownerSource: scope.source,
          ownerKey: scope.key,
          name,
          dataset: args.dataset,
          position: args.position,
          xMetric: args.xMetric,
          yMetric: args.yMetric,
          window: args.window,
          showQuadrants: args.showQuadrants,
          xPercentile: args.xPercentile,
          yPercentile: args.yPercentile,
          plotLimit: args.plotLimit,
          updatedAt: now,
        },
      });
      ctx.invalidateQueries();
      return { view: serializeSavedChartView(values) };
    },
  }),

  deleteChartView: defineAction({
    request: z.object({ id: z.string().min(1) }),
    response: deleteChartViewResponse,
    async handler(ctx, args): Promise<z.infer<typeof deleteChartViewResponse>> {
      const scope = savedViewOwnerScope(ctx);
      if (!scope) throw new Error("Saved views require an authenticated viewer.");
      const db = ctx.db<typeof schema>();
      const rowFilter = and(eq(schema.savedChartViews.id, args.id), savedViewOwnerFilter(scope));
      const rows = await db.select({ id: schema.savedChartViews.id }).from(schema.savedChartViews).where(rowFilter).limit(1);
      const deleted = Boolean(rows[0]);
      if (deleted) {
        await db.delete(schema.savedChartViews).where(rowFilter);
        ctx.invalidateQueries();
      }
      return { ok: true, deleted };
    },
  }),

  ingeststagedprojections: defineAction({
    request: z.object({}),
    response: ingestStagedProjectionsResponse,
    privileged: [Privileged.readStagedProjections],
    async handler(ctx): Promise<z.infer<typeof ingestStagedProjectionsResponse>> {
      const stagedFile = await ctx.executePrivileged(Privileged.readStagedProjections, {});
      const payload = vegasProjectionPayloadSchema.parse(JSON.parse(stagedFile.json));
      const db = ctx.db<typeof schema>();
      const snapshotId = `${payload.season}:${payload.week}`;
      const builtAt = new Date(payload.built_at);
      const currentRows = await db.select()
        .from(schema.vegasProjectionSnapshots)
        .where(eq(schema.vegasProjectionSnapshots.id, snapshotId))
        .limit(1);
      const current = currentRows[0];

      if (current && current.builtAt.getTime() > builtAt.getTime()) {
        return {
          ok: true,
          status: "ignored",
          season: payload.season,
          week: payload.week,
          savedProjections: 0,
        };
      }

      if (!current || current.builtAt.getTime() < builtAt.getTime()) {
        const storedAt = new Date();
        await db.insert(schema.vegasProjectionSnapshots).values({
          id: snapshotId,
          season: payload.season,
          week: payload.week,
          builtAt,
          source: payload.source,
          payload: JSON.stringify(payload),
          storedAt,
        }).onConflictDoUpdate({
          target: schema.vegasProjectionSnapshots.id,
          set: {
            builtAt,
            source: payload.source,
            payload: JSON.stringify(payload),
            storedAt,
          },
        });
        await db.update(schema.sourceCache).set({ fetchedAt: new Date(0) }).where(eq(schema.sourceCache.cacheKey, CACHE_KEY));
        ctx.invalidateQueries();
      }

      return {
        ok: true,
        status: "committed",
        season: payload.season,
        week: payload.week,
        savedProjections: payload.projections.length,
      };
    },
  }),

  ingeststagedmatchupgrades: defineAction({
    request: z.object({}),
    response: ingestStagedMatchupGradesResponse,
    privileged: [Privileged.readStagedMatchupGrades],
    async handler(ctx): Promise<z.infer<typeof ingestStagedMatchupGradesResponse>> {
      const stagedFile = await ctx.executePrivileged(Privileged.readStagedMatchupGrades, {});
      const payload = stagedMatchupGradesSchema.parse(JSON.parse(stagedFile.json));
      const db = ctx.db<typeof schema>();
      let committed = 0;
      for (const league of payload.leagues) {
        const cacheKey = `${STRENGTH_OF_SCHEDULE_CACHE_PREFIX}:${league.league_id}`;
        const entry = strengthOfScheduleEntrySchema.parse({
          leagueId: league.league_id,
          season: payload.season,
          throughWeek: league.through_week,
          computedAt: league.computed_at,
          table: league.table,
        });
        const existingRows = await db.select().from(schema.sourceCache)
          .where(eq(schema.sourceCache.cacheKey, cacheKey))
          .limit(1);
        const existing = existingRows[0];
        if (existing) {
          try {
            const parsed = JSON.parse(existing.payload) as { computedAt?: string };
            if (parsed.computedAt && new Date(parsed.computedAt).getTime() >= new Date(league.computed_at).getTime()) {
              continue; // a newer or equal build is already stored
            }
          } catch { /* fall through to commit */ }
        }
        const fetchedAt = new Date(league.computed_at);
        await db.insert(schema.sourceCache).values({ cacheKey, payload: JSON.stringify(entry), fetchedAt })
          .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(entry), fetchedAt } });
        committed += 1;
      }
      const status = committed > 0 ? "committed" as const : "ignored" as const;
      if (status === "committed") {
        await db.update(schema.sourceCache).set({ fetchedAt: new Date(0) }).where(eq(schema.sourceCache.cacheKey, CACHE_KEY));
        ctx.invalidateQueries();
      }
      return { ok: true, status, season: payload.season, throughWeek: payload.through_week, leagues: committed };
    },
  }),

  ingeststagedpfntables: defineAction({
    request: z.object({}),
    response: ingestStagedPfnTablesResponse,
    privileged: [Privileged.readStagedPfnTables],
    async handler(ctx): Promise<z.infer<typeof ingestStagedPfnTablesResponse>> {
      let stagedFile: { json: string };
      try {
        stagedFile = await ctx.executePrivileged(Privileged.readStagedPfnTables, {});
      } catch {
        return { ok: false, error: "staged PFN file not found" };
      }

      const payload = stagedPfnTablesSchema.parse(JSON.parse(stagedFile.json));
      const db = ctx.db<typeof schema>();
      const fetchedAt = new Date(payload.fetched_at);
      for (const tableKey of pfnTableKeys) {
        const table = payload.tables[tableKey];
        const stored = {
          fetched_at: payload.fetched_at,
          label: table.label,
          columns: table.columns,
          column_labels: table.column_labels,
          rows: table.rows,
        };
        const cacheKey = `pfn:${tableKey}`;
        await db.insert(schema.sourceCache).values({
          cacheKey,
          payload: JSON.stringify(stored),
          fetchedAt,
        }).onConflictDoUpdate({
          target: schema.sourceCache.cacheKey,
          set: { payload: JSON.stringify(stored), fetchedAt },
        });
      }
      ctx.invalidateQueries();
      return { ok: true, status: "committed", fetched_at: payload.fetched_at, tables: [...pfnTableKeys] };
    },
  }),

  getpfntables: defineAction({
    request: z.object({}),
    response: getPfnTablesResponse,
    async handler(ctx): Promise<z.infer<typeof getPfnTablesResponse>> {
      const keys = pfnTableKeys.map((tableKey) => `pfn:${tableKey}`);
      const rows = await ctx.db<typeof schema>().select().from(schema.sourceCache)
        .where(inArray(schema.sourceCache.cacheKey, keys));
      const tables: z.infer<typeof getPfnTablesResponse>["tables"] = {
        "offensive-line": null,
        offense: null,
        defense: null,
        "team-overall": null,
      };

      for (const row of rows) {
        const tableKey = row.cacheKey.slice(4);
        const parsedKey = pfnTableKeySchema.safeParse(tableKey);
        if (!parsedKey.success) continue;
        try {
          const envelope = storedPfnTableEnvelopeSchema.safeParse(JSON.parse(row.payload));
          if (!envelope.success) continue;
          const validRows = envelope.data.rows.flatMap((candidate) => {
            const parsedRow = pfnRowSchema.safeParse(candidate);
            return parsedRow.success ? [parsedRow.data] : [];
          }).sort((a, b) => a.rank - b.rank);
          tables[parsedKey.data] = {
            fetched_at: envelope.data.fetched_at,
            label: envelope.data.label,
            columns: envelope.data.columns,
            column_labels: envelope.data.column_labels,
            rows: validRows,
          };
        } catch { /* skip malformed cached tables */ }
      }
      return { tables, teamSituational: await loadTeamSituationalSnapshot(ctx) };
    },
  }),

  getMatchupBoxScore: defineAction({
    request: z.object({
      team: z.string().trim().min(2).max(3),
      opponent: z.string().trim().min(2).max(3),
      season: z.number().int().min(2020).max(2100),
      week: z.number().int().min(1).max(25),
    }),
    response: matchupBoxScoreResponse,
    async handler(ctx, args): Promise<z.infer<typeof matchupBoxScoreResponse>> {
      if (ctx.viewer && !ctx.viewer.isOwner) return { status: "owner_required", game: null };
      try {
        const team = canonicalTeam(args.team.toUpperCase());
        const opponent = canonicalTeam(args.opponent.toUpperCase());
        const result = await ctx.tool.sports_data(`NFL ${team} vs ${opponent} ${args.season} week ${args.week} score`, { timeout_secs: 12 });
        const item = result.content.items.find((candidate) => {
          const codes = new Set([
            ...sportsTeamCodes(candidate.home),
            ...sportsTeamCodes(candidate.away),
            ...(candidate.teams ?? []).flatMap((value) => sportsTeamCodes(value)),
            ...sportsTeamCodes(candidate.title),
          ]);
          return codes.has(team) && codes.has(opponent);
        });
        if (!item) return { status: "unavailable", game: null };

        const state = item.status?.trim() || null;
        const normalizedState = state?.toLowerCase().replaceAll(" ", "_") ?? "";
        const isFinal = ["closed", "complete", "completed", "final", "post_game"].includes(normalizedState);
        const source = item.url
          ? result.content.sources.find((candidate) => candidate.url === item.url) ?? null
          : null;
        const game = {
          title: item.title,
          score: item.score?.trim() ?? "",
          state,
          startsAt: item.starts_at ?? null,
          home: item.home ?? null,
          away: item.away ?? null,
          sourceLabel: source?.title ?? null,
          sourceUrl: item.url ?? null,
          fetchedAt: new Date().toISOString(),
        };
        if (!isFinal || !game.score) return { status: "not_final", game };
        return { status: "available", game };
      } catch {
        return { status: "unavailable", game: null };
      }
    },
  }),

  setVegasProjections: defineAction({
    request: vegasProjectionPayloadSchema,
    response: setVegasProjectionsResponse,
    async handler(ctx, args): Promise<z.infer<typeof setVegasProjectionsResponse>> {
      const db = ctx.db<typeof schema>();
      const snapshotId = `${args.season}:${args.week}`;
      const builtAt = new Date(args.built_at);
      const storedAt = new Date();
      await db.insert(schema.vegasProjectionSnapshots).values({
        id: snapshotId,
        season: args.season,
        week: args.week,
        builtAt,
        source: args.source,
        payload: JSON.stringify(args),
        storedAt,
      }).onConflictDoUpdate({
        target: schema.vegasProjectionSnapshots.id,
        set: {
          builtAt,
          source: args.source,
          payload: JSON.stringify(args),
          storedAt,
        },
      });
      await db.update(schema.sourceCache).set({ fetchedAt: new Date(0) }).where(eq(schema.sourceCache.cacheKey, CACHE_KEY));
      ctx.invalidateQueries();
      return { ok: true, season: args.season, week: args.week, savedProjections: args.projections.length };
    },
  }),

  setVegasProjectionsChunk: defineAction({
    request: vegasProjectionChunkPayloadSchema,
    response: setVegasProjectionsChunkResponse,
    async handler(ctx, args): Promise<z.infer<typeof setVegasProjectionsChunkResponse>> {
      const db = ctx.db<typeof schema>();
      const builtAt = new Date(args.built_at);
      const builtAtMs = builtAt.getTime();
      const snapshotId = `${args.season}:${args.week}`;
      const uploadKey = `${snapshotId}:${args.built_at}`;
      const leaguesPayload = JSON.stringify(args.leagues);

      const currentRows = await db.select()
        .from(schema.vegasProjectionSnapshots)
        .where(eq(schema.vegasProjectionSnapshots.id, snapshotId))
        .limit(1);
      const current = currentRows[0];
      if (current && current.builtAt.getTime() >= builtAtMs) {
        let savedProjections = 0;
        if (current.builtAt.getTime() === builtAtMs) {
          try {
            savedProjections = vegasProjectionPayloadSchema.parse(JSON.parse(current.payload)).projections.length;
          } catch {
            savedProjections = 0;
          }
        }
        return {
          ok: true,
          status: current.builtAt.getTime() === builtAtMs ? "committed" : "ignored",
          season: args.season,
          week: args.week,
          receivedChunks: current.builtAt.getTime() === builtAtMs ? args.chunk_count : 0,
          chunkCount: args.chunk_count,
          savedProjections,
          message: current.builtAt.getTime() === builtAtMs
            ? "This projection build is already committed."
            : "A newer projection build is already committed for this week.",
        };
      }

      const pendingRows = await db.select()
        .from(schema.vegasProjectionUploadChunks)
        .where(and(
          eq(schema.vegasProjectionUploadChunks.season, args.season),
          eq(schema.vegasProjectionUploadChunks.week, args.week),
        ));
      const newerPending = pendingRows.find((row) => row.builtAt.getTime() > builtAtMs);
      if (newerPending) {
        return {
          ok: true,
          status: "ignored",
          season: args.season,
          week: args.week,
          receivedChunks: 0,
          chunkCount: args.chunk_count,
          savedProjections: 0,
          message: "A newer projection build is already being uploaded for this week.",
        };
      }

      const uploadRows = pendingRows.filter((row) => row.uploadKey === uploadKey);
      const metadataMatches = uploadRows.every((row) => (
        row.source === args.source
        && row.leaguesPayload === leaguesPayload
        && row.chunkCount === args.chunk_count
        && row.builtAt.getTime() === builtAtMs
      ));
      if (!metadataMatches) {
        return {
          ok: false,
          status: "rejected",
          season: args.season,
          week: args.week,
          receivedChunks: uploadRows.length,
          chunkCount: args.chunk_count,
          savedProjections: 0,
          message: "Chunk metadata does not match the other chunks in this upload.",
        };
      }

      const storedAt = new Date();
      await db.batch([
        db.insert(schema.vegasProjectionUploadChunks).values({
          id: `${uploadKey}:${args.chunk_index}`,
          uploadKey,
          season: args.season,
          week: args.week,
          builtAt,
          source: args.source,
          leaguesPayload,
          chunkIndex: args.chunk_index,
          chunkCount: args.chunk_count,
          projectionsPayload: JSON.stringify(args.projections),
          storedAt,
        }).onConflictDoUpdate({
          target: schema.vegasProjectionUploadChunks.id,
          set: {
            source: args.source,
            leaguesPayload,
            chunkCount: args.chunk_count,
            projectionsPayload: JSON.stringify(args.projections),
            storedAt,
          },
        }),
        db.delete(schema.vegasProjectionUploadChunks).where(and(
          eq(schema.vegasProjectionUploadChunks.season, args.season),
          eq(schema.vegasProjectionUploadChunks.week, args.week),
          lte(schema.vegasProjectionUploadChunks.builtAt, new Date(builtAtMs - 1)),
        )),
      ]);

      const receivedRows = await db.select()
        .from(schema.vegasProjectionUploadChunks)
        .where(eq(schema.vegasProjectionUploadChunks.uploadKey, uploadKey))
        .orderBy(asc(schema.vegasProjectionUploadChunks.chunkIndex));
      const uniqueChunks = new Map(receivedRows.map((row) => [row.chunkIndex, row]));
      const hasEveryChunk = uniqueChunks.size === args.chunk_count
        && Array.from({ length: args.chunk_count }, (_value, index) => uniqueChunks.has(index)).every(Boolean);
      if (!hasEveryChunk) {
        return {
          ok: true,
          status: "buffered",
          season: args.season,
          week: args.week,
          receivedChunks: uniqueChunks.size,
          chunkCount: args.chunk_count,
          savedProjections: 0,
          message: null,
        };
      }

      const projections: z.infer<typeof vegasPlayerProjectionSchema>[] = [];
      for (let index = 0; index < args.chunk_count; index += 1) {
        const row = uniqueChunks.get(index);
        if (!row) continue;
        const parsed = z.array(vegasPlayerProjectionSchema).parse(JSON.parse(row.projectionsPayload));
        projections.push(...parsed);
      }
      const completePayload = vegasProjectionPayloadSchema.parse({
        season: args.season,
        week: args.week,
        built_at: args.built_at,
        source: args.source,
        leagues: args.leagues,
        projections,
      });
      const payload = JSON.stringify(completePayload);

      await db.batch([
        db.insert(schema.vegasProjectionSnapshots).values({
          id: snapshotId,
          season: args.season,
          week: args.week,
          builtAt,
          source: args.source,
          payload,
          storedAt,
        }).onConflictDoUpdate({
          target: schema.vegasProjectionSnapshots.id,
          set: { builtAt, source: args.source, payload, storedAt },
          setWhere: lte(schema.vegasProjectionSnapshots.builtAt, builtAt),
        }),
        db.delete(schema.vegasProjectionUploadChunks).where(and(
          eq(schema.vegasProjectionUploadChunks.season, args.season),
          eq(schema.vegasProjectionUploadChunks.week, args.week),
          lte(schema.vegasProjectionUploadChunks.builtAt, builtAt),
        )),
        db.update(schema.sourceCache)
          .set({ fetchedAt: new Date(0) })
          .where(eq(schema.sourceCache.cacheKey, CACHE_KEY)),
      ]);

      const committedRows = await db.select()
        .from(schema.vegasProjectionSnapshots)
        .where(eq(schema.vegasProjectionSnapshots.id, snapshotId))
        .limit(1);
      const committed = committedRows[0];
      const didCommit = committed?.builtAt.getTime() === builtAtMs;
      if (didCommit) ctx.invalidateQueries();
      return {
        ok: true,
        status: didCommit ? "committed" : "ignored",
        season: args.season,
        week: args.week,
        receivedChunks: args.chunk_count,
        chunkCount: args.chunk_count,
        savedProjections: didCommit ? completePayload.projections.length : 0,
        message: didCommit ? null : "A newer projection build was committed before this upload completed.",
      };
    },
  }),

  getCachedDashboard: defineAction({
    request: z.object({}),
    response: z.object({ dashboard: dashboardResponse.nullable() }),
    async handler(ctx): Promise<{ dashboard: Dashboard | null }> {
      return { dashboard: await getCached(ctx) };
    },
  }),

  getDashboardSection: defineAction({
    request: z.object({ section: z.enum(["meta", "team", "players", "league", "analytics"]) }),
    response: dashboardSectionResponse,
    async handler(ctx, args): Promise<z.infer<typeof dashboardSectionResponse>> {
      // Each view reads a deliberately small projection of the last complete
      // snapshot. These calls are independent, so a slow live refresh never
      // blocks the saved Team, Players, League, or analytics section.
      const cached = await getCached(ctx);
      if (args.section === "meta") {
        return { section: "meta", data: cached ? {
          status: cached.status,
          season: cached.season,
          week: cached.week,
          asOf: cached.asOf,
          rankingsAsOf: cached.rankingsAsOf,
          fantasyCalcAsOf: cached.fantasyCalcAsOf,
          sourceErrors: cached.sourceErrors,
          leagues: cached.leagues.map(({ id, name, scoringLabel, rankingField, rosteredPlayerIds, rosterAssignments, rankingPositions, showSuperFilter, seasonLongFormat, tradeValuation }) => ({ id, name, scoringLabel, rankingField, rosteredPlayerIds, rosterAssignments, rankingPositions, showSuperFilter, seasonLongFormat, tradeValuation })),
        } : null };
      }
      if (args.section === "team") {
        return { section: "team", data: cached ? { leagues: cached.leagues.map(({ id, record, teamActual, teamProjection, starters, bench, opponentTeam, suggestion, tradeTeams, tradeWaiverPool, tradeStarterSlots }) => ({ id, record, teamActual, teamProjection, starters, bench, opponentTeam, suggestion, tradeTeams, tradeWaiverPool, tradeStarterSlots })) } : null };
      }
      if (args.section === "players") {
        return { section: "players", data: cached ? { rankings: cached.rankings, weeklyChartRankings: cached.weeklyChartRankings, seasonLongRankings: cached.seasonLongRankings, defenses: cached.defenses, strengthOfSchedule: cached.strengthOfSchedule ?? [] } : null };
      }
      if (args.section === "league") {
        return { section: "league", data: cached ? { leagues: cached.leagues.map(({ id, powerRankingsWeek, powerRankingsSeasonLong, powerRankingsDynasty }) => ({ id, powerRankingsWeek, powerRankingsSeasonLong, powerRankingsDynasty })) } : null };
      }
      return { section: "analytics", data: cached ? { analytics: cached.analytics } : null };
    },
  }),

  getDashboard: defineAction({
    request: z.object({ force: z.boolean().default(false) }),
    response: dashboardResponse,
    async handler(ctx, args): Promise<Dashboard> {
      const db = ctx.db<typeof schema>();
      const cached = await getCached(ctx);
      if (!args.force) {
        // Opening the artifact is a snapshot-only operation. Rendering never
        // starts source work or merges projection feeds.
        return cached ?? {
          status: "partial",
          season: new Date().getUTCFullYear(),
          week: 0,
          asOf: new Date().toISOString(),
          rankingsAsOf: null,
          fantasyCalcAsOf: null,
          leagues: [],
          rankings: [],
          weeklyChartRankings: [],
          seasonLongRankings: [],
          defenses: [],
          analytics: { asOf: null, throughWeek: null, sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL, entities: [], teamUsage: [], teamRecords: [] },
          strengthOfSchedule: [],
          sourceErrors: ["No saved dashboard snapshot is available yet."],
        };
      }
      try {
        // A forced refresh powers both the manual refresh button and the daily
        // schedule. Never let a slow upstream hold the action past the worker's
        // 120-second request ceiling; fall back to the last complete snapshot.
        const fresh = await withDeadline(buildDashboard(ctx, args.force), REFRESH_TIMEOUT_MS);
        if (fresh.leagues.length === 0) throw new Error("Sleeper league data was incomplete");
        const fetchedAt = new Date();
        const payload = JSON.stringify(fresh);
        await db.insert(schema.sourceCache).values({ cacheKey: CACHE_KEY, payload, fetchedAt })
          .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload, fetchedAt } });
        await saveFantasyCalcSnapshot(ctx, fresh);
        return fresh;
      } catch {
        const cached = await getCached(ctx);
        if (cached) {
          return { ...cached, status: "partial", sourceErrors: [...new Set([...cached.sourceErrors, "Refresh failed; showing the last saved snapshot."])] };
        }
        return {
          status: "partial",
          season: new Date().getUTCFullYear(),
          week: 0,
          asOf: new Date().toISOString(),
          rankingsAsOf: null,
          fantasyCalcAsOf: null,
          leagues: [],
          rankings: [],
          weeklyChartRankings: [],
          seasonLongRankings: [],
          defenses: [],
          analytics: { asOf: null, throughWeek: null, sourceUrl: NFLVERSE_PLAYER_STATS_2026_URL, entities: [], teamUsage: [], teamRecords: [] },
          strengthOfSchedule: [],
          sourceErrors: ["Fantasy data is temporarily unavailable."],
        };
      }
    },
  }),

  getDraftCenter: defineAction({
    request: z.object({ force: z.boolean().default(false) }),
    response: draftCenterResponse,
    async handler(ctx, args): Promise<DraftCenter> {
      const errors: string[] = [];
      const [leaguesResult, playersResult] = await Promise.allSettled([
        fetchJson<SleeperLeague[]>(`${SLEEPER_BASE}/user/${SLEEPER_USER_ID}/leagues/nfl/2026`),
        fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`),
      ]);
      const leagues = leaguesResult.status === "fulfilled" ? leaguesResult.value : [];
      const players = playersResult.status === "fulfilled" ? playersResult.value : {};
      if (leaguesResult.status === "rejected") errors.push("Sleeper league formats are temporarily unavailable.");
      if (playersResult.status === "rejected") errors.push("Sleeper player data is temporarily unavailable.");
      const market = await loadDraftMarketSnapshot(ctx, args.force, leagues, players);
      let drafts: z.infer<typeof liveDraftSchema>[] = [];
      try {
        drafts = await withDeadline(fetchLiveDrafts(players), 20_000);
      } catch {
        errors.push("Sleeper draft rooms are temporarily unavailable.");
      }
      return draftCenterResponse.parse({
        asOf: new Date().toISOString(),
        ...market,
        drafts,
        boardModes: draftBoardModesForLeagues(leagues),
        sourceErrors: [...new Set([...market.sourceErrors, ...errors])],
      });
    },
  }),

  getBoomBustRanges: defineAction({
    request: z.object({
      leagueId: z.string().min(1).max(80),
      position: z.enum(["QB", "RB", "WR", "TE"]),
      playerIds: z.array(z.string().min(1).max(80)).min(1).max(24),
    }),
    response: boomBustRangesResponse,
    async handler(ctx, args): Promise<z.infer<typeof boomBustRangesResponse>> {
      const db = ctx.db<typeof schema>();
      const leagueSettingsCacheKey = `sleeper-league-settings-v1:${args.leagueId}`;
      const cachedRows = await db.select().from(schema.sourceCache)
        .where(eq(schema.sourceCache.cacheKey, leagueSettingsCacheKey))
        .limit(1);
      const cached = cachedRows[0];
      let scoringSettings: Record<string, number> | undefined;
      if (cached && Date.now() - cached.fetchedAt.getTime() < 24 * 60 * 60 * 1000) {
        try {
          const parsed: unknown = JSON.parse(cached.payload);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) scoringSettings = parsed as Record<string, number>;
        } catch {
          // A malformed cache entry is treated as a miss.
        }
      }
      if (!scoringSettings) {
        const league = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${args.leagueId}`);
        if (league.league_id !== args.leagueId) return { rows: [], unavailablePlayerIds: args.playerIds };
        scoringSettings = league.scoring_settings ?? {};
        await db.insert(schema.sourceCache).values({ cacheKey: leagueSettingsCacheKey, payload: JSON.stringify(scoringSettings), fetchedAt: new Date() })
          .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(scoringSettings), fetchedAt: new Date() } });
      }
      const uniquePlayerIds = [...new Set(args.playerIds)];
      const results = await Promise.allSettled(uniquePlayerIds.map(async (playerId) => {
        const rows = await loadSleeperPlayerWeeklySeason(ctx, playerId, 2026);
        const points = rows.flatMap((row) => {
          const week = Number(row.week);
          if (!Number.isInteger(week) || week < 1 || week > 18 || !hasSleeperGameParticipation(row)) return [];
          return [scoreProjectedPlayerStats(args.position, sleeperActualStats(row), scoringSettings)];
        });
        if (points.length < 2) return null;
        const floor = Math.min(...points);
        const ceiling = Math.max(...points);
        return { playerId, floor, ceiling, range: Number((ceiling - floor).toFixed(2)), games: points.length };
      }));
      const rows = results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
      const returned = new Set(rows.map((row) => row.playerId));
      return { rows, unavailablePlayerIds: uniquePlayerIds.filter((playerId) => !returned.has(playerId)) };
    },
  }),

  getBoomBustHistory: defineAction({
    request: z.object({
      leagueId: z.string().min(1).max(80),
      playerId: z.string().min(1).max(80),
      position: z.enum(["QB", "RB", "WR", "TE"]),
      view: z.enum(["season", "last3"]),
    }),
    response: boomBustHistoryResponse,
    async handler(ctx, args): Promise<z.infer<typeof boomBustHistoryResponse>> {
      const unavailable = (): z.infer<typeof boomBustHistoryResponse> => ({
        ...buildBoomBustSeries([], "unavailable"),
        view: args.view,
        season: 2026,
        leagueId: args.leagueId,
        playerId: args.playerId,
        gameLog: [],
        seasonTotals: {},
        coverageNote: null,
      });
      try {
        const db = ctx.db<typeof schema>();
        const leagueSettingsCacheKey = `sleeper-league-settings-v1:${args.leagueId}`;
        const leagueSettingsRows = await db.select().from(schema.sourceCache)
          .where(eq(schema.sourceCache.cacheKey, leagueSettingsCacheKey))
          .limit(1);
        const cachedLeagueSettings = leagueSettingsRows[0];
        let scoringSettings: Record<string, number> | undefined;
        if (cachedLeagueSettings && Date.now() - cachedLeagueSettings.fetchedAt.getTime() < 24 * 60 * 60 * 1000) {
          try {
            const parsed: unknown = JSON.parse(cachedLeagueSettings.payload);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) scoringSettings = parsed as Record<string, number>;
          } catch {
            // A malformed cache entry is treated as a miss and replaced below.
          }
        }
        if (!scoringSettings) {
          const league = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${args.leagueId}`);
          if (league.league_id !== args.leagueId) throw new Error("League response did not match");
          scoringSettings = league.scoring_settings ?? {};
          await db.insert(schema.sourceCache).values({ cacheKey: leagueSettingsCacheKey, payload: JSON.stringify(scoringSettings), fetchedAt: new Date() })
            .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(scoringSettings), fetchedAt: new Date() } });
        }
        const seasons: readonly number[] = args.view === "season" ? [2026] : BOOM_BUST_SEASONS;
        const results = await Promise.allSettled(seasons.map(async (season) => ({
          season,
          rows: await loadSleeperPlayerWeeklySeason(ctx, args.playerId, season),
        })));
        const unavailableSeasons: number[] = [];
        const games: Array<{
          season: number;
          week: number;
          opponent: string | null;
          team: string | null;
          points: number;
          stats: Record<string, number>;
        }> = [];
        for (const [index, result] of results.entries()) {
          const season = seasons[index];
          if (season === undefined) continue;
          if (result.status === "rejected") {
            unavailableSeasons.push(season);
            continue;
          }
          for (const row of result.value.rows) {
            const week = Number(row.week);
            if (!Number.isInteger(week) || week < 1 || week > 18 || !hasSleeperGameParticipation(row)) continue;
            const opponentValue = row.opponent ?? row.opp;
            const teamValue = row.team;
            games.push({
              season,
              week,
              opponent: typeof opponentValue === "string" && opponentValue ? canonicalTeam(opponentValue) : null,
              team: typeof teamValue === "string" && teamValue ? canonicalTeam(teamValue) : null,
              points: scoreProjectedPlayerStats(args.position, sleeperActualStats(row), scoringSettings),
              stats: sleeperGameLogStats(args.position, row),
            });
          }
        }
        const loadedSeasonCount = seasons.length - unavailableSeasons.length;
        if (loadedSeasonCount === 0) return unavailable();
        const dedupedGames = [...new Map(games.map((game) => [`${game.season}-${game.week}`, game])).values()];
        let coverageNote: string | null = null;
        if (args.view === "last3" && unavailableSeasons.length > 0) {
          coverageNote = "Some Sleeper seasons could not be loaded, so the last 3 years may be incomplete.";
        }
        const gameLog = dedupedGames.filter((game) => game.season === 2026);
        const seasonTotals = gameLog.reduce<Record<string, number>>((totals, game) => {
          totals.fantasyPoints = Number(((totals.fantasyPoints ?? 0) + game.points).toFixed(2));
          for (const [key, value] of Object.entries(game.stats)) {
            totals[key] = Number(((totals[key] ?? 0) + value).toFixed(2));
          }
          return totals;
        }, {});
        return {
          ...buildBoomBustSeries(dedupedGames, "ok"),
          view: args.view,
          season: 2026,
          leagueId: args.leagueId,
          playerId: args.playerId,
          gameLog,
          seasonTotals,
          coverageNote,
        };
      } catch {
        return unavailable();
      }
    },
  }),

  getValueHistory: defineAction({
    request: z.object({
      formatKey: z.string().min(1),
      playerIds: z.array(z.string().min(1)).max(24),
    }),
    response: valueHistoryResponse,
    async handler(ctx, args): Promise<z.infer<typeof valueHistoryResponse>> {
      if (args.playerIds.length === 0) return { series: [] };
      const db = ctx.db<typeof schema>();
      const yesterdayDate = new Date();
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      yesterdayDate.setUTCHours(0, 0, 0, 0);
      const yesterday = yesterdayDate.toISOString().slice(0, 10);
      const latestSnapshotRows = await db
        .select({ playerId: schema.playerValueSnapshots.playerId, snapshotDate: schema.playerValueSnapshots.snapshotDate })
        .from(schema.playerValueSnapshots)
        .where(and(eq(schema.playerValueSnapshots.formatKey, args.formatKey), inArray(schema.playerValueSnapshots.playerId, args.playerIds)))
        .orderBy(desc(schema.playerValueSnapshots.snapshotDate));
      const latestSnapshotByPlayer = new Map<string, string>();
      for (const row of latestSnapshotRows) {
        if (!latestSnapshotByPlayer.has(row.playerId)) latestSnapshotByPlayer.set(row.playerId, row.snapshotDate);
      }
      const hasFreshSnapshots = args.playerIds.every((playerId) => (latestSnapshotByPlayer.get(playerId) ?? "") >= yesterday);
      const preset = FANTASY_CALC_PRESETS.find(({ format }) => format.key === args.formatKey);
      if (preset && !hasFreshSnapshots) {
        try {
          const currentRows = await fetchJson<FantasyCalcRow[]>(preset.url);
          const selected = currentRows.filter((row) => row.player?.sleeperId && args.playerIds.includes(row.player.sleeperId) && typeof row.player.id === "number");
          const historyResults = await Promise.allSettled(selected.map(async (row) => {
            const playerId = row.player?.sleeperId;
            const fantasyCalcId = row.player?.id;
            if (!playerId || typeof fantasyCalcId !== "number") return [];
            const query = new URLSearchParams({
              isDynasty: String(preset.format.isDynasty),
              numQbs: String(preset.format.numQbs),
              numTeams: String(preset.format.numTeams),
              ppr: String(preset.format.ppr),
            });
            const history = await fetchJson<FantasyCalcHistoryResponse>(`${FANTASY_CALC_HISTORY_URL}/${fantasyCalcId}?${query.toString()}`);
            const cutoff = new Date();
            cutoff.setUTCDate(cutoff.getUTCDate() - 29);
            cutoff.setUTCHours(0, 0, 0, 0);
            return (history.historicalValues ?? []).flatMap((point) => {
              if (typeof point.date !== "string" || typeof point.value !== "number") return [];
              const [month = 0, day = 0, year = 0] = point.date.split("/").map(Number);
              const date = new Date(Date.UTC(year, month - 1, day));
              if (!year || !month || !day || Number.isNaN(date.getTime()) || date < cutoff) return [];
              const snapshotDate = date.toISOString().slice(0, 10);
              return [{
                id: `${snapshotDate}:${args.formatKey}:${playerId}`,
                snapshotDate,
                formatKey: args.formatKey,
                playerId,
                playerName: row.player?.name ?? playerId,
                position: row.player?.position ?? "",
                value: Math.round(point.value),
                capturedAt: date,
              }];
            });
          }));
          const backfillRows = historyResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
          for (let index = 0; index < backfillRows.length; index += 250) {
            const chunk = backfillRows.slice(index, index + 250);
            if (chunk.length) await db.insert(schema.playerValueSnapshots).values(chunk).onConflictDoNothing();
          }
        } catch {
          // Stored daily snapshots still provide an honest partial history.
        }
      }
      const rows = await db
        .select()
        .from(schema.playerValueSnapshots)
        .where(and(eq(schema.playerValueSnapshots.formatKey, args.formatKey), inArray(schema.playerValueSnapshots.playerId, args.playerIds)))
        .orderBy(asc(schema.playerValueSnapshots.snapshotDate));
      const cutoffDate = new Date();
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 29);
      cutoffDate.setUTCHours(0, 0, 0, 0);
      const cutoff = cutoffDate.toISOString().slice(0, 10);
      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        if (row.snapshotDate < cutoff) continue;
        const group = grouped.get(row.playerId) ?? [];
        group.push(row);
        grouped.set(row.playerId, group);
      }
      return {
        series: args.playerIds.flatMap((playerId) => {
          const history = grouped.get(playerId);
          if (!history?.length) return [];
          const latest = history[history.length - 1];
          if (!latest) return [];
          return [{
            playerId,
            name: latest.playerName,
            position: latest.position,
            points: history.map((row) => ({ date: row.snapshotDate, value: row.value })),
          }];
        }),
      };
    },
  }),

  getPlayerNews: defineAction({
    request: z.object({}),
    response: playerNewsResponse,
    async handler(ctx): Promise<z.infer<typeof playerNewsResponse>> {
      const db = ctx.db<typeof schema>();
      const [runs, items, checkedRows] = await Promise.all([
        db.select().from(schema.playerNewsRuns).orderBy(desc(schema.playerNewsRuns.checkedAt)).limit(60),
        db.select().from(schema.playerNewsItems),
        db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_CHECK_KEY)).limit(1),
      ]);
      const itemGroups = new Map<string, typeof items>();
      for (const item of items) {
        const group = itemGroups.get(item.runId) ?? [];
        group.push(item);
        itemGroups.set(item.runId, group);
      }
      const populatedRuns = runs.flatMap((run) => {
        const runItems = itemGroups.get(run.id) ?? [];
        if (runItems.length === 0) return [];
        return [{
          id: run.id,
          checkedAt: run.checkedAt.toISOString(),
          items: runItems.map((item) => ({
            id: item.id,
            playerId: item.playerId,
            player: item.player,
            team: item.team,
            change: item.change,
            leagueIds: JSON.parse(item.leaguesJson) as string[],
            newsType: item.newsType,
            leagues: (JSON.parse(item.leaguesJson) as string[]).flatMap((leagueId) => {
              const league = PLAYER_NEWS_LEAGUES.find((candidate) => candidate.id === leagueId);
              return league ? [league.name] : [];
            }),
            availability: parseNewsAvailability(item.availabilityJson),
            roleContext: item.roleContext,
            sourceLabel: item.sourceLabel,
            sourceUrl: item.sourceUrl,
            sourcePublishedAt: item.sourcePublishedAt?.toISOString() ?? null,
          })),
        }];
      }).slice(0, 20);
      return {
        lastCheckedAt: checkedRows[0]?.fetchedAt.toISOString() ?? null,
        runs: populatedRuns,
      };
    },
  }),

  refreshPlayerNews: defineAction({
    request: z.object({}),
    response: refreshPlayerNewsResponse,
    async handler(ctx): Promise<z.infer<typeof refreshPlayerNewsResponse>> {
      if (ctx.viewer && !ctx.viewer.isOwner) {
        return { started: false, taskId: null, message: "Only the owner can start a live player-news check." };
      }
      let context: Awaited<ReturnType<typeof buildPlayerNewsRosterContext>>;
      try {
        context = await withDeadline(buildPlayerNewsRosterContext(), REFRESH_TIMEOUT_MS);
      } catch {
        return { started: false, taskId: null, message: "Sleeper rosters are temporarily unavailable." };
      }
      if (!context.active) {
        return { started: false, taskId: null, message: "Player-news checks are paused outside the 2026 regular season." };
      }
      const db = ctx.db<typeof schema>();
      const priorRows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, PLAYER_NEWS_SNAPSHOT_KEY)).limit(1);
      const previous = parseInjurySnapshot(priorRows[0]?.payload);
      const current = Object.fromEntries(context.players.map((player) => [player.playerId, player.injuryStatus]));
      const changes = context.players.flatMap((player) => {
        if (!(player.playerId in previous) || previous[player.playerId] === player.injuryStatus) return [];
        return [{
          playerId: player.playerId,
          player: player.player,
          team: player.team,
          from: previous[player.playerId] ?? "No designation",
          to: player.injuryStatus ?? "No designation",
          leagues: player.leagues,
        }];
      });
      const checkedAt = new Date();
      const runKey = `player-news-${checkedAt.toISOString()}`;
      const assignment = [
        `Research the latest material NFL player news across the entire league for the 2026 season, Week ${context.week}. Do not filter, prioritize, or limit coverage based on the user's fantasy rosters.`,
        "Use live public web search and source pages from the last 24 hours. Include only developments with a meaningful fantasy impact: injuries or status changes, trades, suspensions, signings or releases, depth-chart changes, coach comments that materially change a role, and clearly reported usage or performance developments that materially change rest-of-season value.",
        "Exclude trivial updates, generic sleeper lists, speculation, routine practice notes without a meaningful status or role change, ordinary box-score recaps, and players without a concrete new catalyst. Scan league-wide rather than starting from or stopping at the supplied roster map.",
        "For each player-specific material item, provide the exact Sleeper player ID when known; if it is unavailable, pass the player's full name in playerId and the save action will resolve it against Sleeper. Also provide the player name, current team, a concise description of what changed, and one concise line of role/usage context. Use a specific usage fact such as target share, snap rate, routes, carries, or backfield split only when a reliable source reports it. Never invent a metric.",
        "Set newsType to headline and leagueIds to an empty array for every league-wide player-news item, including news about a player who happens to be on the user's roster. Use playerId league, player League headline, and team NFL only for a truly multi-player or league-level development that cannot be assigned to one player. Use newsType waiver only for a concrete pickup opportunity created by a new injury, benching, trade, suspension, depth-chart change, or clearly reported role expansion; pass leagueIds as an empty array so the save action can calculate availability across all six leagues. Do not set newsType to roster in this league-wide roundup.",
        "Provide one exact public HTTPS source URL and a short source label for each item. Include the source publication time as an ISO instant only when the source makes it available; otherwise use null.",
        "Call the required save action even when there are no material items, passing an empty items array in that case. Do not send a chat message.",
        `Use runKey ${JSON.stringify(runKey)} and checkedAt ${JSON.stringify(checkedAt.toISOString())}.`,
        `Pass injurySnapshot exactly as ${JSON.stringify(current)} so the save action advances injury state only after this roundup is stored successfully.`,
        `Roster injury-status changes supplied only as supplemental signals, not as a coverage boundary: ${JSON.stringify(changes)}.`,
        `Current roster map supplied only for context and never as a filter or priority list: ${JSON.stringify(context.players)}.`,
      ].join("\n\n");
      const task = await ctx.agent.spawnTask(assignment, {
        expectsAction: "savePlayerNewsRoundup",
        dedupeKey: runKey,
      });
      if (!task.ok) return { started: false, taskId: null, message: "The news check could not be started." };
      return { started: true, taskId: task.taskId, message: "Checking material player news across the league now." };
    },
  }),

  savePlayerNewsRoundup: defineAction({
    request: z.object({
      runKey: z.string().min(1).max(160),
      checkedAt: z.string().datetime(),
      injurySnapshot: playerNewsInjurySnapshotSchema,
      items: z.array(playerNewsItemInputSchema).max(30),
    }),
    response: savePlayerNewsResponse,
    async handler(ctx, args): Promise<z.infer<typeof savePlayerNewsResponse>> {
      const db = ctx.db<typeof schema>();
      const knownLeagueIds = new Set<string>(PLAYER_NEWS_LEAGUES.map((league) => league.id));
      const checkedAt = new Date(args.checkedAt);
      let sleeperPlayers: Record<string, SleeperPlayer> | null = null;
      const sleeperPlayersByName = new Map<string, Array<{ id: string; team: string | null }>>();
      try {
        sleeperPlayers = await fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`);
        for (const [id, player] of Object.entries(sleeperPlayers)) {
          const fullName = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
          if (!fullName) continue;
          const key = normalizedPlayerName(fullName);
          const matches = sleeperPlayersByName.get(key) ?? [];
          matches.push({ id, team: player.team ?? null });
          sleeperPlayersByName.set(key, matches);
        }
      } catch {
        // Fail open: a temporary validation-source failure must not discard news.
      }
      const candidates = args.items.flatMap((item) => {
        let playerId = item.playerId;
        const isLeagueHeadline = item.newsType === "headline" && item.playerId.toLowerCase() === "league";
        if (!isLeagueHeadline && sleeperPlayers && !sleeperPlayers[playerId]) {
          const matches = sleeperPlayersByName.get(normalizedPlayerName(item.player))
            ?? sleeperPlayersByName.get(normalizedPlayerName(item.playerId))
            ?? [];
          const team = canonicalTeam(item.team.toUpperCase());
          const teamMatch = matches.find((match) => match.team && canonicalTeam(match.team) === team);
          const resolved = teamMatch ?? (matches.length === 1 ? matches[0] : undefined);
          if (!resolved) return [];
          playerId = resolved.id;
        }
        const leagueIds = [...new Set(item.leagueIds.filter((leagueId) => knownLeagueIds.has(leagueId)))];
        if (item.newsType === "roster" && leagueIds.length === 0) return [];
        return [{ ...item, playerId, leagueIds }];
      });
      const availabilityByPlayer = await buildPlayerNewsAvailability(candidates.filter((item) => item.newsType === "waiver").map((item) => item.playerId));
      const validItems = candidates.flatMap((item) => {
        const availability = item.newsType === "waiver" ? (availabilityByPlayer.get(item.playerId) ?? []) : [];
        if (item.newsType === "waiver" && !availability.some((entry) => entry.status === "available")) return [];
        return [{ ...item, availability }];
      });
      await db.insert(schema.playerNewsRuns).values({ id: args.runKey, checkedAt, itemCount: validItems.length })
        .onConflictDoUpdate({ target: schema.playerNewsRuns.id, set: { checkedAt, itemCount: validItems.length } });
      if (validItems.length > 0) {
        const futureTimestampCutoff = Date.now() + 10 * 60 * 1000;
        await db.insert(schema.playerNewsItems).values(validItems.map((item, index) => ({
          id: `${args.runKey}:${index}:${item.playerId}`,
          runId: args.runKey,
          playerId: item.playerId,
          player: item.player,
          team: item.team,
          change: item.change,
          leaguesJson: JSON.stringify(item.leagueIds),
          newsType: item.newsType,
          availabilityJson: item.newsType === "waiver" ? JSON.stringify(item.availability) : null,
          roleContext: item.roleContext,
          sourceLabel: item.sourceLabel,
          sourceUrl: item.sourceUrl,
          sourcePublishedAt: item.sourcePublishedAt && new Date(item.sourcePublishedAt).getTime() <= futureTimestampCutoff
            ? new Date(item.sourcePublishedAt)
            : null,
        }))).onConflictDoNothing();
      }
      await db.insert(schema.sourceCache).values({ cacheKey: PLAYER_NEWS_SNAPSHOT_KEY, payload: JSON.stringify(args.injurySnapshot), fetchedAt: checkedAt })
        .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(args.injurySnapshot), fetchedAt: checkedAt } });
      await db.insert(schema.sourceCache).values({ cacheKey: PLAYER_NEWS_CHECK_KEY, payload: JSON.stringify({ itemCount: validItems.length }), fetchedAt: checkedAt })
        .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify({ itemCount: validItems.length }), fetchedAt: checkedAt } });
      ctx.invalidateQueries();
      return { ok: true, savedItems: validItems.length };
    },
  }),
} satisfies ActionsModule;
