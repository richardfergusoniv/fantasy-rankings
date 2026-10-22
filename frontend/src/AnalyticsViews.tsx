import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayerNameLink } from "./tool-links";
import type { PlayerLinkResolver } from "./tool-player-link";
import { CartesianGrid, Customized, Line, LineChart, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, chartTooltipStyle } from "@/components/ui/chart";
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type ApiResponse } from "./api";
import type { MatchupSelection } from "./dashboard-types";
import {
  SAVED_CHART_VIEWS_QUERY_KEY,
  applySavedChartViewMutation,
  optimisticRemoveSavedChartView,
  optimisticUpsertSavedChartView,
  rollbackSavedChartViewMutation,
  settleSavedChartViewMutation,
} from "./chart-view-cache";
import { formatCompactCount, formatDecimal } from "./lib/format-number";
import { ChartDialog } from "./chart-dialog";
import { MatchupTag, SegmentedControl, shortLeagueName, type StrengthOfScheduleEntryLike } from "./shared";
import { scatterAxisDomain } from "./scatter-zoom";
import { shouldWarnBeforeLeave, useUnsavedLeaveWarning } from "./unsaved-input";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type League = Dashboard["leagues"][number];
type BasePosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
type ToolDataset = "advanced" | "projections";
type PlotLimit = "24" | "40" | "all";
type SavedChartView = ApiResponse<typeof api, "listSavedChartViews">["views"][number];
type SavedChartConfig = Pick<SavedChartView, "dataset" | "position" | "xMetric" | "yMetric" | "window" | "showQuadrants" | "xPercentile" | "yPercentile" | "plotLimit">;
type PfnTables = ApiResponse<typeof api, "getPfnTables">["tables"];
type AnalyticsEntity = Dashboard["analytics"]["entities"][number];
type AnalyticsWindow = "season" | "rolling17";
type Metric = { key: string; label: string; short: string; unit?: string; lowerIsBetter?: boolean; sourceKey?: string };
type WeeklyEntity = {
  id: string; playerId: string; name: string; team: string; position: BasePosition; opponent: string | null; isAway: boolean | null; isBye: boolean; gameTime: string | null; gamePhase: MatchupSelection["gamePhase"]; values: Record<string, number>;
};
type PlayerSelection = { playerId?: string; name: string; team: string; position: BasePosition };
/** A player the Analytics tool was asked to focus (from a link): the scatter opens on their position with them selected. */
export type AnalyticsFocusPlayer = { id: string; name: string; team: string | null; position: string };
type ChartDatum = {
  id: string; name: string; label: string; team: string; games: number; x: number; y: number; isSelectedTeam: boolean;
  /** Set where the data source knows them; lets the focused-player link find the player card. */
  playerId?: string | null; position?: string;
};
type ChartAxis = { scale?: unknown };
type ChartOffset = { left?: number; top?: number; width?: number; height?: number };
type LabelBox = { left: number; top: number; width: number; height: number };
type LabelPlacement = LabelBox & { datum: ChartDatum; textX: number; textY: number; anchor: "start" | "middle" | "end" };
type AdaptiveChartLabelsProps = {
  data: ChartDatum[];
  leaderIds: ReadonlySet<string>;
  selectedTeamIds: ReadonlySet<string>;
  highlightedId?: string | null;
  xAxisMap?: Record<string, ChartAxis>;
  yAxisMap?: Record<string, ChartAxis>;
  offset?: ChartOffset;
};
const basePositionOrder: BasePosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const analyticsMetrics: Record<BasePosition, Metric[]> = {
  QB: [
    { key: "fantasy_league", label: "League fantasy points", short: "League pts", sourceKey: "fantasy_ppr" },
    { key: "passing_yards", label: "Passing yards", short: "Pass yds" },
    { key: "pass_attempts", label: "Pass attempts", short: "Att" },
    { key: "completions", label: "Completions", short: "Comp" },
    { key: "completion_pct", label: "Completion rate", short: "Comp %", unit: "%" },
    { key: "passing_tds", label: "Passing touchdowns", short: "Pass TD" },
    { key: "interceptions", label: "Interceptions", short: "INT", lowerIsBetter: true },
    { key: "passing_air_yards", label: "Passing air yards", short: "Air yds" },
    { key: "passing_epa", label: "Passing EPA", short: "Pass EPA" },
    { key: "epa_per_play", label: "EPA per play", short: "EPA/play" },
    { key: "carries", label: "Carries", short: "Carries" },
    { key: "rushing_yards", label: "Rushing yards", short: "Rush yds" },
    { key: "rushing_tds", label: "Rushing touchdowns", short: "Rush TD" },
    { key: "cpoe", label: "Completion % over expected", short: "CPOE", unit: "%" },
    { key: "opportunity", label: "Opportunity", short: "Opp" },
    { key: "opportunity_share", label: "Opportunity share", short: "Opp %", unit: "%" },
    { key: "snap_share", label: "Snap share", short: "Snap %", unit: "%" },
    { key: "rz_target_share", label: "Red-zone target share", short: "RZ tgt %", unit: "%" },
    { key: "rz_carry_share", label: "Red-zone carry share", short: "RZ carry %", unit: "%" },
  ],
  RB: [
    { key: "fantasy_league", label: "League fantasy points", short: "League pts", sourceKey: "fantasy_ppr" },
    { key: "touches", label: "Touches", short: "Touches" },
    { key: "carries", label: "Carries", short: "Carries" },
    { key: "rushing_yards", label: "Rushing yards", short: "Rush yds" },
    { key: "rushing_tds", label: "Rushing touchdowns", short: "Rush TD" },
    { key: "targets", label: "Targets", short: "Targets" },
    { key: "receptions", label: "Receptions", short: "Rec" },
    { key: "receiving_yards", label: "Receiving yards", short: "Rec yds" },
    { key: "receiving_tds", label: "Receiving touchdowns", short: "Rec TD" },
    { key: "scrimmage_yards", label: "Scrimmage yards", short: "Scrim yds" },
    { key: "target_share", label: "Target share", short: "Target %", unit: "%" },
    { key: "rushing_epa", label: "Rushing EPA", short: "Rush EPA" },
    { key: "receiving_epa", label: "Receiving EPA", short: "Rec EPA" },
    { key: "opportunity", label: "Opportunity", short: "Opp" },
    { key: "opportunity_share", label: "Opportunity share", short: "Opp %", unit: "%" },
    { key: "carry_share", label: "Carry share", short: "Carry %", unit: "%" },
    { key: "rb_target_share", label: "RB target share", short: "RB tgt %", unit: "%" },
    { key: "snap_share", label: "Snap share", short: "Snap %", unit: "%" },
    { key: "rz_target_share", label: "Red-zone target share", short: "RZ tgt %", unit: "%" },
    { key: "rz_carry_share", label: "Red-zone carry share", short: "RZ carry %", unit: "%" },
  ],
  WR: [
    { key: "fantasy_league", label: "League fantasy points", short: "League pts", sourceKey: "fantasy_ppr" },
    { key: "targets", label: "Targets", short: "Targets" },
    { key: "receptions", label: "Receptions", short: "Rec" },
    { key: "receiving_yards", label: "Receiving yards", short: "Rec yds" },
    { key: "receiving_air_yards", label: "Receiving air yards", short: "Air yds" },
    { key: "receiving_tds", label: "Receiving touchdowns", short: "Rec TD" },
    { key: "yards_after_catch", label: "Yards after catch", short: "YAC" },
    { key: "target_share", label: "Target share", short: "Target %", unit: "%" },
    { key: "air_yards_share", label: "Air-yards share", short: "Air %", unit: "%" },
    { key: "wopr", label: "Weighted opportunity rating", short: "WOPR" },
    { key: "racr", label: "Receiver air conversion ratio", short: "RACR" },
    { key: "receiving_epa", label: "Receiving EPA", short: "Rec EPA" },
    { key: "opportunity", label: "Opportunity", short: "Opp" },
    { key: "opportunity_share", label: "Opportunity share", short: "Opp %", unit: "%" },
    { key: "snap_share", label: "Snap share", short: "Snap %", unit: "%" },
    { key: "rz_target_share", label: "Red-zone target share", short: "RZ tgt %", unit: "%" },
    { key: "rz_carry_share", label: "Red-zone carry share", short: "RZ carry %", unit: "%" },
  ],
  TE: [
    { key: "fantasy_league", label: "League fantasy points", short: "League pts", sourceKey: "fantasy_ppr" },
    { key: "targets", label: "Targets", short: "Targets" },
    { key: "receptions", label: "Receptions", short: "Rec" },
    { key: "receiving_yards", label: "Receiving yards", short: "Rec yds" },
    { key: "receiving_air_yards", label: "Receiving air yards", short: "Air yds" },
    { key: "receiving_tds", label: "Receiving touchdowns", short: "Rec TD" },
    { key: "yards_after_catch", label: "Yards after catch", short: "YAC" },
    { key: "target_share", label: "Target share", short: "Target %", unit: "%" },
    { key: "air_yards_share", label: "Air-yards share", short: "Air %", unit: "%" },
    { key: "wopr", label: "Weighted opportunity rating", short: "WOPR" },
    { key: "racr", label: "Receiver air conversion ratio", short: "RACR" },
    { key: "receiving_epa", label: "Receiving EPA", short: "Rec EPA" },
    { key: "opportunity", label: "Opportunity", short: "Opp" },
    { key: "opportunity_share", label: "Opportunity share", short: "Opp %", unit: "%" },
    { key: "snap_share", label: "Snap share", short: "Snap %", unit: "%" },
    { key: "rz_target_share", label: "Red-zone target share", short: "RZ tgt %", unit: "%" },
    { key: "rz_carry_share", label: "Red-zone carry share", short: "RZ carry %", unit: "%" },
  ],
  K: [
    { key: "fg_attempts", label: "Field-goal attempts", short: "FG att" },
    { key: "fg_made", label: "Field goals made", short: "FG made" },
    { key: "fg_pct", label: "Field-goal rate", short: "FG %", unit: "%" },
    { key: "fg_40_plus", label: "Field goals made from 40+", short: "40+ FG" },
    { key: "fg_50_plus", label: "Field goals made from 50+", short: "50+ FG" },
    { key: "pat_attempts", label: "Extra-point attempts", short: "PAT att" },
    { key: "pat_made", label: "Extra points made", short: "PAT made" },
    { key: "kicks_made", label: "Total kicks made", short: "Kicks" },
  ],
  DEF: [
    { key: "qb_hits", label: "Quarterback hits", short: "QB hits" },
    { key: "takeaways", label: "Takeaways", short: "Takeaways" },
    { key: "sacks", label: "Sacks", short: "Sacks" },
    { key: "interceptions", label: "Interceptions", short: "INT" },
    { key: "forced_fumbles", label: "Forced fumbles", short: "FF" },
    { key: "fumble_recoveries", label: "Fumble recoveries", short: "FR" },
    { key: "tackles_for_loss", label: "Tackles for loss", short: "TFL" },
    { key: "passes_defended", label: "Passes defended", short: "PD" },
    { key: "defensive_tds", label: "Defensive touchdowns", short: "DEF TD" },
    { key: "blocked_kicks", label: "Blocked kicks", short: "Blocks" },
    { key: "safeties", label: "Safeties", short: "Safeties" },
  ],
};

function analyticsMetricsForLeague(position: BasePosition, league: League): Metric[] {
  const leagueFantasySource = league.rankingField === "ppr" ? "fantasy_ppr" : "fantasy_half_ppr";
  return analyticsMetrics[position].map((metric) => metric.key === "fantasy_league"
    ? {
      ...metric,
      label: `${league.scoringLabel} fantasy points`,
      short: league.rankingField === "ppr" ? "PPR pts" : "Half-PPR pts",
      sourceKey: leagueFantasySource,
    }
    : metric);
}

function metricSourceValue(values: Record<string, number>, metric: Metric): number | undefined {
  return values[metric.sourceKey ?? metric.key];
}

type ChartKind = "scatter" | "snap-trend" | "heatmap" | "team-scatter";

type ChartPreset = {
  label: string;
  x: string;
  y: string;
  kind?: ChartKind;
  research?: { source: string; sourceUrl: string; insight: string };
};

const sharedSkillPresets: ChartPreset[] = [
  { label: "Usage vs Production", x: "opportunity", y: "fantasy_league" },
  { label: "Snap share", x: "snap_week", y: "snap_share", kind: "snap-trend" },
  { label: "Red-zone share", x: "rz_target_share", y: "rz_carry_share" },
  { label: "FPA heatmap", x: "fpa_team", y: "fpa_position", kind: "heatmap" },
  { label: "Pace x PROE", x: "plays_per_game", y: "proe", kind: "team-scatter" },
];

const analyticsPresets: Record<BasePosition, ChartPreset[]> = {
  QB: [
    { label: "Volume vs efficiency", x: "pass_attempts", y: "passing_epa" },
    {
      label: "Talent ceiling · EPA/play × CPOE",
      x: "epa_per_play",
      y: "cpoe",
      research: {
        source: "TJ Hernandez · 4for4",
        sourceUrl: "https://www.4for4.com/2026/preseason/most-predictable-quarterback-stats",
        insight: "Pairs play-level efficiency with accuracy over expectation to surface quarterbacks with the strongest passing ceiling.",
      },
    },
    { label: "Accuracy over expected", x: "completion_pct", y: "cpoe" },
    {
      label: "Konami rushing ceiling",
      x: "carries",
      y: "fantasy_league",
      research: {
        source: "Rich Hribar · Fantasy Points",
        sourceUrl: "https://fantasypoints.com/nfl/articles/season/2021/quarterback-draft-predictability",
        insight: "Uses rushing volume against league-scored fantasy output to reveal the dual-threat ceiling behind the Konami Code framework.",
      },
    },
    ...sharedSkillPresets,
  ],
  RB: [
    { label: "Workhorse profile", x: "touches", y: "fantasy_league" },
    { label: "Receiving leverage", x: "target_share", y: "receiving_epa" },
    { label: "Ground production", x: "carries", y: "rushing_yards" },
    { label: "Backfield share", x: "carry_share", y: "rb_target_share" },
    ...sharedSkillPresets,
  ],
  WR: [
    { label: "Opportunity profile", x: "target_share", y: "air_yards_share" },
    {
      label: "WOPR buy-low / sell-high",
      x: "wopr",
      y: "fantasy_league",
      research: {
        source: "Josh Hermsmeyer · Action Network",
        sourceUrl: "https://www.actionnetwork.com/article/p/601206703",
        insight: "Compares role quality with league-scored production so high-opportunity underperformers stand out as regression candidates.",
      },
    },
    { label: "Air-yards conversion", x: "receiving_air_yards", y: "receiving_yards" },
    ...sharedSkillPresets,
  ],
  TE: [
    { label: "Opportunity profile", x: "target_share", y: "air_yards_share" },
    { label: "Weighted opportunity", x: "wopr", y: "fantasy_league" },
    { label: "Air-yards conversion", x: "receiving_air_yards", y: "receiving_yards" },
    ...sharedSkillPresets,
  ],
  K: [
    { label: "Conversion volume", x: "fg_attempts", y: "fg_made" },
    { label: "Distance upside", x: "fg_40_plus", y: "fg_50_plus" },
    { label: "FPA heatmap", x: "fpa_team", y: "fpa_position", kind: "heatmap" },
    { label: "Pace x PROE", x: "plays_per_game", y: "proe", kind: "team-scatter" },
  ],
  DEF: [
    { label: "Pressure to sacks", x: "qb_hits", y: "sacks" },
    { label: "Takeaway scoring", x: "takeaways", y: "defensive_tds" },
    { label: "Backfield disruption", x: "tackles_for_loss", y: "takeaways" },
    { label: "FPA heatmap", x: "fpa_team", y: "fpa_position", kind: "heatmap" },
    { label: "Pace x PROE", x: "plays_per_game", y: "proe", kind: "team-scatter" },
  ],
};

const defaultAnalyticsAxes: Record<BasePosition, [string, string]> = {
  QB: ["pass_attempts", "passing_epa"],
  RB: ["touches", "fantasy_league"],
  WR: ["target_share", "air_yards_share"],
  TE: ["target_share", "air_yards_share"],
  K: ["fg_attempts", "fg_made"],
  DEF: ["qb_hits", "sacks"],
};

