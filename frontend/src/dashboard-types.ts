import { api, type ApiResponse } from "./api";

export type Dashboard = ApiResponse<typeof api, "getDashboard">;
export type League = Dashboard["leagues"][number];
export type RosterPlayer = League["starters"][number];
export type Tab =
  | "team"
  | "rankings"
  | "waivers"
  | "power"
  | "draft"
  | "trade"
  | "charts"
  | "comparison"
  | "strengthOfSchedule";
export type PlayerLink = {
  linkedPlayerId: string | null;
  onOpenLinkedPlayer: (playerId: string) => void;
  onCloseLinkedPlayer: () => void;
  onLinkedPlayerMiss: () => void;
  onLinkedPlayerFound: () => void;
};
export type PrimaryPage = "team" | "players" | "league" | "draft" | "tools";
export type PlayerNews = ApiResponse<typeof api, "getPlayerNews">;
export type DraftCenterData = ApiResponse<typeof api, "getDraftCenter">;
export type DashboardSection = ApiResponse<typeof api, "getDashboardSection">;
export type MetaSection = Extract<DashboardSection, { section: "meta" }>;
export type TeamSection = Extract<DashboardSection, { section: "team" }>;
export type PlayersSection = Extract<DashboardSection, { section: "players" }>;
export type LeagueSection = Extract<DashboardSection, { section: "league" }>;
export type AnalyticsSection = Extract<DashboardSection, { section: "analytics" }>;
export type PlayerNewsItem = PlayerNews["runs"][number]["items"][number];
export type ValueHistorySeries = ApiResponse<typeof api, "getValueHistory">["series"][number];
export type HistoricalTrades = ApiResponse<typeof api, "getHistoricalTrades">;
export type HistoricalTrade = HistoricalTrades["trades"][number];
export type HistoricalTradeTeam = HistoricalTrade["teams"][number];
export type BoomBustHistory = ApiResponse<typeof api, "getBoomBustHistory">;
export type PfnTables = ApiResponse<typeof api, "getPfnTables">["tables"];
export type PfnTable = NonNullable<PfnTables[keyof PfnTables]>;
export type PfnRow = PfnTable["rows"][number];
export type TeamSituational = NonNullable<ApiResponse<typeof api, "getPfnTables">["teamSituational"]>;
export type TeamSituationalRow = TeamSituational["rows"][number];
export type BasePosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
export type BoomBustPosition = Extract<BasePosition, "QB" | "RB" | "WR" | "TE">;
export type PositionFilter = BasePosition | "ALL" | "FLEX" | "SUPER" | "ROOKIES";
export type TradeAsset = Dashboard["seasonLongRankings"][number];
export type PlayerSearchResult = {
  key: string;
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  opponent: string | null;
  isAway: boolean | null;
  isBye: boolean;
  injuryStatus: string | null;
  weeklyRank: number | null;
  weeklyProjection: number | null;
  projectionSource?: "vegas" | "first_down" | "fallback" | "sleeper" | null;
  seasonRank: number | null;
  seasonValue: number | null;
  movement30Day: number | null;
  isRostered: boolean;
  gamePhase?: "pregame" | "live" | "final" | null;
  defenseComponents?: Dashboard["defenses"][number]["components"];
  projectionComponents?: Dashboard["rankings"][number]["projectionComponents"];
  waiverTrends?: {
    adds: { rank: number; count: number } | null;
    drops: { rank: number; count: number } | null;
  };
};
export type PlayerDetailTab = "overview" | "season" | "advanced";
export type AnalyticsEntity = Dashboard["analytics"]["entities"][number];
export type DetailMetric = {
  key: string;
  label: string;
  unit?: string;
  digits?: number;
  derived?: (values: Record<string, number>) => number | null;
};
export type ValuationMode = "market" | "league";
export type TradeTeam = League["tradeTeams"][number];
export type OptimizedRoster = {
  starters: RosterPlayer[];
  bench: RosterPlayer[];
  score: number;
};
export type ProjectionComponent = { key: string; label: string; value: number; isYards: boolean };
export type MatchupSelection = {
  team: string;
  opponent: string;
  isAway: boolean | null;
  gamePhase: "pregame" | "live" | "final" | null;
};
export type PfnContextStat = {
  label: string;
  value: number;
  rank: number | null;
  suffix?: string;
};
export type MatchupGrade = { value: number | null; rank: number | null };
export type MatchupStatConfig = {
  label: string;
  offKey: string;
  defKey: string;
  format: (value: number) => string;
  offHigher: boolean;
  defHigher: boolean;
};
export type TeamCardSelection = {
  team: string;
};
export type TeamUsage = Dashboard["analytics"]["teamUsage"][number];
export type NflTeamRecord = Dashboard["analytics"]["teamRecords"][number];