const weeklyMetrics: Record<BasePosition, Metric[]> = {
  QB: [
    { key: "league", label: "League projection", short: "League proj" },
    { key: "ppr", label: "PPR projection", short: "PPR proj" },
    { key: "halfPpr", label: "Half-PPR projection", short: "Half proj" },
    { key: "standard", label: "Standard projection", short: "Std proj" },
    { key: "teamTotal", label: "Team implied points", short: "Team pts" },
    { key: "leaguePositionRank", label: "Weekly positional rank", short: "Pos rank", lowerIsBetter: true },
    { key: "vegasProjection", label: "Vegas projection", short: "Vegas" },
    { key: "sleeperProjection", label: "Sleeper projection", short: "Sleeper" },
    { key: "fantasyCalcValue", label: "FantasyCalc value", short: "FC value" },
    { key: "fantasyCalcPositionRank", label: "FantasyCalc position rank", short: "FC pos rank", lowerIsBetter: true },
    { key: "tierCliff", label: "Value drop to next player", short: "Tier drop" },
    { key: "boomBustRange", label: "2026 scoring range", short: "Floor–ceiling" },
  ],
  RB: [
    { key: "league", label: "League projection", short: "League proj" },
    { key: "ppr", label: "PPR projection", short: "PPR proj" },
    { key: "halfPpr", label: "Half-PPR projection", short: "Half proj" },
    { key: "standard", label: "Standard projection", short: "Std proj" },
    { key: "receptionBonus", label: "PPR vs standard spread", short: "PPR spread" },
    { key: "teamTotal", label: "Team implied points", short: "Team pts" },
    { key: "leaguePositionRank", label: "Weekly positional rank", short: "Pos rank", lowerIsBetter: true },
    { key: "vegasProjection", label: "Vegas projection", short: "Vegas" },
    { key: "sleeperProjection", label: "Sleeper projection", short: "Sleeper" },
    { key: "fantasyCalcValue", label: "FantasyCalc value", short: "FC value" },
    { key: "fantasyCalcPositionRank", label: "FantasyCalc position rank", short: "FC pos rank", lowerIsBetter: true },
    { key: "tierCliff", label: "Value drop to next player", short: "Tier drop" },
    { key: "boomBustRange", label: "2026 scoring range", short: "Floor–ceiling" },
  ],
  WR: [
    { key: "league", label: "League projection", short: "League proj" },
    { key: "ppr", label: "PPR projection", short: "PPR proj" },
    { key: "halfPpr", label: "Half-PPR projection", short: "Half proj" },
    { key: "standard", label: "Standard projection", short: "Std proj" },
    { key: "receptionBonus", label: "PPR vs standard spread", short: "PPR spread" },
    { key: "teamTotal", label: "Team implied points", short: "Team pts" },
    { key: "leaguePositionRank", label: "Weekly positional rank", short: "Pos rank", lowerIsBetter: true },
    { key: "vegasProjection", label: "Vegas projection", short: "Vegas" },
    { key: "sleeperProjection", label: "Sleeper projection", short: "Sleeper" },
    { key: "fantasyCalcValue", label: "FantasyCalc value", short: "FC value" },
    { key: "fantasyCalcPositionRank", label: "FantasyCalc position rank", short: "FC pos rank", lowerIsBetter: true },
    { key: "tierCliff", label: "Value drop to next player", short: "Tier drop" },
    { key: "boomBustRange", label: "2026 scoring range", short: "Floor–ceiling" },
  ],
  TE: [
    { key: "league", label: "League projection", short: "League proj" },
    { key: "ppr", label: "PPR projection", short: "PPR proj" },
    { key: "halfPpr", label: "Half-PPR projection", short: "Half proj" },
    { key: "standard", label: "Standard projection", short: "Std proj" },
    { key: "receptionBonus", label: "PPR vs standard spread", short: "PPR spread" },
    { key: "teamTotal", label: "Team implied points", short: "Team pts" },
    { key: "leaguePositionRank", label: "Weekly positional rank", short: "Pos rank", lowerIsBetter: true },
    { key: "vegasProjection", label: "Vegas projection", short: "Vegas" },
    { key: "sleeperProjection", label: "Sleeper projection", short: "Sleeper" },
    { key: "fantasyCalcValue", label: "FantasyCalc value", short: "FC value" },
    { key: "fantasyCalcPositionRank", label: "FantasyCalc position rank", short: "FC pos rank", lowerIsBetter: true },
    { key: "tierCliff", label: "Value drop to next player", short: "Tier drop" },
    { key: "boomBustRange", label: "2026 scoring range", short: "Floor–ceiling" },
  ],
  K: [
    { key: "league", label: "League projection", short: "League proj" },
    { key: "sleeperProjection", label: "Sleeper projection", short: "Sleeper" },
    { key: "teamTotal", label: "Team implied points", short: "Team pts" },
    { key: "leaguePositionRank", label: "Weekly positional rank", short: "Pos rank", lowerIsBetter: true },
    { key: "fantasyCalcValue", label: "FantasyCalc value", short: "FC value" },
    { key: "fantasyCalcPositionRank", label: "FantasyCalc position rank", short: "FC pos rank", lowerIsBetter: true },
  ],
  DEF: [
    { key: "projection", label: "Fantasy projection", short: "Proj" },
    { key: "opponentTotal", label: "Opponent implied points", short: "Opp pts", lowerIsBetter: true },
  ],
};

// Underlying Vegas stat projections shown as extra rows in the player-vs-player
// comparison (keys match the `stat_` values populated in buildWeeklyEntities).
const projectedStatMetrics: Record<BasePosition, Metric[]> = {
  QB: [
    { key: "stat_pass_yd", label: "Projected pass yds", short: "Pass yds" },
    { key: "stat_pass_td", label: "Projected pass TD", short: "Pass TD" },
    { key: "stat_pass_int", label: "Projected INT", short: "INT" },
    { key: "stat_rush_yd", label: "Projected rush yds", short: "Rush yds" },
    { key: "stat_rush_td", label: "Projected rush TD", short: "Rush TD" },
  ],
  RB: [
    { key: "stat_rush_yd", label: "Projected rush yds", short: "Rush yds" },
    { key: "stat_rush_td", label: "Projected rush TD", short: "Rush TD" },
    { key: "stat_rec", label: "Projected receptions", short: "Rec" },
    { key: "stat_rec_yd", label: "Projected rec yds", short: "Rec yds" },
    { key: "stat_rec_td", label: "Projected rec TD", short: "Rec TD" },
  ],
  WR: [
    { key: "stat_rec", label: "Projected receptions", short: "Rec" },
    { key: "stat_rec_yd", label: "Projected rec yds", short: "Rec yds" },
    { key: "stat_rec_td", label: "Projected rec TD", short: "Rec TD" },
    { key: "stat_rush_yd", label: "Projected rush yds", short: "Rush yds" },
    { key: "stat_rush_td", label: "Projected rush TD", short: "Rush TD" },
  ],
  TE: [
    { key: "stat_rec", label: "Projected receptions", short: "Rec" },
    { key: "stat_rec_yd", label: "Projected rec yds", short: "Rec yds" },
    { key: "stat_rec_td", label: "Projected rec TD", short: "Rec TD" },
    { key: "stat_rush_yd", label: "Projected rush yds", short: "Rush yds" },
    { key: "stat_rush_td", label: "Projected rush TD", short: "Rush TD" },
  ],
  K: [],
  DEF: [],
};

const teamContextMetrics: Metric[] = [
  { key: "teamOffenseRank", label: "Team offense rank", short: "Offense rank", lowerIsBetter: true },
  { key: "teamOLineRank", label: "Team O-line rank", short: "O-line rank", lowerIsBetter: true },
  { key: "opponentDefenseRank", label: "Opponent defense rank", short: "Opp DEF rank" },
  { key: "matchupPositionRank", label: "Positional matchup rank", short: "Matchup rank", lowerIsBetter: true },
];

// The comparison view keeps one fantasy-point total per source. PPR, half-PPR,
// standard and canonical Vegas totals are alternate scorings of the same
// projected stat line, so showing all of them creates duplicate rows rather
// than another decision signal.
const redundantComparisonProjectionKeys = new Set(["ppr", "halfPpr", "standard", "receptionBonus", "vegasProjection"]);

// Slot the stat-breakdown rows directly after the projection metrics so the
// comparison reads: fantasy-point projections first, then the stats behind them.
for (const position of ["QB", "RB", "WR", "TE"] as const) {
  const metrics = weeklyMetrics[position];
  const stats = projectedStatMetrics[position];
  const sleeperIndex = metrics.findIndex((metric) => metric.key === "sleeperProjection");
  if (sleeperIndex >= 0) metrics.splice(sleeperIndex + 1, 0, ...stats);
  else metrics.push(...stats);
}

const projectionPresets: ChartPreset[] = [
  { label: "Vegas vs Sleeper", x: "vegasProjection", y: "sleeperProjection" },
  { label: "Projection vs FantasyCalc value", x: "league", y: "fantasyCalcValue" },
  { label: "Positional tier cliffs", x: "leaguePositionRank", y: "league" },
  { label: "Projection vs boom/bust range", x: "league", y: "boomBustRange" },
  { label: "Team environment", x: "teamTotal", y: "league" },
];

const weeklyPresets: Record<BasePosition, ChartPreset[]> = {
  QB: projectionPresets,
  RB: projectionPresets,
  WR: projectionPresets,
  TE: projectionPresets,
  K: [
    { label: "Projection vs Sleeper", x: "sleeperProjection", y: "league" },
    { label: "Projected kicker ranks", x: "leaguePositionRank", y: "league" },
    { label: "Scoring environment", x: "teamTotal", y: "league" },
  ],
  DEF: [{ label: "Matchup leverage", x: "opponentTotal", y: "projection" }],
};

const defaultWeeklyAxes: Record<BasePosition, [string, string]> = {
  QB: ["teamTotal", "league"],
  RB: ["teamTotal", "league"],
  WR: ["teamTotal", "league"],
  TE: ["teamTotal", "league"],
  K: ["teamTotal", "league"],
  DEF: ["opponentTotal", "projection"],
};

/** A chart's player group: one position, or FLEX (RB, WR and TE together). */
type ChartPosition = BasePosition | "FLEX";
const flexPositions: readonly BasePosition[] = ["RB", "WR", "TE"];
// Position ranks and boom/bust ranges are per position, so they don't mix in FLEX.
const flexExcludedWeeklyKeys = new Set(["leaguePositionRank", "boomBustRange"]);

function chartPositionOptions(validPositions: readonly BasePosition[]): ChartPosition[] {
  const options: ChartPosition[] = [...validPositions];
  if (flexPositions.every((item) => validPositions.includes(item))) options.splice(options.indexOf("TE") + 1, 0, "FLEX");
  return options;
}

function chartPositionLabel(position: string): string {
  return position === "DEF" ? "DST" : position;
}

function inChartPosition(entityPosition: string, position: ChartPosition): boolean {
  return position === "FLEX" ? (flexPositions as readonly string[]).includes(entityPosition) : entityPosition === position;
}

/** Metrics every list has, in the first list's order. */
function sharedMetrics(lists: Metric[][]): Metric[] {
  const [first = [], ...rest] = lists;
  return first.filter((metric) => rest.every((list) => list.some((other) => other.key === metric.key)));
}

function chartAnalyticsMetrics(position: ChartPosition, league: League): Metric[] {
  return position === "FLEX" ? sharedMetrics(flexPositions.map((item) => analyticsMetricsForLeague(item, league))) : analyticsMetricsForLeague(position, league);
}

function chartWeeklyMetrics(position: ChartPosition): Metric[] {
  return position === "FLEX"
    ? sharedMetrics(flexPositions.map((item) => weeklyMetrics[item])).filter((metric) => !flexExcludedWeeklyKeys.has(metric.key))
    : weeklyMetrics[position];
}

function chartAnalyticsPresets(position: ChartPosition): ChartPreset[] {
  return position === "FLEX" ? sharedSkillPresets : analyticsPresets[position];
}

function chartWeeklyPresets(position: ChartPosition): ChartPreset[] {
  return position === "FLEX"
    ? projectionPresets.filter((preset) => !flexExcludedWeeklyKeys.has(preset.x) && !flexExcludedWeeklyKeys.has(preset.y))
    : weeklyPresets[position];
}

function chartAnalyticsAxes(position: ChartPosition): [string, string] {
  return position === "FLEX" ? ["opportunity", "fantasy_league"] : defaultAnalyticsAxes[position];
}

function chartWeeklyAxes(position: ChartPosition): [string, string] {
  return position === "FLEX" ? ["teamTotal", "league"] : defaultWeeklyAxes[position];
}

/** Saved views store one base position, so a FLEX chart can't be saved; this only fills the type. */
function savedConfigPosition(position: ChartPosition): BasePosition {
  return position === "FLEX" ? "RB" : position;
}

/** What a chart hands to the other dataset's chart when a view from that dataset is picked. */
type ChartHandoff = { position: ChartPosition; preset?: ChartPreset; savedView?: SavedChartView };

type ChartPickerMode = "blank" | "derived";

type ChartLayout = "page" | "monitor";

type SavedViewControlsProps = {
  dataset: ToolDataset;
  presets: ChartPreset[];
  validPositions: readonly BasePosition[];
  config: SavedChartConfig;
  pickerMode: ChartPickerMode;
  selectedSavedViewId: string | null;
  onSelectedSavedViewIdChange: (id: string | null) => void;
  onApplySavedView: (view: SavedChartView) => void;
  onApplyBuiltIn: (preset: ChartPreset) => void;
  /** The other dataset's built-in views for this position; picking one hands off to that chart. */
  otherPresets?: ChartPreset[];
  onSwitchDataset?: (handoff: Omit<ChartHandoff, "position">) => void;
  canSave?: boolean;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  children: ReactNode;
  layout?: ChartLayout;
};

function SavedViewControls({ dataset, presets, validPositions, config, pickerMode, selectedSavedViewId, onSelectedSavedViewIdChange, onApplySavedView, onApplyBuiltIn, otherPresets = [], onSwitchDataset, canSave = true, advancedOpen, onAdvancedOpenChange, children, layout = "page" }: SavedViewControlsProps) {
  const queryClient = useQueryClient();
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedChartView | null>(null);
  useUnsavedLeaveWarning(shouldWarnBeforeLeave({ tradeAssetCount: 0, savedViewNaming: isNaming, savedViewName: name }));
  const nameRef = useRef<HTMLInputElement>(null);
  const viewsQuery = useQuery({
    queryKey: SAVED_CHART_VIEWS_QUERY_KEY,
    queryFn: () => api.listSavedChartViews({}),
    staleTime: 60_000,
    retry: false,
  });
  const allViews = (viewsQuery.data?.views ?? [])
    .filter((view) => validPositions.includes(view.position))
    .filter((view) => onSwitchDataset || view.dataset === dataset);
  const views = allViews.filter((view) => view.dataset === dataset);
  const selectedSavedView = views.find((view) => view.id === selectedSavedViewId);
  const matchingPreset = presets.find((preset) => preset.x === config.xMetric && preset.y === config.yMetric);
  const pickerValue = pickerMode === "blank"
    ? ""
    : selectedSavedView
      ? `saved:${selectedSavedView.id}`
      : matchingPreset
        ? `builtin:${dataset}:${matchingPreset.x}|${matchingPreset.y}`
        : "custom";

  const saveMutation = useMutation({
    mutationFn: (viewName: string) => api.saveChartView({ name: viewName, ...config }),
    onMutate: async (viewName) => {
      await queryClient.cancelQueries({ queryKey: SAVED_CHART_VIEWS_QUERY_KEY });
      const optimisticView: SavedChartView = {
        ...config,
        id: `optimistic:${config.dataset}:${viewName}`,
        name: viewName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const previous = applySavedChartViewMutation<SavedChartView>(queryClient, (current) => optimisticUpsertSavedChartView(current, optimisticView));
      const previousSelected = selectedSavedViewId;
      onSelectedSavedViewIdChange(optimisticView.id);
      setName("");
      setIsNaming(false);
      setMessageIsError(false);
      setMessage("");
      return { previous, previousSelected, optimisticId: optimisticView.id };
    },
    onSuccess: ({ view }, _viewName, context) => {
      applySavedChartViewMutation<SavedChartView>(queryClient, (current) => optimisticUpsertSavedChartView(
        { views: (current?.views ?? []).filter((item) => item.id !== context?.optimisticId) },
        view,
      ));
      onSelectedSavedViewIdChange(view.id);
      setName("");
      setIsNaming(false);
      setMessageIsError(false);
      setMessage(`Saved “${view.name}”.`);
    },
    onError: (_error, viewName, context) => {
      rollbackSavedChartViewMutation(queryClient, context?.previous);
      onSelectedSavedViewIdChange(context?.previousSelected ?? null);
      setIsNaming(true);
      setName(viewName);
      setMessageIsError(true);
      setMessage("Couldn’t save this view. Try again.");
    },
    onSettled: () => {
      void settleSavedChartViewMutation(queryClient);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteChartView({ id }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: SAVED_CHART_VIEWS_QUERY_KEY });
      const previous = applySavedChartViewMutation<SavedChartView>(queryClient, (current) => optimisticRemoveSavedChartView(current, id));
      const previousSelected = selectedSavedViewId;
      onSelectedSavedViewIdChange(null);
      setMessageIsError(false);
      setMessage("");
      return { previous, previousSelected };
    },
    onSuccess: () => {
      setMessageIsError(false);
      setMessage("Saved view deleted.");
    },
    onError: (_error, _id, context) => {
      rollbackSavedChartViewMutation(queryClient, context?.previous);
      onSelectedSavedViewIdChange(context?.previousSelected ?? null);
      setMessageIsError(true);
      setMessage("Couldn’t delete this view. Try again.");
    },
    onSettled: () => {
      void settleSavedChartViewMutation(queryClient);
    },
  });

  useEffect(() => {
    if (!isNaming) return;
    const desktop = window.matchMedia("(pointer: fine) and (min-width: 760px)").matches;
    if (desktop) nameRef.current?.focus();
  }, [isNaming]);

  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessageIsError(true);
      setMessage("Enter a name for this view.");
      nameRef.current?.focus();
      return;
    }
    setMessageIsError(false);
    setMessage("");
    saveMutation.mutate(trimmed);
  }

  const savedViewSelect = (
    <select
      aria-label="Saved view"
      value={pickerValue}
      onChange={(event) => {
        const nextValue = event.target.value;
        setMessageIsError(false);
        setMessage("");
        if (!nextValue) return;
        if (nextValue.startsWith("saved:")) {
          const view = allViews.find((item) => `saved:${item.id}` === nextValue);
          if (!view) return;
          if (view.dataset === dataset) onApplySavedView(view);
          else onSwitchDataset?.({ savedView: view });
          return;
        }
        if (nextValue.startsWith("builtin:")) {
          const [, presetDataset, axes] = nextValue.split(":");
          const list = presetDataset === dataset ? presets : otherPresets;
          const preset = list.find((item) => `${item.x}|${item.y}` === axes);
          if (!preset) return;
          if (presetDataset === dataset) onApplyBuiltIn(preset);
          else onSwitchDataset?.({ preset });
        }
      }}
    >
      <option value="" disabled hidden>Choose a view</option>
      {onSwitchDataset
        ? ([["projections", "This week"], ["advanced", "Season"]] as const).map(([groupDataset, groupLabel]) => {
          const groupPresets = groupDataset === dataset ? presets : otherPresets;
          return groupPresets.length > 0 ? (
            <optgroup key={groupDataset} label={groupLabel}>
              {groupPresets.map((preset) => <option key={`${preset.x}-${preset.y}`} value={`builtin:${groupDataset}:${preset.x}|${preset.y}`}>{preset.label}</option>)}
            </optgroup>
          ) : null;
        })
        : (
          <optgroup label="Built-in views">
            {presets.map((preset) => <option key={`${preset.x}-${preset.y}`} value={`builtin:${dataset}:${preset.x}|${preset.y}`}>{preset.label}</option>)}
          </optgroup>
        )}
      {allViews.length > 0 ? <optgroup label="My saved views">{allViews.map((view) => <option key={view.id} value={`saved:${view.id}`}>{view.name}</option>)}</optgroup> : null}
      {pickerValue === "custom" ? <option value="custom" disabled hidden>Custom</option> : null}
    </select>
  );

  return (
    <>
    {layout === "monitor" ? (
      <label className="monitor-value-chart-field">
        {savedViewSelect}
      </label>
    ) : (
      <div className="saved-view-block">
        <div className="saved-view-row">
          <label className="chart-preset-select">
            {savedViewSelect}
          </label>
        </div>
        {pickerMode === "derived" && matchingPreset?.research ? (
          <div className="chart-research-note">
            <p>{matchingPreset.research.insight}</p>
            <a href={matchingPreset.research.sourceUrl} target="_blank" rel="noreferrer">Research: {matchingPreset.research.source} ↗<span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        ) : null}
      </div>
    )}
    {layout === "monitor" ? (
      <button
        type="button"
        className="monitor-chart-advanced-trigger"
        aria-haspopup="dialog"
        onClick={() => onAdvancedOpenChange(true)}
      >
        Advanced chart controls
      </button>
    ) : (
      <Button type="button" variant="outline" className="chart-advanced-trigger" aria-haspopup="dialog" onClick={() => onAdvancedOpenChange(true)}>Advanced chart controls</Button>
    )}
    <Dialog open={advancedOpen} onOpenChange={onAdvancedOpenChange}>
      <DialogContent className="chart-advanced-dialog">
        <DialogHeader>
          <DialogTitle>Advanced chart controls</DialogTitle>
          <DialogDescription className="sr-only">Adjust axes, players shown, and display options for this chart.</DialogDescription>
        </DialogHeader>
        <DialogCloseButton label="Close advanced chart controls" />
        <div className="saved-view-actions">
          {canSave ? <Button type="button" variant="outline" size="sm" className="saved-view-save-trigger" onClick={() => { setIsNaming((open) => !open); setMessageIsError(false); setMessage(""); }}>{isNaming ? "Cancel" : "Save current view"}</Button> : null}
          {selectedSavedView ? <button type="button" className="saved-view-delete" onClick={() => setPendingDelete(selectedSavedView)} disabled={deleteMutation.isPending}>Delete “{selectedSavedView.name}”</button> : null}
        </div>
        {isNaming && canSave ? (
          <form className="saved-view-form" onSubmit={submitName}>
            <label htmlFor={`${dataset}-saved-view-name`}>View name</label>
            <div>
              <input ref={nameRef} id={`${dataset}-saved-view-name`} name="view-name" autoComplete="off" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="RB receiving upside…" />
              <button type="submit" disabled={saveMutation.isPending} aria-busy={saveMutation.isPending}>Save{saveMutation.isPending ? <span className="sr-only"> Saving…</span> : null}</button>
            </div>
          </form>
        ) : null}
        {viewsQuery.isError ? <p className="saved-view-status" role="alert">Saved views couldn’t be loaded.</p> : message ? <p className="saved-view-status" role={messageIsError ? "alert" : "status"}>{message}</p> : null}
        {children}
      </DialogContent>
    </Dialog>
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete saved view?</DialogTitle>
            <DialogDescription>This removes “{pendingDelete?.name ?? "this view"}”. The chart axes stay as they are.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!pendingDelete) return;
                deleteMutation.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete view
            </Button>
          </DialogFooter>
          <DialogCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}

const percentileOptions = [10, 25, 50, 75, 90] as const;

function percentileCutoff(values: number[], performancePercentile: number, lowerIsBetter = false): number {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const rawPercentile = lowerIsBetter ? 100 - performancePercentile : performancePercentile;
  const rank = (rawPercentile / 100) * (ordered.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = ordered[lowerIndex] ?? 0;
  const upper = ordered[upperIndex] ?? lower;
  return lower + (upper - lower) * (rank - lowerIndex);
}

function PercentileCutoffSelect({ axis, value, onChange }: { axis: "X" | "Y"; value: number; onChange: (value: number) => void }) {
  return (
    <label className="plot-limit">
      <span>{axis} cutoff percentile</span>
      <select aria-label={`Choose ${axis.toLowerCase()} cutoff percentile`} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {percentileOptions.map((percentile) => <option value={percentile} key={percentile}>{percentile}th percentile</option>)}
      </select>
    </label>
  );
}

function metricDisplay(value: number, metric: Metric): string {
  // Ranks are whole numbers ("3", not "3.00").
  const decimals = metric.key.endsWith("Rank") || Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${formatDecimal(value, decimals)}${metric.unit ?? ""}`;
}

function ordinalSuffix(value: number): string {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return "th";
  if (value % 10 === 1) return "st";
  if (value % 10 === 2) return "nd";
  if (value % 10 === 3) return "rd";
  return "th";
}

function analyticsLabel(entity: Pick<AnalyticsEntity, "name" | "team" | "position">): string {
  if (entity.position === "DEF") return entity.team;
  const parts = entity.name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? entity.name;
}

function comparablePlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isSamePlayer(entity: PlayerSelection, selection: PlayerSelection): boolean {
  if (entity.playerId && selection.playerId) return entity.playerId === selection.playerId;
  if (entity.position !== selection.position) return false;
  if (entity.position === "DEF") return entity.team === selection.team;
  return comparablePlayerName(entity.name) === comparablePlayerName(selection.name);
}

function isPlayerOnSelectedTeam(entity: Pick<AnalyticsEntity, "name" | "team" | "position">, league: League): boolean {
  if (entity.position === "DEF") return league.rosteredPlayerIds.includes(entity.team);
  const entityName = comparablePlayerName(entity.name);
  return [...league.starters, ...league.bench].some((player) => (
    player.position === entity.position
    && player.team === entity.team
    && comparablePlayerName(player.name) === entityName
  ));
}

function boxOverlap(a: LabelBox, b: LabelBox): number {
  const width = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return width * height;
}

function pointInsideBox(x: number, y: number, box: LabelBox, padding: number): boolean {
  return x >= box.left - padding
    && x <= box.left + box.width + padding
    && y >= box.top - padding
    && y <= box.top + box.height + padding;
}

function AdaptiveChartLabels({ data, leaderIds, selectedTeamIds, highlightedId = null, xAxisMap, yAxisMap, offset }: AdaptiveChartLabelsProps) {
  const xAxis = xAxisMap?.["0"] ?? Object.values(xAxisMap ?? {})[0];
  const yAxis = yAxisMap?.["0"] ?? Object.values(yAxisMap ?? {})[0];
  if (typeof xAxis?.scale !== "function" || typeof yAxis?.scale !== "function" || !offset) return null;

  const xScale = xAxis.scale as (value: number) => number;
  const yScale = yAxis.scale as (value: number) => number;
  const left = offset.left ?? 0;
  const top = offset.top ?? 0;
  const right = left + (offset.width ?? 0);
  const bottom = top + (offset.height ?? 0);
  const points = data.map((datum) => ({ datum, x: xScale(datum.x), y: yScale(datum.y) }));
  const density = (x: number, y: number) => points.filter((point) => Math.abs(point.x - x) < 40 && Math.abs(point.y - y) < 18).length;
  const ordered = points.slice().sort((a, b) => {
    const highlightedDifference = Number(b.datum.id === highlightedId) - Number(a.datum.id === highlightedId);
    if (highlightedDifference !== 0) return highlightedDifference;
    const selectedTeamDifference = Number(selectedTeamIds.has(b.datum.id)) - Number(selectedTeamIds.has(a.datum.id));
    if (selectedTeamDifference !== 0) return selectedTeamDifference;
    const densityDifference = density(b.x, b.y) - density(a.x, a.y);
    if (densityDifference !== 0) return densityDifference;
    const leaderDifference = Number(leaderIds.has(b.datum.id)) - Number(leaderIds.has(a.datum.id));
    return leaderDifference || a.datum.id.localeCompare(b.datum.id);
  });
  const placed: LabelPlacement[] = [];

  for (const point of ordered) {
    const width = Math.min(72, Math.max(18, point.datum.label.length * 4.2 + 4));
    const height = 11;
    const candidates: Array<LabelBox & { textX: number; textY: number; anchor: "start" | "middle" | "end" }> = [
      { left: point.x + 7, top: point.y - height / 2, width, height, textX: point.x + 9, textY: point.y + 3, anchor: "start" },
      { left: point.x - width - 7, top: point.y - height / 2, width, height, textX: point.x - 9, textY: point.y + 3, anchor: "end" },
      { left: point.x + 6, top: point.y - 16, width, height, textX: point.x + 8, textY: point.y - 7, anchor: "start" },
      { left: point.x - width - 6, top: point.y - 16, width, height, textX: point.x - 8, textY: point.y - 7, anchor: "end" },
      { left: point.x + 6, top: point.y + 5, width, height, textX: point.x + 8, textY: point.y + 14, anchor: "start" },
      { left: point.x - width - 6, top: point.y + 5, width, height, textX: point.x - 8, textY: point.y + 14, anchor: "end" },
      { left: point.x - width / 2, top: point.y - 17, width, height, textX: point.x, textY: point.y - 8, anchor: "middle" },
      { left: point.x - width / 2, top: point.y + 6, width, height, textX: point.x, textY: point.y + 15, anchor: "middle" },
    ];

    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [index, candidate] of candidates.entries()) {
      const outside = Math.max(0, left + 3 - candidate.left)
        + Math.max(0, candidate.left + candidate.width - right + 3)
        + Math.max(0, top + 3 - candidate.top)
        + Math.max(0, candidate.top + candidate.height - bottom + 3);
      const labelOverlap = placed.reduce((score, other) => score + boxOverlap(candidate, other), 0);
      const coveredPoints = points.reduce((count, other) => count + (other.datum.id !== point.datum.id && pointInsideBox(other.x, other.y, candidate, 2) ? 1 : 0), 0);
      const edgePreference = (point.y < top + 30 && candidate.top < point.y ? 140 : 0)
        + (point.y > bottom - 30 && candidate.top > point.y ? 140 : 0)
        + (point.x < left + 52 && candidate.left < point.x ? 110 : 0)
        + (point.x > right - 52 && candidate.left > point.x ? 110 : 0);
      const score = outside * 2500 + labelOverlap * 80 + coveredPoints * 900 + edgePreference + index * 3;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    const keepAlways = point.datum.id === highlightedId || selectedTeamIds.has(point.datum.id);
    // Drop field labels that still collide after placement search.
    if (!keepAlways && bestScore > 500) continue;
    if (best) placed.push({ ...best, datum: point.datum });
  }

  return (
    <g className="adaptive-chart-labels" aria-hidden="true">
      {placed.map((placement) => {
        const isSelected = selectedTeamIds.has(placement.datum.id);
        const isLeader = leaderIds.has(placement.datum.id);
        const isHighlighted = placement.datum.id === highlightedId;
        return (
          <text
            key={placement.datum.id}
            className={isSelected || isHighlighted ? "adaptive-chart-label selected-team" : isLeader ? "adaptive-chart-label leader" : "adaptive-chart-label"}
            x={placement.textX}
            y={placement.textY}
            textAnchor={placement.anchor}
          >
            {placement.datum.label}
          </text>
        );
      })}
    </g>
  );
}

function ScatterTrendLine({ data, xAxisMap, yAxisMap, offset }: {
  data: ChartDatum[];
  xAxisMap?: Record<string, ChartAxis>;
  yAxisMap?: Record<string, ChartAxis>;
  offset?: ChartOffset;
}) {
  const xAxis = xAxisMap?.["0"] ?? Object.values(xAxisMap ?? {})[0];
  const yAxis = yAxisMap?.["0"] ?? Object.values(yAxisMap ?? {})[0];
  if (typeof xAxis?.scale !== "function" || typeof yAxis?.scale !== "function" || !offset || data.length < 2) return null;
  const xScale = xAxis.scale as (value: number) => number;
  const yScale = yAxis.scale as (value: number) => number;
  const n = data.length;
  const sumX = data.reduce((total, point) => total + point.x, 0);
  const sumY = data.reduce((total, point) => total + point.y, 0);
  const sumXY = data.reduce((total, point) => total + point.x * point.y, 0);
  const sumXX = data.reduce((total, point) => total + point.x * point.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const xs = data.map((point) => point.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const y1 = intercept + slope * minX;
  const y2 = intercept + slope * maxX;
  return (
    <line
      className="scatter-trend-line"
      x1={xScale(minX)}
      y1={yScale(y1)}
      x2={xScale(maxX)}
      y2={yScale(y2)}
      stroke="var(--dim)"
      strokeWidth={1}
      strokeOpacity={0.2}
      strokeDasharray="5 6"
    />
  );
}

// Single shared rendering path for both chart datasets (Advanced Stats and weekly
// Projections). Premade presets, saved views, and custom axes all render through this
// component. The only dataset-specific rendering difference is the axis-title suffix:
// Advanced Stats plots per-game averages (short + " / game"), Projections plots raw
// projection values (short, no suffix).
type ScatterAxisSpec = { short: string; lowerIsBetter?: boolean; titleSuffix: string };
type ScatterPlotProps = {
  others: ChartDatum[];
  leadersWithoutSelectedTeam: ChartDatum[];
  selectedTeamPlayers: ChartDatum[];
  labelData: ChartDatum[];
  leaderIds: ReadonlySet<string>;
  selectedTeamIds: ReadonlySet<string>;
  highlightedId?: string | null;
  xAxis: ScatterAxisSpec;
  yAxis: ScatterAxisSpec;
  showQuadrants: boolean;
  xCutoff: number;
  yCutoff: number;
  ariaLabel: string;
  compact?: boolean;
  /** Resolves a focused player to their card; without it no link is shown. */
  playerLink?: PlayerLinkResolver;
  /** Chart point id to focus when it changes (a link into the tool); the user can still change or clear it. */
  focusRequestId?: string | null;
};

function ScatterPlot({
  others,
  leadersWithoutSelectedTeam,
  selectedTeamPlayers,
  labelData,
  leaderIds,
  selectedTeamIds,
  highlightedId = null,
  xAxis,
  yAxis,
  showQuadrants,
  xCutoff,
  yCutoff,
  ariaLabel,
  compact = false,
  playerLink,
  focusRequestId = null,
}: ScatterPlotProps) {
  const [zoomed, setZoomed] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(focusRequestId);
  useEffect(() => { if (focusRequestId) setFocusedId(focusRequestId); }, [focusRequestId]);
  const plottedData = Array.from(new Map(
    [...others, ...leadersWithoutSelectedTeam, ...selectedTeamPlayers].map((point) => [point.id, point]),
  ).values());
  const focused = plottedData.find((point) => point.id === focusedId) ?? null;
  const focusedLink = focused && playerLink
    ? playerLink({ playerId: focused.playerId ?? null, name: focused.name, team: focused.team, position: focused.position ?? null })
    : null;
  const focusableData = [...plottedData].sort((a, b) => a.name.localeCompare(b.name));
  // Tapping a point or choosing it from the dropdown focuses it; tapping it again clears.
  const toggleFocus = (id: string) => setFocusedId((current) => (current === id ? null : id));
  const focusedLabelData = focused && !labelData.some((point) => point.id === focused.id) ? [...labelData, focused] : labelData;
  const xDomain = scatterAxisDomain(plottedData.map((point) => point.x), zoomed);
  const yDomain = scatterAxisDomain(plottedData.map((point) => point.y), zoomed);
  const toggleZoom = () => setZoomed((value) => !value);
  const margin = compact
    ? { top: 8, right: 8, bottom: 16, left: 2 }
    : { top: 10, right: 12, bottom: 18, left: 4 };
  const axisTitle = `${xAxis.short}${xAxis.titleSuffix}`;
  const yAxisTitle = `${yAxis.short}${yAxis.titleSuffix}`;
  const dotSize = compact ? 64 : 96;
  const plot = (
    <div
      aria-hidden="true"
      className="scatter-plot-body"
      onDoubleClick={(event) => {
        event.preventDefault();
        toggleZoom();
      }}
    >
      <ChartContainer config={{ field: { label: "Field", color: "var(--chart-2)" }, team: { label: "My team", color: "var(--chart-team)" } }} className="aspect-auto h-full">
        <ScatterChart margin={margin}>
          <CartesianGrid stroke="var(--hairline)" strokeDasharray="1 6" vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            name={axisTitle}
            domain={xDomain}
            allowDataOverflow={zoomed}
            reversed={xAxis.lowerIsBetter}
            tick={{ fill: "var(--dim)", fontSize: compact ? 10 : 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--hairline)" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yAxisTitle}
            domain={yDomain}
            allowDataOverflow={zoomed}
            reversed={yAxis.lowerIsBetter}
            width={compact ? 30 : 38}
            tick={{ fill: "var(--dim)", fontSize: compact ? 10 : 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip cursor={{ stroke: "var(--dim)", strokeDasharray: "3 3", strokeOpacity: 0.45 }} contentStyle={chartTooltipStyle} />
          {showQuadrants ? <ReferenceLine x={xCutoff} stroke="var(--hairline)" strokeWidth={1} strokeDasharray="4 8" /> : null}
          {showQuadrants ? <ReferenceLine y={yCutoff} stroke="var(--hairline)" strokeWidth={1} strokeDasharray="4 8" /> : null}
          <ZAxis range={[dotSize, dotSize]} />
          <Scatter name="Field" data={others} fill="var(--chart-2)" fillOpacity={0.7} onClick={compact ? undefined : (point: ChartDatum) => toggleFocus(point.id)} />
          <Scatter name="Smash spots" data={leadersWithoutSelectedTeam} fill="var(--chart-2)" fillOpacity={0.7} onClick={compact ? undefined : (point: ChartDatum) => toggleFocus(point.id)} />
          {/* My team is a diamond as well as teal, so it reads without colour. */}
          <Scatter name="My team" data={selectedTeamPlayers} shape="diamond" fill="var(--chart-team)" stroke="var(--chart-team)" strokeWidth={1} onClick={compact ? undefined : (point: ChartDatum) => toggleFocus(point.id)} />
          {!compact && focused ? (
            <Scatter
              name="Selected"
              data={[focused]}
              legendType="none"
              isAnimationActive={false}
              shape={(props: { cx?: number; cy?: number }) => (
                <circle cx={props.cx} cy={props.cy} r={10} fill="none" stroke="var(--foreground)" strokeWidth={2} pointerEvents="none" />
              )}
            />
          ) : null}
          {!compact && plottedData.length > 1 ? <Customized component={<ScatterTrendLine data={plottedData} />} /> : null}
          {focusedLabelData.length ? <Customized component={<AdaptiveChartLabels data={focusedLabelData} leaderIds={leaderIds} selectedTeamIds={selectedTeamIds} highlightedId={focusedId ?? highlightedId} />} /> : null}
        </ScatterChart>
      </ChartContainer>
    </div>
  );
  return (
    <div className={`scatter-chart-shell${compact ? " is-compact" : ""}`} role="group" aria-label={ariaLabel}>
      <div className="scatter-zoom-controls">
        <button
          type="button"
          className="scatter-zoom-toggle"
          aria-pressed={zoomed}
          onClick={toggleZoom}
        >
          {zoomed ? "Reset" : "Zoom in"}
        </button>
        <span className="sr-only">Double-tap the chart to {zoomed ? "reset" : "zoom into the denser central region of plotted points"}.</span>
      </div>
      <p className="sr-only">{ariaLabel}. {plottedData.map((point) => `${point.name}, ${point.team}: ${xAxis.short} ${point.x}, ${yAxis.short} ${point.y}`).join("; ")}{zoomed ? " Chart is zoomed into the central region of plotted points." : ""}</p>
      {compact ? (
        <div className="scatter-frame is-compact">{plot}</div>
      ) : (
        <>
          <div className="scatter-axis-rail">
            <span className="scatter-axis-y" aria-hidden="true">{yAxisTitle}</span>
            <div className="scatter-frame">{plot}</div>
            <span className="scatter-axis-x" aria-hidden="true">{axisTitle}</span>
          </div>
          <div className="scatter-inspector">
            <label className="monitor-value-chart-field scatter-point-select">
              <span>Player</span>
              <select
                aria-label="Choose a player on the chart"
                value={focused?.id ?? ""}
                onChange={(event) => setFocusedId(event.target.value || null)}
              >
                <option value="">None</option>
                {focusableData.map((point) => (
                  <option key={point.id} value={point.id}>{`${point.name} · ${point.team}`}</option>
                ))}
              </select>
            </label>
            {/* One status line stays mounted so changes are announced. */}
            <p className={focused ? "scatter-readout" : "scatter-readout scatter-readout-hint"} role="status">
              {focused ? (
                <>
                  <strong>{focused.name}</strong>{" "}
                  <span>{focused.team}{selectedTeamIds.has(focused.id) ? " · My team" : ""}</span>{" "}
                  <span>{`${xAxis.short} ${focused.x}`}</span>{" "}
                  <span>{`${yAxis.short} ${focused.y}`}</span>
                </>
              ) : "Tap a point or choose a player to read its values."}
            </p>
            {focusedLink ? (
              <p className="tool-player-link-row">
                <PlayerNameLink link={focusedLink}>View {focused?.name}’s card</PlayerNameLink>
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

const SNAP_TREND_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#c4b5fd", "#f9a8d4", "#67e8f9"];

function SnapShareTrendChart({
  series,
  ariaLabel,
}: {
  series: Array<{ id: string; name: string; label: string; color: string; points: Array<{ week: number; snapShare: number }> }>;
  ariaLabel: string;
}) {
  const weeks = [...new Set(series.flatMap((item) => item.points.map((point) => point.week)))].sort((a, b) => a - b);
  const data = weeks.map((week) => {
    const row: Record<string, number | string> = { week };
    for (const item of series) {
      const point = item.points.find((candidate) => candidate.week === week);
      if (point) row[item.id] = point.snapShare;
    }
    return row;
  });

  return (
    <div className="scatter-frame" role="img" aria-label={ariaLabel}>
      <ChartContainer
        config={Object.fromEntries(series.map((item) => [item.id, { label: item.label, color: item.color }]))}
        className="aspect-auto h-full"
      >
        <LineChart data={data} margin={{ top: 22, right: 10, bottom: 28, left: 2 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fill: "var(--dim)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            label={{ value: "Week", position: "insideBottom", offset: -12, fill: "var(--text)", fontSize: 10, fontWeight: 700 }}
          />
          <YAxis
            domain={[0, 100]}
            width={36}
            tick={{ fill: "var(--dim)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            label={{ value: "Snap %", angle: -90, position: "insideLeft", fill: "var(--text)", fontSize: 10, fontWeight: 700 }}
          />
          <Tooltip contentStyle={chartTooltipStyle} />
          {series.map((item) => (
            <Line key={item.id} type="monotone" dataKey={item.id} name={item.label} stroke={item.color} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function fpaHeatColor(rank: number): string {
  // Blend the theme's strength/average/weakness tints so the heatmap follows light and dark.
  const t = Math.min(1, Math.max(0, (rank - 1) / 31));
  if (t < 0.5) return `color-mix(in srgb, var(--stat-strength-soft) ${Math.round(100 - t * 200)}%, var(--stat-average-soft))`;
  return `color-mix(in srgb, var(--stat-weakness-soft) ${Math.round((t - 0.5) * 200)}%, var(--stat-average-soft))`;
}

function FpaHeatmap({
  table,
}: {
  table: Record<string, Partial<Record<"QB" | "RB" | "WR" | "TE", { avg: number; weeks: number; rank: number }>>>;
}) {
  const positions = ["QB", "RB", "WR", "TE"] as const;
  const teams = Object.keys(table).sort((a, b) => a.localeCompare(b));

  return (
    <div className="fpa-heatmap" role="img" aria-label="Fantasy points allowed by defense and position">
      <div className="fpa-heatmap-grid" style={{ gridTemplateColumns: `minmax(2.5rem, 3rem) repeat(${positions.length}, minmax(0, 1fr))` }}>
        <div className="fpa-heatmap-corner" aria-hidden="true" />
        {positions.map((position) => <div className="fpa-heatmap-head" key={position}>{position}</div>)}
        {teams.flatMap((team) => [
          <div className="fpa-heatmap-team" key={`${team}-label`}>{team}</div>,
          ...positions.map((position) => {
            const cell = table[team]?.[position];
            if (!cell) {
              return <div className="fpa-heatmap-cell is-empty" key={`${team}-${position}`}>—</div>;
            }
            return (
              <div
                className="fpa-heatmap-cell"
                key={`${team}-${position}`}
                style={{ background: fpaHeatColor(cell.rank) }}
              >
                <strong>{formatDecimal(cell.avg, 1)}</strong>
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

function TeamScatterPlot({
  data,
  xShort,
  yShort,
  ariaLabel,
  showLabels = true,
  compact = false,
}: {
  data: ChartDatum[];
  xShort: string;
  yShort: string;
  ariaLabel: string;
  showLabels?: boolean;
  compact?: boolean;
}) {
  return (
    <ScatterPlot
      others={data.filter((row) => !row.isSelectedTeam)}
      leadersWithoutSelectedTeam={[]}
      selectedTeamPlayers={data.filter((row) => row.isSelectedTeam)}
      labelData={showLabels ? data : data.filter((row) => row.isSelectedTeam)}
      leaderIds={new Set()}
      selectedTeamIds={new Set(data.filter((row) => row.isSelectedTeam).map((row) => row.id))}
      highlightedId={null}
      xAxis={{ short: xShort, titleSuffix: "" }}
      yAxis={{ short: yShort, titleSuffix: "" }}
      showQuadrants={false}
      xCutoff={0}
      yCutoff={0}
      ariaLabel={ariaLabel}
      compact={compact}
    />
  );
}

function ChartKey({ teamName }: { teamName: string }) {
  return (
    <div className="chart-key">
      <span><i className="selected-team-dot" /> {teamName}</span>
    </div>
  );
}

function fantasyTeamName(league: League): string {
  // Prefer tradeTeams when loaded; otherwise use meta rosterAssignments so
  // Charts/Comparison do not need the trade section.
  return league.tradeTeams.find((team) => team.isUser)?.teamName
    ?? league.rosterAssignments.find((assignment) => assignment.isUser)?.teamName
    ?? "My team";
}

function OmittedChartLabels({ omittedNames }: { omittedNames: string[] }) {
  if (omittedNames.length === 0) return null;
  return (
    <details className="omitted-chart-labels">
      <summary>{omittedNames.length} plotted players without labels</summary>
      <p>{omittedNames.join(" · ")}</p>
    </details>
  );
}

export function AdvancedStats({ dashboard, league, selectedPlayer, onSelectedPlayerChange }: { dashboard: Dashboard; league: League; selectedPlayer: PlayerSelection | null; onSelectedPlayerChange: (player: PlayerSelection | null) => void }) {
  const [window, setWindow] = useState<AnalyticsWindow>("season");
  const [playerQuery, setPlayerQuery] = useState("");
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);

  const playerOptions = useMemo(() => dashboard.analytics.entities
    .filter((entity) => validPositions.includes(entity.position))
    .sort((a, b) => (
      a.name.localeCompare(b.name) || a.position.localeCompare(b.position) || a.team.localeCompare(b.team)
    )), [dashboard.analytics.entities, validPositions]);
  const selected = selectedPlayer && validPositions.includes(selectedPlayer.position)
    ? dashboard.analytics.entities.find((entity) => isSamePlayer(entity, selectedPlayer))
    : undefined;
  const playerMatches = useMemo(() => {
    const needle = comparablePlayerName(playerQuery.trim());
    return playerOptions
      .filter((entity) => !needle || comparablePlayerName(entity.name).includes(needle))
      .sort((a, b) => {
        const aName = comparablePlayerName(a.name);
        const bName = comparablePlayerName(b.name);
        const aPriority = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
        const bPriority = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
        return aPriority - bPriority || a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }, [playerOptions, playerQuery]);

  useEffect(() => {
    if (!selectedPlayer || validPositions.includes(selectedPlayer.position)) return;
    onSelectedPlayerChange(null);
    setPlayerQuery("");
  }, [onSelectedPlayerChange, selectedPlayer, validPositions]);

  const chooseAdvancedPlayer = (entity: AnalyticsEntity) => {
    onSelectedPlayerChange({ name: entity.name, team: entity.team, position: entity.position });
    setPlayerQuery("");
  };

  const statRows = useMemo(() => {
    if (!selected) return [];
    const metrics = analyticsMetricsForLeague(selected.position, league);
    const source = window === "season" ? selected.season : selected.rolling17;
    return metrics.flatMap((metric, metricIndex) => {
      const value = metricSourceValue(source, metric);
      if (typeof value !== "number" || !Number.isFinite(value)) return [];
      const peerValues = dashboard.analytics.entities
        .filter((entity) => entity.position === selected.position)
        .map((entity) => metricSourceValue(window === "season" ? entity.season : entity.rolling17, metric))
        .filter((peerValue): peerValue is number => typeof peerValue === "number" && Number.isFinite(peerValue));
      const rank = 1 + peerValues.filter((peerValue) => metric.lowerIsBetter ? peerValue < value : peerValue > value).length;
      const percentile = peerValues.length <= 1
        ? 100
        : Math.round(((peerValues.length - rank) / (peerValues.length - 1)) * 100);
      return [{ metric, value, rank, peerCount: peerValues.length, percentile, metricIndex }];
    }).sort((a, b) => b.percentile - a.percentile || a.metricIndex - b.metricIndex);
  }, [dashboard.analytics.entities, league, selected, window]);

  if (!dashboard.analytics.entities.length) {
    return (
      <section className="advanced-stats-view">
        <div className="analytics-empty">
          <strong>No advanced stats yet.</strong>
          <span>Refresh after nflverse publishes the next weekly file.</span>
        </div>
      </section>
    );
  }

  const games = selected ? (window === "season" ? selected.seasonGames : selected.rollingGames) : 0;
  const isRostered = selected ? isPlayerOnSelectedTeam(selected, league) : false;

  return (
    <section className="advanced-stats-view">
      <SegmentedControl
        className="lineup-mode-toggle analytics-window-toggle"
        value={window}
        onChange={setWindow}
        label="Advanced stat window"
        options={[{ value: "season", label: "This season" }, { value: "rolling17", label: "Rolling 17 games" }]}
      />

      <div className="advanced-player-picker">
        <label htmlFor="advanced-player-search">Player</label>
        <div className="search-field advanced-player-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            id="advanced-player-search"
            type="search"
            aria-label="Search advanced stats players"
            value={playerQuery}
            onChange={(event) => setPlayerQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const firstMatch = playerMatches[0];
                if (firstMatch) { event.preventDefault(); chooseAdvancedPlayer(firstMatch); }
              } else if (event.key === "Escape") {
                setPlayerQuery("");
              }
            }}
            name="player-search"
            placeholder={selected ? `Search to replace ${selected.name}…` : "Search players…"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {playerQuery ? <button className="search-clear" type="button" onClick={() => setPlayerQuery("")} aria-label="Clear advanced stats player search">×</button> : null}
        </div>
        {playerQuery.trim() ? (
          <div className="advanced-player-results inline-search-results" aria-label="Matching advanced stats players" aria-live="polite">
            {playerMatches.map((entity) => {
              const isSelected = entity.id === selected?.id;
              return (
                <button type="button" aria-current={isSelected ? "true" : undefined} className={isSelected ? "is-selected" : ""} key={entity.id} onClick={() => chooseAdvancedPlayer(entity)}>
                  <span><strong>{entity.name}</strong>{isSelected ? <span className="advanced-selected-label">Selected</span> : null}</span>
                  <small>{entity.position === "DEF" ? "DST" : entity.position} · {entity.team}</small>
                </button>
              );
            })}
            {playerMatches.length === 0 ? <div className="advanced-player-no-results">No players match “{playerQuery.trim()}”.</div> : null}
          </div>
        ) : null}
      </div>

      {selected ? <>
      <div className="advanced-player-heading">
        <div>
          <div className="advanced-player-name">
            <h2>{selected.name}</h2>
            <span>{selected.position === "DEF" ? "DST" : selected.position}</span>
          </div>
          <p>{selected.team} · {games} game{games === 1 ? "" : "s"}{isRostered ? ` · ${shortLeagueName(league.name)}` : ""}</p>
        </div>
        <div className="advanced-heading-label"><strong>{selected.position === "DEF" ? "DST" : selected.position}</strong><span>percentile profile</span></div>
      </div>

      <div className="percentile-chart-heading">
        <div><strong>Strengths to weaknesses</strong><span>Percentile among positional peers</span></div>
        <span>100 = best</span>
      </div>
      <div className="percentile-chart" aria-label={`${selected.name} percentile ranks by advanced metric`}>
        {statRows.map(({ metric, value, rank, peerCount, percentile }) => {
          const tier = percentile >= 67 ? "strength" : percentile <= 33 ? "weakness" : "average";
          const rawValue = metricDisplay(value, metric);
          return (
            <div className={`percentile-row ${tier}`} key={metric.key}>
              <div className="percentile-label">
                <strong>{metric.label}</strong>
                <span>#{rank} of {peerCount}{metric.lowerIsBetter ? " · lower is better" : ""}</span>
              </div>
              <div
                className="percentile-bar"
                role="img"
                aria-label={`${metric.label}: ${percentile}${ordinalSuffix(percentile)} percentile, ${rawValue} per game, rank ${rank} of ${peerCount}`}
              >
                <i style={{ width: `${Math.max(2, percentile)}%` }} aria-hidden="true" />
                <span>{rawValue}<small> / game</small></span>
                <strong>{percentile}<small>{ordinalSuffix(percentile)}</small></strong>
              </div>
            </div>
          );
        })}
      </div>

      <p className="analytics-note">Percentiles compare per-game averages with every {selected.position === "DEF" ? "DST" : selected.position} in the selected window who has that stat. Higher percentile always means stronger performance; lower-is-better metrics are inverted. Tied values share a rank.</p>
      </> : null}
    </section>
  );
}

function AnalyticsChart({ dashboard, league, layout = "page", initialView = null, onSwitchDataset, playerLink, focusPlayer }: { dashboard: Dashboard; league: League; layout?: ChartLayout; initialView?: ChartHandoff | null; onSwitchDataset?: (dataset: ToolDataset, handoff: ChartHandoff) => void; playerLink?: PlayerLinkResolver; focusPlayer?: AnalyticsFocusPlayer | null }) {
  const monitorDefaultPreset = sharedSkillPresets.find((preset) => preset.label === "Usage vs Production") ?? sharedSkillPresets[0]!;
  const [position, setPosition] = useState<ChartPosition>("RB");
  const [window, setWindow] = useState<AnalyticsWindow>("season");
  const [xMetric, setXMetric] = useState(layout === "monitor" ? monitorDefaultPreset.x : defaultAnalyticsAxes.RB[0]);
  const [yMetric, setYMetric] = useState(layout === "monitor" ? monitorDefaultPreset.y : defaultAnalyticsAxes.RB[1]);
  const [chartKind, setChartKind] = useState<ChartKind>(layout === "monitor" ? (monitorDefaultPreset.kind ?? "scatter") : "scatter");
  const [plotLimit, setPlotLimit] = useState<PlotLimit>("40");
  const [showQuadrants, setShowQuadrants] = useState(true);
  const [xPercentile, setXPercentile] = useState(50);
  const [yPercentile, setYPercentile] = useState(50);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null);
  // Shareable chart links only carry the dataset (`?chart=`). Axes and saved
  // views are not in the URL, so the picker stays blank until the user chooses.
  // Monitor defaults into Usage vs Production so the inline chart matches Value chart.
  const [pickerMode, setPickerMode] = useState<ChartPickerMode>(layout === "monitor" ? "derived" : "blank");
  const [isChartOpen, setIsChartOpen] = useState(false);
  // The card must not open underneath the expanded-chart dialog, so following the link closes it first.
  const chartPlayerLink: PlayerLinkResolver | undefined = playerLink
    ? (ref) => {
      const link = playerLink(ref);
      return link ? { href: link.href, onOpen: () => { setIsChartOpen(false); link.onOpen(); } } : null;
    }
    : undefined;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);
  const metrics = chartAnalyticsMetrics(position, league);
  const presets = chartAnalyticsPresets(position);
  const positionOptions = chartPositionOptions(validPositions);
  const selectedX = metrics.find((metric) => metric.key === xMetric) ?? metrics[0];
  const selectedY = metrics.find((metric) => metric.key === yMetric) ?? metrics[1] ?? metrics[0];
  const config: SavedChartConfig = {
    dataset: "advanced",
    position: savedConfigPosition(position),
    xMetric: chartKind === "scatter" ? (selectedX?.key ?? xMetric) : xMetric,
    yMetric: chartKind === "scatter" ? (selectedY?.key ?? yMetric) : yMetric,
    window,
    showQuadrants,
    xPercentile,
    yPercentile,
    plotLimit,
  };

  function closeAdvancedControls() {
    setAdvancedOpen(false);
  }

  function choosePosition(nextPosition: ChartPosition) {
    if (layout === "monitor") {
      const nextPresets = chartAnalyticsPresets(nextPosition);
      const preferred = nextPresets.find((preset) => preset.label === "Usage vs Production") ?? nextPresets[0];
      setPosition(nextPosition);
      if (preferred) {
        setXMetric(preferred.x);
        setYMetric(preferred.y);
        setChartKind(preferred.kind ?? "scatter");
        setSelectedSavedViewId(null);
        setPickerMode("derived");
      } else {
        const [nextX, nextY] = chartAnalyticsAxes(nextPosition);
        setXMetric(nextX);
        setYMetric(nextY);
        setChartKind("scatter");
        setSelectedSavedViewId(null);
        setPickerMode("blank");
      }
      return;
    }
    const [nextX, nextY] = chartAnalyticsAxes(nextPosition);
    setPosition(nextPosition);
    setXMetric(nextX);
    setYMetric(nextY);
    setChartKind("scatter");
    setSelectedSavedViewId(null);
    setPickerMode("blank");
  }

  // When the league changes and the current position is no longer valid (e.g. a
  // K saved view carried over to Dynastical Cucks), reset to RB when valid,
  // otherwise the first valid position — with that position's default axes and
  // no selected saved view.
  useEffect(() => {
    if (positionOptions.includes(position)) return;
    choosePosition(validPositions.includes("RB") ? "RB" : validPositions[0] ?? "QB");
  }, [validPositions, positionOptions, position, choosePosition]);

  function applySavedView(view: SavedChartView) {
    if (view.dataset !== "advanced") return;
    if (!validPositions.includes(view.position)) return;
    const validMetrics = analyticsMetricsForLeague(view.position, league);
    const [fallbackX, fallbackY] = defaultAnalyticsAxes[view.position];
    setPosition(view.position);
    setXMetric(validMetrics.some((metric) => metric.key === view.xMetric) ? view.xMetric : fallbackX);
    setYMetric(validMetrics.some((metric) => metric.key === view.yMetric) ? view.yMetric : fallbackY);
    setChartKind("scatter");
    setWindow(view.window);
    setShowQuadrants(view.showQuadrants);
    setXPercentile(view.xPercentile);
    setYPercentile(view.yPercentile);
    setPlotLimit(view.plotLimit);
    setSelectedSavedViewId(view.id);
    setPickerMode("derived");
  }

  function applyBuiltInPreset(preset: ChartPreset) {
    setXMetric(preset.x);
    setYMetric(preset.y);
    setChartKind(preset.kind ?? "scatter");
    setSelectedSavedViewId(null);
    setPickerMode("derived");
    closeAdvancedControls();
  }

  // Opened from the other dataset's chart: keep its position and show the view picked there.
  const appliedHandoff = useRef(false);
  useEffect(() => {
    if (!initialView || appliedHandoff.current) return;
    appliedHandoff.current = true;
    if (initialView.savedView) {
      applySavedView(initialView.savedView);
      return;
    }
    if (positionOptions.includes(initialView.position)) choosePosition(initialView.position);
    if (initialView.preset) applyBuiltInPreset(initialView.preset);
  }, [initialView, positionOptions, applySavedView, choosePosition, applyBuiltInPreset]);
  const isTeamChart = chartKind === "heatmap" || chartKind === "team-scatter";

  const chartData = useMemo(() => {
    if (chartKind !== "scatter" || !selectedX || !selectedY) return [];
    const mapped = dashboard.analytics.entities
      .filter((entity) => inChartPosition(entity.position, position))
      .flatMap((entity): ChartDatum[] => {
        const source = window === "season" ? entity.season : entity.rolling17;
        const x = metricSourceValue(source, selectedX);
        const y = metricSourceValue(source, selectedY);
        if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return [];
        return [{
          id: entity.id,
          name: entity.name,
          label: analyticsLabel(entity),
          team: entity.team,
          games: window === "season" ? entity.seasonGames : entity.rollingGames,
          x,
          y,
          isSelectedTeam: isPlayerOnSelectedTeam(entity, league),
          position: entity.position,
        }];
      })
      .sort((a, b) => b.games - a.games || (Math.abs(b.x) + Math.abs(b.y)) - (Math.abs(a.x) + Math.abs(a.y)));
    if (plotLimit === "all") return mapped;
    const visible = mapped.slice(0, Number(plotLimit));
    const visibleIds = new Set(visible.map((row) => row.id));
    return [...visible, ...mapped.filter((row) => row.isSelectedTeam && !visibleIds.has(row.id))];
  }, [chartKind, dashboard.analytics.entities, league, plotLimit, position, selectedX, selectedY, window]);

  const snapTrendSeries = useMemo(() => {
    if (chartKind !== "snap-trend") return [];
    const mapped = dashboard.analytics.entities
      .filter((entity) => inChartPosition(entity.position, position) && (entity.weeklySnaps?.length ?? 0) > 0)
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        label: analyticsLabel(entity),
        team: entity.team,
        games: entity.weeklySnaps.length,
        avgSnap: entity.weeklySnaps.reduce((sum, point) => sum + point.snapShare, 0) / entity.weeklySnaps.length,
        points: entity.weeklySnaps,
        isSelectedTeam: isPlayerOnSelectedTeam(entity, league),
      }))
      .sort((a, b) => Number(b.isSelectedTeam) - Number(a.isSelectedTeam) || b.avgSnap - a.avgSnap);
    const limit = plotLimit === "all" ? mapped.length : Number(plotLimit);
    const selected = mapped.filter((row) => row.isSelectedTeam);
    const others = mapped.filter((row) => !row.isSelectedTeam).slice(0, limit);
    const combined = [...selected, ...others.filter((row) => !selected.some((item) => item.id === row.id))].slice(0, Math.max(limit, selected.length));
    return combined.map((row, index) => ({
      id: row.id,
      name: row.name,
      label: row.label,
      color: row.isSelectedTeam ? "var(--chart-team)" : SNAP_TREND_COLORS[index % SNAP_TREND_COLORS.length] ?? "var(--chart-2)",
      points: row.points,
    }));
  }, [chartKind, dashboard.analytics.entities, league, plotLimit, position]);

  const teamScatterData = useMemo(() => {
    if (chartKind !== "team-scatter") return [];
    const userTeams = new Set(
      [...league.starters, ...league.bench]
        .map((player) => player.team)
        .filter((team): team is string => Boolean(team)),
    );
    return dashboard.analytics.teamUsage.flatMap((usage): ChartDatum[] => {
      if (typeof usage.proe !== "number" || !Number.isFinite(usage.proe)) return [];
      return [{
        id: usage.team,
        name: usage.team,
        label: usage.team,
        team: usage.team,
        games: usage.games,
        x: usage.playsPerGame,
        y: usage.proe,
        isSelectedTeam: userTeams.has(usage.team),
      }];
    });
  }, [chartKind, dashboard.analytics.teamUsage, league.bench, league.starters]);

  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const xCutoff = percentileCutoff(chartData.map((row) => row.x), xPercentile, selectedX?.lowerIsBetter);
  const yCutoff = percentileCutoff(chartData.map((row) => row.y), yPercentile, selectedY?.lowerIsBetter);
  const leaders = selectedX && selectedY ? chartData.filter((row) => (selectedX.lowerIsBetter ? row.x <= xCutoff : row.x >= xCutoff) && (selectedY.lowerIsBetter ? row.y <= yCutoff : row.y >= yCutoff)) : [];
  const selectedTeamPlayers = chartData.filter((row) => row.isSelectedTeam);
  const selectedTeamIds = new Set(selectedTeamPlayers.map((row) => row.id));
  const leadersWithoutSelectedTeam = leaders.filter((row) => !row.isSelectedTeam);
  const leaderIds = new Set(leaders.map((row) => row.id));
  const others = chartData.filter((row) => !row.isSelectedTeam && !leaderIds.has(row.id));
  const labelData = plotLimit === "all" ? selectedTeamPlayers : chartData;
  const labeledIds = new Set(labelData.map((row) => row.id));
  const omittedNames = chartData.filter((row) => !labeledIds.has(row.id)).map((row) => row.name).sort((a, b) => a.localeCompare(b));

  const chartCount = (() => {
    switch (chartKind) {
      case "scatter":
        return chartData.length;
      case "snap-trend":
        return snapTrendSeries.length;
      case "heatmap":
        return Object.keys(sosEntry?.table ?? {}).length;
      case "team-scatter":
        return teamScatterData.length;
      default: {
        const _exhaustive: never = chartKind;
        return _exhaustive;
      }
    }
  })();

  // A link into the tool (a player's "Advanced stats"): open on their position with them selected in the expanded chart.
  const focusEntityId = focusPlayer
    ? dashboard.analytics.entities.find((entity) => entity.position === focusPlayer.position
      && isSamePlayer(entity, { name: focusPlayer.name, team: focusPlayer.team ?? "", position: entity.position }))?.id ?? null
    : null;
  const handledFocusId = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPlayer || layout !== "monitor" || handledFocusId.current === focusPlayer.id) return;
    const nextPosition = validPositions.find((item) => item === focusPlayer.position);
    if (!nextPosition) return;
    handledFocusId.current = focusPlayer.id;
    choosePosition(nextPosition);
    setChartKind("scatter");
    setPlotLimit("all");
    setIsChartOpen(true);
  }, [focusPlayer, layout, validPositions]);

  if (!dashboard.analytics.entities.length || !selectedX || !selectedY) {
    return (
      <section className={layout === "monitor" ? "monitor-builder-chart-empty" : "analytics-view"}>
        <div className="analytics-empty">
          <strong>No advanced stats yet.</strong>
          <span>Refresh after nflverse publishes the next weekly file.</span>
        </div>
      </section>
    );
  }

  const chartPlot = (showLabels: boolean) => (
    <>
      {chartKind === "snap-trend" ? (
        snapTrendSeries.length > 0
          ? <SnapShareTrendChart series={snapTrendSeries} ariaLabel={`${chartPositionLabel(position)} weekly offensive snap share`} />
          : <div className="analytics-empty"><strong>No snap share data yet.</strong></div>
      ) : null}
      {chartKind === "heatmap" ? (
        sosEntry?.table && Object.keys(sosEntry.table).length > 0
          ? <FpaHeatmap table={sosEntry.table} />
          : <div className="analytics-empty"><strong>No FPA data yet.</strong></div>
      ) : null}
      {chartKind === "team-scatter" ? (
        teamScatterData.length > 0
          ? <TeamScatterPlot data={teamScatterData} xShort="Plays/g" yShort="PROE" ariaLabel="Team pace versus pass rate over expected" showLabels={showLabels} compact={!showLabels && layout === "monitor"} />
          : <div className="analytics-empty"><strong>No pace or PROE data yet.</strong></div>
      ) : null}
      {chartKind === "scatter" && selectedX && selectedY ? (
        <>
          <ScatterPlot
            others={others}
            leadersWithoutSelectedTeam={leadersWithoutSelectedTeam}
            selectedTeamPlayers={selectedTeamPlayers}
            labelData={showLabels ? labelData : selectedTeamPlayers}
            leaderIds={leaderIds}
            selectedTeamIds={selectedTeamIds}
            highlightedId={selectedTeamPlayers[0]?.id ?? null}
            xAxis={{ short: selectedX.short, lowerIsBetter: selectedX.lowerIsBetter, titleSuffix: " / game" }}
            yAxis={{ short: selectedY.short, lowerIsBetter: selectedY.lowerIsBetter, titleSuffix: " / game" }}
            showQuadrants={showQuadrants}
            xCutoff={xCutoff}
            yCutoff={yCutoff}
            ariaLabel={`${chartPositionLabel(position)} scatter plot comparing ${selectedX.label} and ${selectedY.label}`}
            compact={!showLabels && layout === "monitor"}
            playerLink={chartPlayerLink}
            focusRequestId={showLabels ? focusEntityId : null}
          />
          <ChartKey teamName={fantasyTeamName(league)} />
          {layout === "page" && showLabels ? <OmittedChartLabels omittedNames={omittedNames} /> : null}
        </>
      ) : null}
    </>
  );

  const advancedControls = (
    <SavedViewControls
      dataset="advanced"
      presets={presets}
      validPositions={validPositions}
      config={config}
      pickerMode={pickerMode}
      selectedSavedViewId={selectedSavedViewId}
      onSelectedSavedViewIdChange={setSelectedSavedViewId}
      onApplySavedView={applySavedView}
      onApplyBuiltIn={applyBuiltInPreset}
      otherPresets={chartWeeklyPresets(position)}
      onSwitchDataset={onSwitchDataset ? (handoff) => onSwitchDataset("projections", { ...handoff, position }) : undefined}
      canSave={position !== "FLEX"}
      advancedOpen={advancedOpen}
      onAdvancedOpenChange={setAdvancedOpen}
      layout={layout}
    >
      <SegmentedControl
        className="lineup-mode-toggle analytics-window-toggle"
        value={window}
        onChange={(value) => { setWindow(value); setSelectedSavedViewId(null); setPickerMode("derived"); setChartKind("scatter"); }}
        label="Advanced stat window"
        options={[{ value: "season", label: "This season" }, { value: "rolling17", label: "Rolling 17 games" }]}
      />
      <div className="analytics-selectors advanced-only-selectors">
        <label><span>X axis</span><select aria-label="Choose horizontal axis" value={selectedX.key} onChange={(event) => { setXMetric(event.target.value); setChartKind("scatter"); setSelectedSavedViewId(null); setPickerMode("derived"); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
        <label><span>Y axis</span><select aria-label="Choose vertical axis" value={selectedY.key} onChange={(event) => { setYMetric(event.target.value); setChartKind("scatter"); setSelectedSavedViewId(null); setPickerMode("derived"); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
        <label className="plot-limit"><span>Players shown</span><select aria-label="Choose number of players shown" value={plotLimit} onChange={(event) => { setPlotLimit(event.target.value as PlotLimit); setSelectedSavedViewId(null); setPickerMode("derived"); }}><option value="24">Top 24 + my team</option><option value="40">Top 40 + my team</option><option value="all">All with data</option></select></label>
        <PercentileCutoffSelect axis="X" value={xPercentile} onChange={(value) => { setXPercentile(value); setSelectedSavedViewId(null); setPickerMode("derived"); }} />
        <PercentileCutoffSelect axis="Y" value={yPercentile} onChange={(value) => { setYPercentile(value); setSelectedSavedViewId(null); setPickerMode("derived"); }} />
      </div>
      <label className="chart-checkbox"><input type="checkbox" checked={showQuadrants} onChange={(event) => { setShowQuadrants(event.target.checked); setSelectedSavedViewId(null); setPickerMode("derived"); }} /><span>Show quadrant guides and percentile cutoffs</span></label>
    </SavedViewControls>
  );

  if (layout === "monitor") {
    return (
      <div className="monitor-builder-chart">
        <div className="monitor-value-chart-controls">
          {/* Team charts plot every team, so the position row would do nothing. */}
          {isTeamChart ? null : (
            <SegmentedControl
              className="monitor-chart-position"
              value={position}
              onChange={choosePosition}
              label="Chart position"
              options={positionOptions.map((item) => ({ value: item, label: chartPositionLabel(item) }))}
            />
          )}
          {advancedControls}
        </div>
        {pickerMode === "blank" ? (
          <p className="monitor-empty">Choose a view</p>
        ) : (
          <div
            className="monitor-value-chart monitor-chart-expand-target"
            role="button"
            tabIndex={0}
            aria-label="Open Analytics"
            onClick={() => setIsChartOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setIsChartOpen(true);
              }
            }}
          >
            {chartPlot(false)}
          </div>
        )}
        <ChartDialog
          isOpen={isChartOpen}
          onClose={() => setIsChartOpen(false)}
          title="Analytics"
          showCount={false}
          closeLabel="Close"
          className="monitor-chart-expand-card"
        >
          <div className="monitor-expanded-chart">{chartPlot(true)}</div>
        </ChartDialog>
      </div>
    );
  }

  return (
    <section className="analytics-view">
      <SegmentedControl
        className="analytics-position-tabs"
        value={position}
        onChange={choosePosition}
        label="Chart position"
        options={positionOptions.map((item) => ({ value: item, label: chartPositionLabel(item) }))}
      />

      {advancedControls}

      <button type="button" className="chart-open-button" disabled={pickerMode === "blank"} aria-disabled={pickerMode === "blank"} onClick={() => { if (pickerMode !== "blank") setIsChartOpen(true); }}>View chart</button>
      <ChartDialog
        isOpen={isChartOpen}
        onClose={() => setIsChartOpen(false)}
        title={chartKind === "heatmap" ? "FPA" : chartKind === "team-scatter" ? "Pace x PROE" : chartKind === "snap-trend" ? "Snap share" : `${chartPositionLabel(position)} field`}
        subtitle={chartKind === "scatter" ? `${window === "season" ? `${dashboard.season} games so far` : "Each player’s latest 17 games"} · per-game averages` : undefined}
        count={chartCount}
        countLabel={chartKind === "heatmap" || chartKind === "team-scatter" ? "teams" : position === "DEF" ? "teams" : "players"}
        showCount={chartKind !== "heatmap"}
      >
        {chartPlot(true)}
      </ChartDialog>
    </section>
  );
}

function pfnTeamRank(table: PfnTables[keyof PfnTables], team: string | null): number | undefined {
  if (!table || !team) return undefined;
  const normalizedTeam = team === "JAC" ? "JAX" : team === "LA" ? "LAR" : team === "LVR" || team === "OAK" ? "LV" : team === "WSH" ? "WAS" : team;
  const row = table.rows.find((candidate) => {
    const candidateTeam = candidate.team === "JAC" ? "JAX" : candidate.team === "LA" ? "LAR" : candidate.team === "LVR" || candidate.team === "OAK" ? "LV" : candidate.team === "WSH" ? "WAS" : candidate.team;
    return candidateTeam.toUpperCase() === normalizedTeam.toUpperCase();
  });
  return row?.rank;
}

function buildWeeklyEntities(dashboard: Dashboard, league: League, pfnTables?: PfnTables): WeeklyEntity[] {
  const leagueId = league.id;
  const leagueDefenses = dashboard.defenses.filter((row) => row.leagueId === leagueId);
  const leagueRankings = dashboard.weeklyChartRankings.filter((row) => row.leagueId === leagueId);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === leagueId);
  const marketRows = dashboard.seasonLongRankings
    .filter((row) => row.formatKey === league.seasonLongFormat.key && row.position !== "PICK")
    .sort((a, b) => a.position.localeCompare(b.position) || a.positionRank - b.positionRank);
  const marketByPlayerId = new Map(marketRows.map((row, index) => {
    const next = marketRows[index + 1];
    const tierCliff = next?.position === row.position ? Math.max(0, row.value - next.value) : 0;
    return [row.playerId, { value: row.value, positionRank: row.positionRank, tierCliff }] as const;
  }));
  const teamTotals = new Map<string, number>();
  for (const defense of leagueDefenses) {
    if (defense.opponentProjectedPoints !== null) teamTotals.set(defense.opponent, defense.opponentProjectedPoints);
  }
  const players: WeeklyEntity[] = leagueRankings.map((row) => {
    const values: Record<string, number> = {};
    if (row.leagueProjection !== null) values.league = row.leagueProjection;
    values.leaguePositionRank = row.leagueRank;
    if (row.vegasProjection !== null) values.vegasProjection = row.vegasProjection;
    if (row.sleeperProjection !== null) values.sleeperProjection = row.sleeperProjection;
    const market = marketByPlayerId.get(row.playerId);
    if (market) {
      values.fantasyCalcValue = market.value;
      values.fantasyCalcPositionRank = market.positionRank;
      values.tierCliff = market.tierCliff;
    }
    if (row.ppr !== null) values.ppr = row.ppr;
    if (row.halfPpr !== null) values.halfPpr = row.halfPpr;
    if (row.standard !== null) values.standard = row.standard;
    if (row.ppr !== null && row.standard !== null) values.receptionBonus = Number((row.ppr - row.standard).toFixed(2));
    const teamTotal = teamTotals.get(row.team);
    if (teamTotal !== undefined) values.teamTotal = teamTotal;
    const teamOffenseRank = pfnTeamRank(pfnTables?.offense ?? null, row.team);
    if (teamOffenseRank !== undefined) values.teamOffenseRank = teamOffenseRank;
    const teamOLineRank = pfnTeamRank(pfnTables?.["offensive-line"] ?? null, row.team);
    if (teamOLineRank !== undefined) values.teamOLineRank = teamOLineRank;
    const opponentDefenseRank = pfnTeamRank(pfnTables?.defense ?? null, row.opponent);
    if (opponentDefenseRank !== undefined) values.opponentDefenseRank = opponentDefenseRank;
    const matchupPosition = row.position === "QB" || row.position === "RB" || row.position === "WR" || row.position === "TE" ? row.position : null;
    const matchupPositionRank = matchupPosition && row.opponent
      ? sosEntry?.table[row.opponent]?.[matchupPosition]?.rank
      : undefined;
    if (matchupPositionRank !== undefined) values.matchupPositionRank = matchupPositionRank;
    // Underlying Vegas stat projections (targets/receptions/yards/TDs) for the
    // comparison tool's stat-breakdown rows. Prefixed so they never collide
    // with the fantasy-point value keys above.
    if (row.projectionComponents) {
      for (const [statKey, statValue] of Object.entries(row.projectionComponents)) {
        if (typeof statValue === "number" && Number.isFinite(statValue)) {
          values[`stat_${statKey}`] = statValue;
        }
      }
    }
    return {
      id: `${row.position}:${row.playerId}`,
      playerId: row.playerId,
      name: row.name,
      team: row.team,
      position: row.position,
      opponent: row.opponent,
      isAway: row.isAway,
      isBye: row.isBye,
      gameTime: row.gameTime,
      gamePhase: null,
      values,
    };
  });
  const defenses: WeeklyEntity[] = leagueDefenses.map((row) => {
    const values: Record<string, number> = {};
    if (row.displayProjection !== null) values.projection = row.displayProjection;
    if (row.opponentProjectedPoints !== null) values.opponentTotal = row.opponentProjectedPoints;
    return {
      id: `DEF:${row.team}`,
      playerId: row.team,
      name: `${row.team} Defense`,
      team: row.team,
      position: "DEF",
      opponent: row.opponent,
      isAway: row.isAway,
      isBye: false,
      gameTime: row.gameTime,
      gamePhase: row.gamePhase ?? null,
      values,
    };
  });
  return [...players, ...defenses];
}

function TierCliffPlot({ data }: { data: ChartDatum[] }) {
  const rows = data.slice().sort((a, b) => a.x - b.x).slice(0, 24);
  const gaps = rows.map((row, index) => Math.max(0, row.y - (rows[index + 1]?.y ?? row.y)));
  const maxGap = Math.max(0.1, ...gaps);
  return (
    <ol className="tier-cliff-list" aria-label="Weekly projected points by positional rank, with drops to the next player">
      {rows.map((row, index) => {
        const gap = gaps[index] ?? 0;
        return <li key={row.id}>
          <span className="tier-cliff-rank">{Math.round(row.x)}</span>
          <span className="tier-cliff-player"><strong>{row.name}</strong><small>{row.team} · {formatDecimal(row.y, 1)} projected</small></span>
          <span className="tier-cliff-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (gap / maxGap) * 100)}%` }} /></span>
          <strong className="tier-cliff-drop">−{formatDecimal(gap, 1)}</strong>
        </li>;
      })}
    </ol>
  );
}

function BoomBustRangePlot({ data, entities }: { data: ChartDatum[]; entities: WeeklyEntity[] }) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const rows = data.slice().sort((a, b) => b.x - a.x).slice(0, 24);
  const maxCeiling = Math.max(1, ...rows.map((row) => byId.get(row.id)?.values.boomBustCeiling ?? 0));
  return (
    <ol className="boom-bust-range-list" aria-label="Weekly projections positioned within each player's 2026 scoring floor and ceiling">
      {rows.map((row) => {
        const values = byId.get(row.id)?.values;
        const floor = values?.boomBustFloor;
        const ceiling = values?.boomBustCeiling;
        if (typeof floor !== "number" || typeof ceiling !== "number") return null;
        const left = Math.max(0, Math.min(100, (floor / maxCeiling) * 100));
        const width = Math.max(2, Math.min(100 - left, ((ceiling - floor) / maxCeiling) * 100));
        const projection = Math.max(0, Math.min(100, (row.x / maxCeiling) * 100));
        return <li className="boom-bust-range-row" key={row.id}>
          <span className="boom-bust-player"><strong>{row.name}</strong><small>{row.team}</small></span>
          <span className="boom-bust-track" aria-hidden="true">
            <i className="boom-bust-band" style={{ left: `${left}%`, width: `${width}%` }} />
            <i className="boom-bust-projection" style={{ left: `${projection}%` }} />
          </span>
          <span className="boom-bust-values"><strong>{formatDecimal(row.x, 1)}<span className="sr-only"> projected points</span></strong><small><span className="sr-only">2026 scoring range </span>{formatDecimal(floor, 1)}–{formatDecimal(ceiling, 1)}</small></span>
        </li>;
      })}
    </ol>
  );
}

function WeeklyProjections({ dashboard, league, view, selectedPlayer = null, onSelectedPlayerChange, layout = "page", initialView = null, onSwitchDataset, playerLink }: { dashboard: Dashboard; league: League; view: "charts" | "percentiles"; selectedPlayer?: PlayerSelection | null; onSelectedPlayerChange?: (player: PlayerSelection | null) => void; layout?: ChartLayout; initialView?: ChartHandoff | null; onSwitchDataset?: (dataset: ToolDataset, handoff: ChartHandoff) => void; playerLink?: PlayerLinkResolver }) {
  const entities = useMemo(() => buildWeeklyEntities(dashboard, league), [dashboard, league.id]);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const [playerQuery, setPlayerQuery] = useState("");
  const monitorDefaultPreset = projectionPresets[0]!;
  const [position, setPosition] = useState<ChartPosition>("RB");
  const [xMetric, setXMetric] = useState(layout === "monitor" ? monitorDefaultPreset.x : defaultWeeklyAxes.RB[0]);
  const [yMetric, setYMetric] = useState(layout === "monitor" ? monitorDefaultPreset.y : defaultWeeklyAxes.RB[1]);
  const [plotLimit, setPlotLimit] = useState<PlotLimit>("40");
  const [showQuadrants, setShowQuadrants] = useState(true);
  const [xPercentile, setXPercentile] = useState(50);
  const [yPercentile, setYPercentile] = useState(50);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null);
  // Shareable chart links only carry the dataset (`?chart=`). Axes and saved
  // views are not in the URL, so the picker stays blank until the user chooses.
  const [pickerMode, setPickerMode] = useState<ChartPickerMode>(layout === "monitor" ? "derived" : "blank");
  const [isChartOpen, setIsChartOpen] = useState(false);
  // The card must not open underneath the expanded-chart dialog, so following the link closes it first.
  const chartPlayerLink: PlayerLinkResolver | undefined = playerLink
    ? (ref) => {
      const link = playerLink(ref);
      return link ? { href: link.href, onOpen: () => { setIsChartOpen(false); link.onOpen(); } } : null;
    }
    : undefined;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);
  const selected = selectedPlayer ? entities.find((entity) => isSamePlayer(entity, selectedPlayer)) : undefined;
  const matches = useMemo(() => {
    const needle = comparablePlayerName(playerQuery.trim());
    if (!needle) return [];
    return entities
      .filter((entity) => validPositions.includes(entity.position))
      .filter((entity) => comparablePlayerName(entity.name).includes(needle))
      .sort((a, b) => {
        const aName = comparablePlayerName(a.name);
        const bName = comparablePlayerName(b.name);
        const aPriority = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
        const bPriority = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
        return aPriority - bPriority || a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }, [entities, playerQuery, validPositions]);

  const selectedMetrics = selected ? weeklyMetrics[selected.position] : [];
  const profileRows = useMemo(() => {
    if (!selected) return [];
    return weeklyMetrics[selected.position].flatMap((metric, metricIndex) => {
      const value = selected.values[metric.key];
      if (typeof value !== "number" || !Number.isFinite(value)) return [];
      const peerValues = entities
        .filter((entity) => entity.position === selected.position)
        .map((entity) => entity.values[metric.key])
        .filter((peerValue): peerValue is number => typeof peerValue === "number" && Number.isFinite(peerValue));
      const rank = 1 + peerValues.filter((peerValue) => metric.lowerIsBetter ? peerValue < value : peerValue > value).length;
      const percentile = peerValues.length <= 1 ? 100 : Math.round(((peerValues.length - rank) / (peerValues.length - 1)) * 100);
      return [{ metric, value, rank, peerCount: peerValues.length, percentile, metricIndex }];
    }).sort((a, b) => b.percentile - a.percentile || a.metricIndex - b.metricIndex);
  }, [entities, selected]);

  const metrics = chartWeeklyMetrics(position);
  const presets = chartWeeklyPresets(position);
  const positionOptions = chartPositionOptions(validPositions);
  const selectedX = metrics.find((metric) => metric.key === xMetric) ?? metrics[0];
  const selectedY = metrics.find((metric) => metric.key === yMetric) ?? metrics[1] ?? metrics[0];
  const isTierCliffView = selectedX?.key === "leaguePositionRank" && selectedY?.key === "league";
  const isBoomBustView = selectedX?.key === "league" && selectedY?.key === "boomBustRange";
  const boomBustPlayerIds = useMemo(() => entities
    .filter((entity) => inChartPosition(entity.position, position) && typeof entity.values.league === "number")
    .sort((a, b) => (b.values.league ?? 0) - (a.values.league ?? 0))
    .slice(0, 24)
    .map((entity) => entity.playerId), [entities, position]);
  const boomBustRangesQuery = useQuery({
    queryKey: ["projection-boom-bust-ranges", league.id, position, boomBustPlayerIds],
    queryFn: () => api.getBoomBustRanges({ leagueId: league.id, position: position as "QB" | "RB" | "WR" | "TE", playerIds: boomBustPlayerIds }),
    enabled: view === "charts" && isBoomBustView && position !== "K" && position !== "DEF" && position !== "FLEX" && boomBustPlayerIds.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const chartEntities = useMemo(() => {
    if (!boomBustRangesQuery.data) return entities;
    const ranges = new Map(boomBustRangesQuery.data.rows.map((row) => [row.playerId, row]));
    return entities.map((entity) => {
      const range = ranges.get(entity.playerId);
      if (!range) return entity;
      return { ...entity, values: { ...entity.values, boomBustFloor: range.floor, boomBustCeiling: range.ceiling, boomBustRange: range.range } };
    });
  }, [boomBustRangesQuery.data, entities]);
  const config: SavedChartConfig = {
    dataset: "projections",
    position: savedConfigPosition(position),
    xMetric: selectedX?.key ?? xMetric,
    yMetric: selectedY?.key ?? yMetric,
    window: "season",
    showQuadrants,
    xPercentile,
    yPercentile,
    plotLimit,
  };

  function closeAdvancedControls() {
    setAdvancedOpen(false);
  }

  function choosePosition(nextPosition: ChartPosition) {
    if (layout === "monitor") {
      const nextPresets = chartWeeklyPresets(nextPosition);
      const preferred = nextPresets[0];
      setPosition(nextPosition);
      if (preferred) {
        setXMetric(preferred.x);
        setYMetric(preferred.y);
        setSelectedSavedViewId(null);
        setPickerMode("derived");
      } else {
        const [nextX, nextY] = chartWeeklyAxes(nextPosition);
        setXMetric(nextX);
        setYMetric(nextY);
        setSelectedSavedViewId(null);
        setPickerMode("blank");
      }
      return;
    }
    const [nextX, nextY] = chartWeeklyAxes(nextPosition);
    setPosition(nextPosition);
    setXMetric(nextX);
    setYMetric(nextY);
    setSelectedSavedViewId(null);
    setPickerMode("blank");
  }

  // When the league changes and the current position is no longer valid, reset
  // to RB when valid, otherwise the first valid position — with that position's
  // default axes and no selected saved view.
  useEffect(() => {
    if (positionOptions.includes(position)) return;
    choosePosition(validPositions.includes("RB") ? "RB" : validPositions[0] ?? "QB");
  }, [validPositions, positionOptions, position, choosePosition]);

  function applySavedView(view: SavedChartView) {
    if (view.dataset !== "projections") return;
    if (!validPositions.includes(view.position)) return;
    const validMetrics = weeklyMetrics[view.position];
    const [fallbackX, fallbackY] = defaultWeeklyAxes[view.position];
    setPosition(view.position);
    setXMetric(validMetrics.some((metric) => metric.key === view.xMetric) ? view.xMetric : fallbackX);
    setYMetric(validMetrics.some((metric) => metric.key === view.yMetric) ? view.yMetric : fallbackY);
    setShowQuadrants(view.showQuadrants);
    setXPercentile(view.xPercentile);
    setYPercentile(view.yPercentile);
    setPlotLimit(view.plotLimit);
    setSelectedSavedViewId(view.id);
    setPickerMode("derived");
  }

  function applyBuiltInPreset(preset: ChartPreset) {
    setXMetric(preset.x);
    setYMetric(preset.y);
    setSelectedSavedViewId(null);
    setPickerMode("derived");
    closeAdvancedControls();
  }

  // Opened from the other dataset's chart: keep its position and show the view picked there.
  const appliedHandoff = useRef(false);
  useEffect(() => {
    if (!initialView || appliedHandoff.current) return;
    appliedHandoff.current = true;
    if (initialView.savedView) {
      applySavedView(initialView.savedView);
      return;
    }
    if (positionOptions.includes(initialView.position)) choosePosition(initialView.position);
    if (initialView.preset) applyBuiltInPreset(initialView.preset);
  }, [initialView, positionOptions, applySavedView, choosePosition, applyBuiltInPreset]);
  const chartData = useMemo(() => {
    if (!selectedX || !selectedY) return [];
    const mapped = chartEntities
      .filter((entity) => inChartPosition(entity.position, position))
      .flatMap((entity): ChartDatum[] => {
        const x = entity.values[selectedX.key];
        const y = entity.values[selectedY.key];
        if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return [];
        return [{
          id: entity.id,
          name: entity.name,
          label: analyticsLabel(entity),
          team: entity.team,
          games: 1,
          x,
          y,
          isSelectedTeam: isPlayerOnSelectedTeam(entity, league),
          playerId: entity.playerId,
          position: entity.position,
        }];
      })
      .sort((a, b) => (selectedY.lowerIsBetter ? a.y - b.y : b.y - a.y) || (selectedX.lowerIsBetter ? a.x - b.x : b.x - a.x));
    if (plotLimit === "all") return mapped;
    const visible = mapped.slice(0, Number(plotLimit));
    const visibleIds = new Set(visible.map((row) => row.id));
    return [...visible, ...mapped.filter((row) => row.isSelectedTeam && !visibleIds.has(row.id))];
  }, [chartEntities, league, plotLimit, position, selectedX, selectedY]);
  const xCutoff = percentileCutoff(chartData.map((row) => row.x), xPercentile, selectedX?.lowerIsBetter);
  const yCutoff = percentileCutoff(chartData.map((row) => row.y), yPercentile, selectedY?.lowerIsBetter);
  const leaders = selectedX && selectedY ? chartData.filter((row) => (
    (selectedX.lowerIsBetter ? row.x <= xCutoff : row.x >= xCutoff)
    && (selectedY.lowerIsBetter ? row.y <= yCutoff : row.y >= yCutoff)
  )) : [];
  const selectedTeamPlayers = chartData.filter((row) => row.isSelectedTeam);
  const selectedTeamIds = new Set(selectedTeamPlayers.map((row) => row.id));
  const leaderIds = new Set(leaders.map((row) => row.id));
  const leadersWithoutSelectedTeam = leaders.filter((row) => !row.isSelectedTeam);
  const others = chartData.filter((row) => !row.isSelectedTeam && !leaderIds.has(row.id));
  const labelData = plotLimit === "all" ? selectedTeamPlayers : chartData;
  const labeledIds = new Set(labelData.map((row) => row.id));
  const omittedNames = chartData.filter((row) => !labeledIds.has(row.id)).map((row) => row.name).sort((a, b) => a.localeCompare(b));

  const hasProjections = entities.length > 0;
  if (!selectedX || !selectedY || (!hasProjections && layout !== "monitor")) {
    return <section className="weekly-projections-view"><div className="analytics-empty"><strong>No weekly projections yet.</strong><span>Refresh to check the latest Vegas lines and nflverse usage data.</span></div></section>;
  }

  const choosePlayer = (entity: WeeklyEntity) => {
    onSelectedPlayerChange?.({ name: entity.name, team: entity.team, position: entity.position });
    setPlayerQuery("");
  };

  return (
    <section className="weekly-projections-view">
      {view === "percentiles" ? <>
      <div className="advanced-player-picker">
        <label htmlFor="weekly-player-search">Player</label>
        <div className="search-field advanced-player-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            id="weekly-player-search"
            type="search"
            aria-label="Search weekly projection players"
            value={playerQuery}
            onChange={(event) => setPlayerQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const firstMatch = matches[0];
                if (firstMatch) { event.preventDefault(); choosePlayer(firstMatch); }
              } else if (event.key === "Escape") {
                setPlayerQuery("");
              }
            }}
            name="player-search"
            placeholder={selected ? `Search to replace ${selected.name}…` : "Search players…"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {playerQuery ? <button className="search-clear" type="button" onClick={() => setPlayerQuery("")} aria-label="Clear weekly projection player search">×</button> : null}
        </div>
        {playerQuery.trim() ? (
          <div className="advanced-player-results inline-search-results" aria-label="Matching weekly projection players" aria-live="polite">
            {matches.map((entity) => (
              <button type="button" aria-current={selectedPlayer && isSamePlayer(entity, selectedPlayer) ? "true" : undefined} className={selectedPlayer && isSamePlayer(entity, selectedPlayer) ? "is-selected" : ""} key={entity.id} onClick={() => choosePlayer(entity)}>
                <span><strong>{entity.name}</strong></span>
                <small>{entity.position === "DEF" ? "DST" : entity.position} · {entity.team}</small>
              </button>
            ))}
            {matches.length === 0 ? <div className="advanced-player-no-results">No players match “{playerQuery.trim()}”.</div> : null}
          </div>
        ) : null}
      </div>

      {selected ? (
        <>
          <div className="advanced-player-heading">
            <div><div className="advanced-player-name"><h2>{selected.name}</h2><span>{selected.position === "DEF" ? "DST" : selected.position}</span></div><p><MatchupTag team={selected.team} opponent={selected.opponent} isAway={selected.isAway} isBye={selected.isBye} position={selected.position} entry={sosEntry} /></p></div>
            <div className="advanced-heading-label"><strong>W{dashboard.week}</strong><span>percentile profile</span></div>
          </div>
          <div className="percentile-chart-heading"><div><strong>Strengths to weaknesses</strong><span>Percentile among positional peers</span></div><span>100 = best</span></div>
          <div className="percentile-chart" aria-label={`${selected.name} weekly projection percentile ranks`}>
            {profileRows.map(({ metric, value, rank, peerCount, percentile }) => (
              <div className={`percentile-row ${percentile >= 67 ? "strength" : percentile <= 33 ? "weakness" : "average"}`} key={metric.key}>
                <div className="percentile-label"><strong>{metric.label}</strong><span>#{rank} of {peerCount}{metric.lowerIsBetter ? " · lower is better" : ""}</span></div>
                <div className="percentile-bar" role="img" aria-label={`${metric.label}: ${percentile}${ordinalSuffix(percentile)} percentile, ${metricDisplay(value, metric)}, rank ${rank} of ${peerCount}`}>
                  <i style={{ width: `${Math.max(2, percentile)}%` }} aria-hidden="true" />
                  <span>{metricDisplay(value, metric)}</span><strong>{percentile}<small>{ordinalSuffix(percentile)}</small></strong>
                </div>
              </div>
            ))}
          </div>
          {selectedMetrics.length === 0 ? <div className="empty-inline">No weekly projection metrics are available for this player.</div> : null}
          <p className="analytics-note">Percentiles compare this week’s projection inputs with every {selected.position === "DEF" ? "DST" : selected.position}. Higher is better unless the metric says otherwise.</p>
        </>
      ) : null}
      </> : null}

      {view === "charts" ? (() => {
        const weeklyPlot = (showLabels: boolean) => (
          isTierCliffView ? (
            <TierCliffPlot data={chartData} />
          ) : isBoomBustView ? (
            boomBustRangesQuery.isPending
              ? <div className="analytics-empty"><strong>Loading scoring ranges…</strong><span>Reading each player’s 2026 weekly results from Sleeper.</span></div>
              : chartData.length > 0
                ? <BoomBustRangePlot data={chartData} entities={chartEntities} />
                : <div className="analytics-empty"><strong>No scoring ranges yet.</strong><span>At least two played games are required for a floor-to-ceiling range.</span></div>
          ) : (
            <>
            <ScatterPlot
              others={others}
              leadersWithoutSelectedTeam={leadersWithoutSelectedTeam}
              selectedTeamPlayers={selectedTeamPlayers}
              labelData={showLabels ? labelData : selectedTeamPlayers}
              leaderIds={leaderIds}
              selectedTeamIds={selectedTeamIds}
              highlightedId={selectedTeamPlayers[0]?.id ?? null}
              xAxis={{ short: selectedX.short, lowerIsBetter: selectedX.lowerIsBetter, titleSuffix: "" }}
              yAxis={{ short: selectedY.short, lowerIsBetter: selectedY.lowerIsBetter, titleSuffix: "" }}
              showQuadrants={showQuadrants}
              xCutoff={xCutoff}
              yCutoff={yCutoff}
              ariaLabel={`${chartPositionLabel(position)} weekly projection scatter plot comparing ${selectedX.label} and ${selectedY.label}`}
              compact={!showLabels && layout === "monitor"}
              playerLink={chartPlayerLink}
            />
            <ChartKey teamName={fantasyTeamName(league)} />
            {layout === "page" && showLabels ? <OmittedChartLabels omittedNames={omittedNames} /> : null}
            </>
          )
        );
        const weeklyControls = (
          <SavedViewControls
            dataset="projections"
            presets={presets}
            validPositions={validPositions}
            config={config}
            pickerMode={pickerMode}
            selectedSavedViewId={selectedSavedViewId}
            onSelectedSavedViewIdChange={setSelectedSavedViewId}
            onApplySavedView={applySavedView}
            onApplyBuiltIn={applyBuiltInPreset}
            otherPresets={chartAnalyticsPresets(position)}
            onSwitchDataset={onSwitchDataset ? (handoff) => onSwitchDataset("advanced", { ...handoff, position }) : undefined}
            canSave={position !== "FLEX"}
            advancedOpen={advancedOpen}
            onAdvancedOpenChange={setAdvancedOpen}
            layout={layout}
          >
            <div className="analytics-selectors advanced-only-selectors">
              <label><span>X axis</span><select aria-label="Choose weekly horizontal axis" value={selectedX.key} onChange={(event) => { setXMetric(event.target.value); setSelectedSavedViewId(null); setPickerMode("derived"); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
              <label><span>Y axis</span><select aria-label="Choose weekly vertical axis" value={selectedY.key} onChange={(event) => { setYMetric(event.target.value); setSelectedSavedViewId(null); setPickerMode("derived"); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
              <label className="plot-limit"><span>Players shown</span><select aria-label="Choose weekly players shown" value={plotLimit} onChange={(event) => { setPlotLimit(event.target.value as PlotLimit); setSelectedSavedViewId(null); setPickerMode("derived"); }}><option value="24">Top 24 + my team</option><option value="40">Top 40 + my team</option><option value="all">All with data</option></select></label>
              <PercentileCutoffSelect axis="X" value={xPercentile} onChange={(value) => { setXPercentile(value); setSelectedSavedViewId(null); setPickerMode("derived"); }} />
              <PercentileCutoffSelect axis="Y" value={yPercentile} onChange={(value) => { setYPercentile(value); setSelectedSavedViewId(null); setPickerMode("derived"); }} />
            </div>
            <label className="chart-checkbox"><input type="checkbox" checked={showQuadrants} onChange={(event) => { setShowQuadrants(event.target.checked); setSelectedSavedViewId(null); setPickerMode("derived"); }} /><span>Show quadrant guides and percentile cutoffs</span></label>
          </SavedViewControls>
        );

        if (layout === "monitor") {
          return (
            <div className="monitor-builder-chart">
              <div className="monitor-value-chart-controls">
                <SegmentedControl
                  className="monitor-chart-position"
                  value={position}
                  onChange={choosePosition}
                  label="Weekly chart position"
                  options={positionOptions.map((item) => ({ value: item, label: chartPositionLabel(item) }))}
                />
                {weeklyControls}
              </div>
              {pickerMode === "blank" ? (
                <p className="monitor-empty">Choose a view</p>
              ) : !hasProjections ? (
                <div className="analytics-empty"><strong>No weekly projections yet.</strong><span>Refresh to check the latest Vegas lines and nflverse usage data.</span></div>
              ) : (
                <div
                  className="monitor-value-chart monitor-chart-expand-target"
                  role="button"
                  tabIndex={0}
                  aria-label="Open Analytics"
                  onClick={() => setIsChartOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setIsChartOpen(true);
                    }
                  }}
                >
                  {weeklyPlot(false)}
                </div>
              )}
              <ChartDialog
                isOpen={isChartOpen}
                onClose={() => setIsChartOpen(false)}
                title="Analytics"
                showCount={false}
                closeLabel="Close"
                className="monitor-chart-expand-card"
              >
                <div className="monitor-expanded-chart">{weeklyPlot(true)}</div>
              </ChartDialog>
            </div>
          );
        }

        return (
          <>
            <SegmentedControl className="analytics-position-tabs" value={position} onChange={choosePosition} label="Weekly chart position" options={positionOptions.map((item) => ({ value: item, label: chartPositionLabel(item) }))} />
            {weeklyControls}
            <button type="button" className="chart-open-button" disabled={pickerMode === "blank"} aria-disabled={pickerMode === "blank"} onClick={() => { if (pickerMode !== "blank") setIsChartOpen(true); }}>View chart</button>
            <ChartDialog
              isOpen={isChartOpen}
              onClose={() => setIsChartOpen(false)}
              title={`${chartPositionLabel(position)} field`}
              subtitle={`Week ${dashboard.week} projections`}
              count={chartData.length}
              countLabel={position === "DEF" ? "teams" : "players"}
            >
              {weeklyPlot(true)}
            </ChartDialog>
          </>
        );
      })() : null}
    </section>
  );
}

export function ChartsTool({ dashboard, league, dataset = "advanced", onDatasetChange, playerLink, focusPlayer }: { dashboard: Dashboard; league: League; dataset?: ToolDataset; onDatasetChange?: (dataset: ToolDataset) => void; onOpenMatchup?: (matchup: MatchupSelection) => void; layout?: ChartLayout; playerLink?: PlayerLinkResolver; focusPlayer?: AnalyticsFocusPlayer | null }) {
  // One Saved view list covers both datasets; picking a view from the other one
  // switches charts and hands over the position and the view.
  const [handoff, setHandoff] = useState<ChartHandoff | null>(null);
  const switchDataset = onDatasetChange
    ? (next: ToolDataset, nextHandoff: ChartHandoff) => {
      setHandoff(nextHandoff);
      onDatasetChange(next);
    }
    : undefined;
  return (
    <section className="monitor-section monitor-builder-chart-panel">
      <header className="sr-only">
        <h2>Analytics</h2>
      </header>
      {dataset === "advanced"
        ? <AnalyticsChart dashboard={dashboard} league={league} layout="monitor" initialView={handoff} onSwitchDataset={switchDataset} playerLink={playerLink} focusPlayer={focusPlayer} />
        : <WeeklyProjections dashboard={dashboard} league={league} view="charts" layout="monitor" initialView={handoff} onSwitchDataset={switchDataset} playerLink={playerLink} />}
    </section>
  );
}

type ComparisonEntity = PlayerSelection & {
  id: string;
  opponent: string | null;
  isAway: boolean | null;
  isBye: boolean;
  gameTime: string | null;
  gamePhase: MatchupSelection["gamePhase"];
  values: Record<string, number>;
};

type ComparisonMetricValue = {
  value: number;
};

function gameTimeLabel(value: string | null): string {
  if (!value) return "Kickoff time not posted";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Kickoff time not posted";
  const hasClock = /T\d{2}:\d{2}/.test(value);
  return new Intl.DateTimeFormat(undefined, hasClock
    ? { weekday: "short", hour: "numeric", minute: "2-digit" }
    : { weekday: "short" }).format(date);
}

function comparisonValue(entity: ComparisonEntity | undefined, metric: Metric): ComparisonMetricValue | null {
  if (!entity) return null;
  const value = metricSourceValue(entity.values, metric);
  return typeof value === "number" && Number.isFinite(value) ? { value } : null;
}

type ComparisonRow = {
  metric: Metric;
  leftValue: ComparisonMetricValue | null;
  rightValue: ComparisonMetricValue | null;
};

// Display order for the comparison cards, grouped the way the card is
// read: headline numbers, the stat line behind them, team context, then
// market/value (projections); production, usage shares, then efficiency
// (advanced). Metrics not listed keep their catalog order at the end.
const comparisonRowOrder: Record<"projections" | "advanced", Record<BasePosition, string[]>> = {
  projections: {
    QB: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "stat_pass_yd", "stat_pass_td", "stat_pass_int", "stat_rush_yd", "stat_rush_td",
      "teamTotal", "teamOffenseRank", "teamOLineRank", "opponentDefenseRank", "matchupPositionRank",
      "fantasyCalcValue", "fantasyCalcPositionRank", "tierCliff", "boomBustRange",
    ],
    RB: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "stat_rush_yd", "stat_rush_td", "stat_rec", "stat_rec_yd", "stat_rec_td",
      "teamTotal", "teamOffenseRank", "teamOLineRank", "opponentDefenseRank", "matchupPositionRank",
      "fantasyCalcValue", "fantasyCalcPositionRank", "tierCliff", "boomBustRange",
    ],
    WR: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "stat_rec", "stat_rec_yd", "stat_rec_td", "stat_rush_yd", "stat_rush_td",
      "teamTotal", "teamOffenseRank", "teamOLineRank", "opponentDefenseRank", "matchupPositionRank",
      "fantasyCalcValue", "fantasyCalcPositionRank", "tierCliff", "boomBustRange",
    ],
    TE: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "stat_rec", "stat_rec_yd", "stat_rec_td", "stat_rush_yd", "stat_rush_td",
      "teamTotal", "teamOffenseRank", "teamOLineRank", "opponentDefenseRank", "matchupPositionRank",
      "fantasyCalcValue", "fantasyCalcPositionRank", "tierCliff", "boomBustRange",
    ],
    K: [
      "league", "sleeperProjection", "leaguePositionRank",
      "teamTotal", "teamOffenseRank", "teamOLineRank", "opponentDefenseRank", "matchupPositionRank",
      "fantasyCalcValue", "fantasyCalcPositionRank",
    ],
    DEF: ["projection", "opponentTotal"],
  },
  advanced: {
    QB: [
      "fantasy_league",
      "pass_attempts", "completions", "passing_yards", "passing_tds", "interceptions", "passing_air_yards",
      "carries", "rushing_yards", "rushing_tds",
      "opportunity", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "completion_pct", "cpoe", "passing_epa", "epa_per_play",
    ],
    RB: [
      "fantasy_league",
      "touches", "carries", "rushing_yards", "rushing_tds",
      "targets", "receptions", "receiving_yards", "receiving_tds", "scrimmage_yards",
      "target_share", "carry_share", "rb_target_share", "opportunity", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "rushing_epa", "receiving_epa",
    ],
    WR: [
      "fantasy_league",
      "targets", "receptions", "receiving_yards", "receiving_tds", "receiving_air_yards", "yards_after_catch",
      "target_share", "air_yards_share", "opportunity", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "wopr", "racr", "receiving_epa",
    ],
    TE: [
      "fantasy_league",
      "targets", "receptions", "receiving_yards", "receiving_tds", "receiving_air_yards", "yards_after_catch",
      "target_share", "air_yards_share", "opportunity", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "wopr", "racr", "receiving_epa",
    ],
    K: ["fg_attempts", "fg_made", "fg_pct", "fg_40_plus", "fg_50_plus", "pat_attempts", "pat_made", "kicks_made"],
    DEF: [
      "qb_hits", "takeaways", "sacks", "defensive_tds",
      "interceptions", "forced_fumbles", "fumble_recoveries", "tackles_for_loss", "passes_defended", "blocked_kicks", "safeties",
    ],
  },
};

function comparisonBarShares(row: ComparisonRow): [number, number] {
  const left = row.leftValue?.value;
  const right = row.rightValue?.value;
  if (left === undefined || right === undefined || left === right) return [50, 50];

  const leftWins = row.metric.lowerIsBetter ? left < right : left > right;
  const distance = Math.abs(left - right);
  const scale = Math.max(Math.abs(left) + Math.abs(right), distance, 1);
  const leaderShare = Math.min(76, 50 + (distance / scale) * 50);
  return leftWins ? [leaderShare, 100 - leaderShare] : [100 - leaderShare, leaderShare];
}

// The card's lead number: league fantasy points (advanced) or the league projection.
const comparisonHeadlineKeys = new Set(["fantasy_league", "league", "projection"]);

type ComparisonGroup = "Projection" | "Stat line" | "Team context" | "Market" | "Production" | "Usage" | "Efficiency";

const comparisonUsageKeys = new Set([
  "touches", "carries", "targets", "pass_attempts", "opportunity", "opportunity_share", "snap_share",
  "rz_target_share", "rz_carry_share", "target_share", "carry_share", "rb_target_share", "air_yards_share", "wopr",
  "fg_attempts", "pat_attempts",
]);
const comparisonEfficiencyKeys = new Set(["completion_pct", "cpoe", "passing_epa", "rushing_epa", "receiving_epa", "epa_per_play", "racr", "fg_pct"]);
const comparisonTeamContextKeys = new Set(["teamTotal", "teamOffenseRank", "teamOLineRank", "opponentDefenseRank", "matchupPositionRank", "opponentTotal"]);
const comparisonMarketKeys = new Set(["fantasyCalcValue", "fantasyCalcPositionRank", "tierCliff", "boomBustRange"]);

function comparisonGroup(dataset: ToolDataset, key: string): ComparisonGroup {
  if (dataset === "advanced") return comparisonUsageKeys.has(key) ? "Usage" : comparisonEfficiencyKeys.has(key) ? "Efficiency" : "Production";
  if (key.startsWith("stat_")) return "Stat line";
  if (comparisonTeamContextKeys.has(key)) return "Team context";
  if (comparisonMarketKeys.has(key)) return "Market";
  return "Projection";
}

const comparisonGroupOrder: Record<ToolDataset, ComparisonGroup[]> = {
  projections: ["Projection", "Stat line", "Team context", "Market"],
  advanced: ["Production", "Usage", "Efficiency"],
};

function ComparisonMetricRow({ row, leftName, rightName, headline = false }: { row: ComparisonRow; leftName: string; rightName: string; headline?: boolean }) {
  const { metric, leftValue, rightValue } = row;
  const leftWins = Boolean(leftValue && rightValue && (metric.lowerIsBetter ? leftValue.value < rightValue.value : leftValue.value > rightValue.value));
  const rightWins = Boolean(leftValue && rightValue && (metric.lowerIsBetter ? rightValue.value < leftValue.value : rightValue.value > leftValue.value));
  const tied = Boolean(leftValue && rightValue && leftValue.value === rightValue.value);
  const leftDisplay = leftValue ? metricDisplay(leftValue.value, metric) : "—";
  const rightDisplay = rightValue ? metricDisplay(rightValue.value, metric) : "—";
  const [leftShare, rightShare] = comparisonBarShares(row);
  const valueClass = (value: ComparisonMetricValue | null, wins: boolean, loses: boolean) =>
    `comparison-row-value${wins ? " is-winner" : ""}${!value ? " is-unavailable" : loses ? " is-loser" : ""}`;

  return (
    <div
      className={`comparison-row${headline ? " is-headline" : ""}`}
      role="group"
      aria-label={`${metric.label}. ${leftName}: ${leftDisplay}${leftWins ? ", leads" : tied ? ", tied" : ""}. ${rightName}: ${rightDisplay}${rightWins ? ", leads" : tied ? ", tied" : ""}.`}
    >
      <span className="comparison-row-label" aria-hidden="true">
        {metric.label}
        {metric.lowerIsBetter ? <small>Lower is better</small> : null}
      </span>
      <strong className={valueClass(leftValue, leftWins, rightWins)} aria-hidden="true">{leftDisplay}</strong>
      <span className="comparison-split" aria-hidden="true">
        <i className={`${leftWins ? "is-winner" : ""}${!leftValue ? " is-empty" : ""}`} style={{ flexGrow: leftShare }} />
        <i className={`${rightWins ? "is-winner" : ""}${!rightValue ? " is-empty" : ""}`} style={{ flexGrow: rightShare }} />
      </span>
      <strong className={valueClass(rightValue, rightWins, leftWins)} aria-hidden="true">{rightDisplay}</strong>
    </div>
  );
}

function comparisonMatchupLabel(player: ComparisonEntity): string {
  if (player.isBye) return "Bye week";
  if (!player.opponent) return "Matchup TBD";
  return `${player.isAway ? "@" : "vs"} ${player.opponent}`;
}

/** Position, team and opponent in one short line; unknowns are left out rather than spelled out. */
function comparisonPickMeta(player: ComparisonEntity): string {
  const position = player.position === "DEF" ? "DST" : player.position;
  if (!player.team) return position;
  if (player.isBye) return `${position} · ${player.team} · Bye`;
  return player.opponent ? `${position} · ${player.team} ${player.isAway ? "@" : "vs"} ${player.opponent}` : `${position} · ${player.team}`;
}

function ComparisonBoardHeader({ left, right, leftPlayerId, rightPlayerId, trending, sosEntry, onOpenPlayer, onOpenMatchup }: { left: ComparisonEntity; right: ComparisonEntity; leftPlayerId?: string; rightPlayerId?: string; trending: Dashboard["playerTrending"]; sosEntry?: StrengthOfScheduleEntryLike; onOpenPlayer?: (playerId: string) => void; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  return (
    <header className="comparison-board-head" aria-label={`${left.name} versus ${right.name}`}>
      {[{ player: left, playerId: leftPlayerId }, { player: right, playerId: rightPlayerId }].map(({ player, playerId }, index) => {
        const trend = playerId ? trending?.[playerId] : undefined;
        return (
          <div className={`comparison-board-player${index === 0 ? " is-left" : " is-right"}`} key={player.id}>
            {playerId && onOpenPlayer
              ? <button type="button" className="comparison-board-name" onClick={() => onOpenPlayer(playerId)} aria-label={`View ${player.name} details and news`}>{player.name}</button>
              : <strong className="comparison-board-name">{player.name}</strong>}
            <span className="comparison-board-meta">
              {player.team && player.opponent && !player.isBye
                ? <MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase ?? null }) : undefined} />
                : <span>{player.team || "Team TBD"} · {comparisonMatchupLabel(player)}</span>}
              {player.gameTime ? <time>{gameTimeLabel(player.gameTime)}</time> : null}
            </span>
            {trend && (trend.adds !== null || trend.drops !== null) ? (
              <span className="comparison-trending">
                {trend.adds !== null ? <>Adds <strong>{formatCompactCount(trend.adds)}</strong></> : null}
                {trend.adds !== null && trend.drops !== null ? " · " : null}
                {trend.drops !== null ? <>Drops <strong>{formatCompactCount(trend.drops)}</strong></> : null}
              </span>
            ) : null}
          </div>
        );
      })}
    </header>
  );
}

function ComparisonPicker({ slot, player, options, onChoose, onClear }: {
  slot: 1 | 2;
  player: ComparisonEntity | undefined;
  options: ComparisonEntity[];
  onChoose: (entity: ComparisonEntity) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const swapRef = useRef<HTMLButtonElement>(null);
  // Picking, Escape and clear unmount the focused control; say where focus goes next.
  const restoreFocus = useRef<"swap" | "input" | null>(null);
  const inputId = `comparison-position-player-${slot}`;
  const needle = comparablePlayerName(query.trim());
  const showSearch = !player || isEditing;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    } else if (restoreFocus.current === "swap" && player) {
      swapRef.current?.focus();
    } else if (restoreFocus.current === "input" && !player) {
      inputRef.current?.focus();
    }
    if (!isEditing) restoreFocus.current = null;
  }, [isEditing, player]);

  const matches = useMemo(() => options
    .filter((entity) => needle && comparablePlayerName(entity.name).includes(needle))
    .sort((a, b) => {
      const aName = comparablePlayerName(a.name);
      const bName = comparablePlayerName(b.name);
      const aPriority = needle && aName === needle ? 0 : needle && aName.startsWith(needle) ? 1 : 2;
      const bPriority = needle && bName === needle ? 0 : needle && bName.startsWith(needle) ? 1 : 2;
      return aPriority - bPriority || a.name.localeCompare(b.name);
    })
    .slice(0, 40), [needle, options]);

  function choose(entity: ComparisonEntity, fromKeyboard = false) {
    // A keyboard pick keeps focus on the slot; a tap shouldn't leave a focus ring behind.
    if (fromKeyboard) restoreFocus.current = "swap";
    onChoose(entity);
    setQuery("");
    setIsEditing(false);
  }

  function stopEditing() {
    setQuery("");
    setIsEditing(false);
  }

  return (
    <div className={`comparison-pick slot-${slot}${player ? " is-picked" : ""}`}>
      {showSearch ? (
        <>
          <label className="sr-only" htmlFor={inputId}>{player ? `Replace player ${slot}` : `Search for player ${slot}`}</label>
          <div className="search-field comparison-pick-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              aria-label={player ? `Search to replace player ${slot}` : `Search players for comparison slot ${slot}`}
              name={`comparison-player-${slot}`}
              placeholder={player ? `Replace ${player.name}…` : `Add player ${slot}…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onBlur={(event) => {
                // Leaving the search without picking keeps the current player.
                if (player && !event.currentTarget.closest(".comparison-pick")?.contains(event.relatedTarget)) stopEditing();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const firstMatch = matches[0];
                  if (firstMatch) { event.preventDefault(); choose(firstMatch, true); }
                } else if (event.key === "Escape") {
                  if (player) {
                    restoreFocus.current = "swap";
                    stopEditing();
                  } else setQuery("");
                }
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label={`Clear player ${slot} search`}>×</button> : null}
          </div>
        </>
      ) : player ? (
        <div className="comparison-pick-chosen">
          <button ref={swapRef} type="button" className="comparison-pick-swap" onClick={() => setIsEditing(true)} aria-label={`Replace player ${slot}, ${player.name}`}>
            <strong>{player.name}</strong>
            <span>{comparisonPickMeta(player)}</span>
          </button>
          <button type="button" className="comparison-pick-clear" onClick={() => { restoreFocus.current = "input"; onClear(); stopEditing(); }} aria-label={`Clear player ${slot}`}>×</button>
        </div>
      ) : null}
      {showSearch && needle ? (
        <div className="comparison-pick-results" aria-label={`Players available for comparison slot ${slot}`} aria-live="polite">
          {matches.map((entity) => (
            <button
              type="button"
              aria-current={player?.id === entity.id ? "true" : undefined}
              className={player?.id === entity.id ? "is-selected" : ""}
              key={entity.id}
              // Keep focus in the search so picking a result doesn't count as leaving it.
              onMouseDown={(event) => event.preventDefault()}
              // detail 0 means Enter or Space on the button, not a pointer click.
              onClick={(event) => choose(entity, event.detail === 0)}
            >
              <span className="comparison-result-primary"><strong>{entity.name}</strong></span>
              <span className="comparison-result-meta">
                <span>{comparisonPickMeta(entity)}</span>
                {entity.gameTime ? <time>{gameTimeLabel(entity.gameTime)}</time> : null}
              </span>
            </button>
          ))}
          {matches.length === 0 ? <div className="trade-search-empty">No players match “{query.trim()}”.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One key per real player across both sources; defenses are keyed by team. */
function comparisonIdentity(player: PlayerSelection): string {
  return `${player.position}:${player.position === "DEF" ? player.team : comparablePlayerName(player.name)}`;
}

type ComparisonSection = {
  dataset: ToolDataset;
  headline: ComparisonRow | undefined;
  groups: { group: ComparisonGroup; rows: ComparisonRow[] }[];
};

function comparisonSection(dataset: ToolDataset, position: BasePosition, league: League, left: ComparisonEntity | undefined, right: ComparisonEntity | undefined, extraRows: ComparisonRow[] = []): ComparisonSection {
  const metricList = dataset === "advanced"
    ? analyticsMetricsForLeague(position, league)
    : (() => {
      const projectionMetrics = weeklyMetrics[position].filter((metric) => !redundantComparisonProjectionKeys.has(metric.key));
      return position === "DEF" ? projectionMetrics : [...projectionMetrics, ...teamContextMetrics];
    })();
  const rows: ComparisonRow[] = metricList.flatMap((metric) => {
    const leftValue = comparisonValue(left, metric);
    const rightValue = comparisonValue(right, metric);
    return leftValue || rightValue ? [{ metric, leftValue, rightValue }] : [];
  });
  const orderIndex = new Map(comparisonRowOrder[dataset][position].map((key, index) => [key, index]));
  const ordered = [...rows, ...extraRows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.get(a.row.metric.key) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = orderIndex.get(b.row.metric.key) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.index - b.index;
    })
    .map(({ row }) => row);
  const headline = ordered.find((row) => comparisonHeadlineKeys.has(row.metric.key));
  const groups = comparisonGroupOrder[dataset]
    .map((group) => ({ group, rows: ordered.filter((row) => row !== headline && comparisonGroup(dataset, row.metric.key) === group) }))
    .filter((entry) => entry.rows.length > 0);
  return { dataset, headline, groups };
}

function ComparisonView({ dashboard, league, window, onWindowChange, validPositions, initialPlayer, initialKey, onOpenPlayer, onOpenMatchup }: {
  dashboard: Dashboard;
  league: League;
  window: AnalyticsWindow;
  onWindowChange: (window: AnalyticsWindow) => void;
  validPositions: BasePosition[];
  initialPlayer: PlayerSelection | null;
  initialKey: number;
  onOpenPlayer?: (playerId: string) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
}) {
  const pfnQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const weeklyEntities = useMemo(() => buildWeeklyEntities(dashboard, league, pfnQuery.data?.tables), [dashboard, league.id, pfnQuery.data?.tables]);
  const weeklyByIdentity = useMemo(() => new Map(weeklyEntities.map((entity) => [comparisonIdentity(entity), entity])), [weeklyEntities]);
  // This week's projections and the season's advanced stats, for every position the league ranks.
  const projectionEntities = useMemo(
    () => weeklyEntities.filter((entity) => validPositions.includes(entity.position)),
    [validPositions, weeklyEntities],
  );
  const advancedEntities = useMemo<ComparisonEntity[]>(() => dashboard.analytics.entities.flatMap((entity) => {
    if (!(validPositions as string[]).includes(entity.position)) return [];
    const game = weeklyByIdentity.get(comparisonIdentity(entity as PlayerSelection));
    return [{
      id: entity.id,
      name: entity.name,
      team: entity.team,
      position: entity.position as BasePosition,
      opponent: game?.opponent ?? null,
      isAway: game?.isAway ?? null,
      isBye: game?.isBye ?? false,
      gameTime: game?.gameTime ?? null,
      gamePhase: game?.gamePhase ?? null,
      values: window === "season" ? entity.season : entity.rolling17,
    }];
  }), [dashboard.analytics.entities, validPositions, weeklyByIdentity, window]);
  const advancedByIdentity = useMemo(() => new Map(advancedEntities.map((entity) => [comparisonIdentity(entity), entity])), [advancedEntities]);
  // Pickers search everyone with either projections or stats; a player in both appears once.
  const candidates = useMemo(() => {
    const byIdentity = new Map<string, ComparisonEntity>(projectionEntities.map((entity) => [comparisonIdentity(entity), entity]));
    for (const entity of advancedEntities) {
      if (!byIdentity.has(comparisonIdentity(entity))) byIdentity.set(comparisonIdentity(entity), entity);
    }
    return [...byIdentity.values()];
  }, [advancedEntities, projectionEntities]);

  const [selectedPlayers, setSelectedPlayers] = useState<[PlayerSelection | null, PlayerSelection | null]>([null, null]);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const initialSeedKey = useRef<number | null>(null);

  // Both slots start empty. The initialPlayer seed (a player card's "Compare"
  // link) is applied only when initialKey changes, so the window toggle never
  // wipes the user's picks.
  useEffect(() => {
    if (!initialPlayer || !validPositions.includes(initialPlayer.position)) return;
    if (initialSeedKey.current === initialKey) return;
    const requested = candidates.find((entity) => isSamePlayer(entity, initialPlayer));
    if (!requested) return;
    setSelectedPlayers([requested, null]);
    initialSeedKey.current = initialKey;
  }, [candidates, initialKey, initialPlayer, validPositions]);

  // Drop picks whose position the league no longer ranks.
  useEffect(() => {
    if (selectedPlayers.every((player) => !player || validPositions.includes(player.position))) return;
    setSelectedPlayers(([first, second]) => [
      first && validPositions.includes(first.position) ? first : null,
      second && validPositions.includes(second.position) ? second : null,
    ]);
  }, [selectedPlayers, validPositions]);

  // Resolve each pick against both sources by identity: they use different row
  // IDs for the same player, and either can be missing a player.
  const resolved = selectedPlayers.map((player) => {
    if (!player) return undefined;
    const projection = projectionEntities.find((entity) => isSamePlayer(entity, player))
      ?? weeklyByIdentity.get(comparisonIdentity(player));
    const advanced = advancedByIdentity.get(comparisonIdentity(player)) ?? advancedEntities.find((entity) => isSamePlayer(entity, player));
    const display: ComparisonEntity = projection ?? advanced ?? {
      ...player,
      id: player.playerId ?? comparisonIdentity(player),
      opponent: null,
      isAway: null,
      isBye: false,
      gameTime: null,
      gamePhase: null,
      values: {},
    };
    return { display, projection, advanced };
  });
  const left = resolved[0]?.display;
  const right = resolved[1]?.display;
  const position = (left ?? right)?.position ?? null;
  const playerDetailId = (player: ComparisonEntity | undefined): string | undefined => player
    ? player.playerId ?? weeklyByIdentity.get(comparisonIdentity(player))?.playerId
    : undefined;
  const leftPlayerId = playerDetailId(left);
  const rightPlayerId = playerDetailId(right);
  const boomBustPlayerIds = [leftPlayerId, rightPlayerId].filter((playerId): playerId is string => Boolean(playerId));
  const supportsBoomBust = position === "QB" || position === "RB" || position === "WR" || position === "TE";
  const boomBustQuery = useQuery({
    queryKey: ["comparison-boom-bust-ranges", league.id, position, ...boomBustPlayerIds],
    queryFn: () => api.getBoomBustRanges({ leagueId: league.id, position: position as "QB" | "RB" | "WR" | "TE", playerIds: boomBustPlayerIds }),
    enabled: supportsBoomBust && boomBustPlayerIds.length === 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const boomBustRows = (() => {
    if (!leftPlayerId || !rightPlayerId) return [];
    const ranges = new Map((boomBustQuery.data?.rows ?? []).map((range) => [range.playerId, range]));
    const leftRange = ranges.get(leftPlayerId);
    const rightRange = ranges.get(rightPlayerId);
    const makeValue = (value: number | undefined): ComparisonMetricValue | null => typeof value === "number" && Number.isFinite(value) ? { value } : null;
    const rangeRows: ComparisonRow[] = [
      {
        metric: { key: "boomCeiling", label: "Boom ceiling", short: "Boom", unit: " pts" },
        leftValue: makeValue(leftRange?.ceiling),
        rightValue: makeValue(rightRange?.ceiling),
      },
      {
        metric: { key: "bustFloor", label: "Bust floor", short: "Bust", unit: " pts" },
        leftValue: makeValue(leftRange?.floor),
        rightValue: makeValue(rightRange?.floor),
      },
    ];
    return rangeRows.filter((row) => row.leftValue || row.rightValue);
  })();
  const sections = left && right && position ? [
    comparisonSection("projections", position, league, resolved[0]?.projection, resolved[1]?.projection, boomBustRows),
    comparisonSection("advanced", position, league, resolved[0]?.advanced, resolved[1]?.advanced),
  ] : [];
  const selectionStateClass = left && right ? " is-ready" : left || right ? " has-selection" : " is-empty";
  const optionsBeside = (other: ComparisonEntity | undefined) => other
    ? candidates.filter((entity) => entity.position === other.position && !isSamePlayer(entity, other))
    : candidates;

  return (
    <section className={`comparison-view${selectionStateClass}`}>
      <div className="comparison-pickers" aria-label="Players being compared">
        <ComparisonPicker slot={1} player={left} options={optionsBeside(right)} onChoose={(entity) => setSelectedPlayers((current) => [entity, current[1]])} onClear={() => setSelectedPlayers((current) => [null, current[1]])} />
        <ComparisonPicker slot={2} player={right} options={optionsBeside(left)} onChoose={(entity) => setSelectedPlayers((current) => [current[0], entity])} onClear={() => setSelectedPlayers((current) => [current[0], null])} />
      </div>

      {candidates.length === 0 ? (
        <div className="analytics-empty"><strong>No player data yet.</strong><span>Refresh to check the latest Vegas lines and nflverse data.</span></div>
      ) : left && right ? (
        <section className="comparison-board" aria-label={`${left.name} and ${right.name} comparison`}>
          <ComparisonBoardHeader left={left} right={right} leftPlayerId={leftPlayerId} rightPlayerId={rightPlayerId} trending={dashboard.playerTrending ?? {}} sosEntry={sosEntry} onOpenPlayer={onOpenPlayer} onOpenMatchup={onOpenMatchup} />
          {sections.map((section) => (
            <section className="comparison-section" key={section.dataset} aria-labelledby={`comparison-section-${section.dataset}`}>
              <header className="comparison-section-head">
                <h3 id={`comparison-section-${section.dataset}`}>{section.dataset === "projections" ? "This week" : "Season so far"}</h3>
                {section.dataset === "advanced" ? <SegmentedControl className="comparison-window-toggle" value={window} onChange={onWindowChange} label="Season stat window" options={[{ value: "season", label: "This season" }, { value: "rolling17", label: "Rolling 17" }]} /> : null}
              </header>
              {section.headline ? <ComparisonMetricRow row={section.headline} leftName={left.name} rightName={right.name} headline /> : null}
              {section.groups.map(({ group, rows: groupRows }) => (
                <section className="comparison-group" key={group} aria-label={group}>
                  <h4>{group}</h4>
                  {groupRows.map((row) => <ComparisonMetricRow key={row.metric.key} row={row} leftName={left.name} rightName={right.name} />)}
                </section>
              ))}
              {!section.headline && section.groups.length === 0
                ? <div className="empty-inline">{section.dataset === "projections" ? "No projections for these players yet." : "No season stats for these players yet."}</div>
                : null}
            </section>
          ))}
        </section>
      ) : <div className="empty-inline">Choose two players to compare.</div>}
    </section>
  );
}

export function ComparisonTool({ dashboard, league, initialPlayer = null, initialKey = 0, onOpenPlayer, onOpenMatchup }: { dashboard: Dashboard; league: League; initialPlayer?: PlayerSelection | null; initialKey?: number; onOpenPlayer?: (playerId: string) => void; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);
  const [window, setWindow] = useState<AnalyticsWindow>("season");

  return (
    <div className="comparison-tool">
      <ComparisonView
        dashboard={dashboard}
        league={league}
        window={window}
        onWindowChange={setWindow}
        validPositions={validPositions}
        initialPlayer={initialPlayer}
        initialKey={initialKey}
        onOpenPlayer={onOpenPlayer}
        onOpenMatchup={onOpenMatchup}
      />
    </div>
  );
}
