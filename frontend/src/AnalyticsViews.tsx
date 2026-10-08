import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Customized, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, chartTooltipStyle } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type ApiResponse } from "./api";
import type { MatchupSelection } from "./App";
import { MatchupTag, ModalPortal, SegmentedControl, shortLeagueName, useDialogFocusTrap, type StrengthOfScheduleEntryLike } from "./shared";

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
type ChartDatum = {
  id: string; name: string; label: string; team: string; games: number; x: number; y: number; isSelectedTeam: boolean;
};
type ChartAxis = { scale?: unknown };
type ChartOffset = { left?: number; top?: number; width?: number; height?: number };
type LabelBox = { left: number; top: number; width: number; height: number };
type LabelPlacement = LabelBox & { datum: ChartDatum; textX: number; textY: number; anchor: "start" | "middle" | "end" };
type AdaptiveChartLabelsProps = {
  data: ChartDatum[]; leaderIds: ReadonlySet<string>; selectedTeamIds: ReadonlySet<string>; xAxisMap?: Record<string, ChartAxis>; yAxisMap?: Record<string, ChartAxis>; offset?: ChartOffset;
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

type ChartPreset = {
  label: string;
  x: string;
  y: string;
  research?: { source: string; sourceUrl: string; insight: string };
};

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
  ],
  RB: [
    { label: "Workhorse profile", x: "touches", y: "fantasy_league" },
    { label: "Receiving leverage", x: "target_share", y: "receiving_epa" },
    { label: "Ground production", x: "carries", y: "rushing_yards" },
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
  ],
  TE: [
    { label: "Opportunity profile", x: "target_share", y: "air_yards_share" },
    { label: "Weighted opportunity", x: "wopr", y: "fantasy_league" },
    { label: "Air-yards conversion", x: "receiving_air_yards", y: "receiving_yards" },
  ],
  K: [
    { label: "Conversion volume", x: "fg_attempts", y: "fg_made" },
    { label: "Distance upside", x: "fg_40_plus", y: "fg_50_plus" },
  ],
  DEF: [
    { label: "Pressure to sacks", x: "qb_hits", y: "sacks" },
    { label: "Takeaway scoring", x: "takeaways", y: "defensive_tds" },
    { label: "Backfield disruption", x: "tackles_for_loss", y: "takeaways" },
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

type SavedViewControlsProps = {
  dataset: ToolDataset;
  presets: ChartPreset[];
  validPositions: readonly BasePosition[];
  config: SavedChartConfig;
  selectedSavedViewId: string | null;
  onSelectedSavedViewIdChange: (id: string | null) => void;
  onApplySavedView: (view: SavedChartView) => void;
  onApplyBuiltIn: (preset: ChartPreset) => void;
  onChooseCustom: () => void;
};

function SavedViewControls({ dataset, presets, validPositions, config, selectedSavedViewId, onSelectedSavedViewIdChange, onApplySavedView, onApplyBuiltIn, onChooseCustom }: SavedViewControlsProps) {
  const queryClient = useQueryClient();
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const viewsQuery = useQuery({
    queryKey: ["saved-chart-views"],
    queryFn: () => api.listSavedChartViews({}),
    staleTime: 60_000,
    retry: false,
  });
  const views = (viewsQuery.data?.views ?? [])
    .filter((view) => view.dataset === dataset)
    .filter((view) => validPositions.includes(view.position));
  const selectedSavedView = views.find((view) => view.id === selectedSavedViewId);
  const matchingPreset = presets.find((preset) => preset.x === config.xMetric && preset.y === config.yMetric);
  const pickerValue = selectedSavedView ? `saved:${selectedSavedView.id}` : matchingPreset ? `builtin:${matchingPreset.x}|${matchingPreset.y}` : "custom";

  const saveMutation = useMutation({
    mutationFn: (viewName: string) => api.saveChartView({ name: viewName, ...config }),
    onSuccess: ({ view }) => {
      queryClient.setQueryData<ApiResponse<typeof api, "listSavedChartViews">>(["saved-chart-views"], (current) => ({
        views: [...(current?.views ?? []).filter((item) => item.id !== view.id), view],
      }));
      onSelectedSavedViewIdChange(view.id);
      setName("");
      setIsNaming(false);
      setMessage(`Saved “${view.name}”.`);
    },
    onError: () => setMessage("Couldn’t save this view. Try again."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteChartView({ id }),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<ApiResponse<typeof api, "listSavedChartViews">>(["saved-chart-views"], (current) => ({
        views: (current?.views ?? []).filter((item) => item.id !== id),
      }));
      onSelectedSavedViewIdChange(null);
      setMessage("Saved view deleted.");
    },
    onError: () => setMessage("Couldn’t delete this view. Try again."),
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
      setMessage("Enter a name for this view.");
      nameRef.current?.focus();
      return;
    }
    setMessage("");
    saveMutation.mutate(trimmed);
  }

  return (
    <div className="saved-view-block">
      <div className="saved-view-row">
        <label className="chart-preset-select">
          <span>Saved view</span>
          <select
            aria-label={`Choose ${dataset === "advanced" ? "advanced" : "weekly"} saved chart view`}
            value={pickerValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMessage("");
              if (nextValue.startsWith("saved:")) {
                const view = views.find((item) => `saved:${item.id}` === nextValue);
                if (view) onApplySavedView(view);
                return;
              }
              if (nextValue.startsWith("builtin:")) {
                const preset = presets.find((item) => `builtin:${item.x}|${item.y}` === nextValue);
                if (preset) onApplyBuiltIn(preset);
                return;
              }
              onSelectedSavedViewIdChange(null);
              onChooseCustom();
            }}
          >
            <optgroup label="Built-in views">
              {presets.map((preset) => <option key={`${preset.x}-${preset.y}`} value={`builtin:${preset.x}|${preset.y}`}>{preset.label}</option>)}
            </optgroup>
            {views.length > 0 ? <optgroup label="My saved views">{views.map((view) => <option key={view.id} value={`saved:${view.id}`}>{view.name}</option>)}</optgroup> : null}
            <option value="custom">Custom axes</option>
          </select>
        </label>
        <div className="saved-view-actions">
          <button type="button" className="saved-view-save-trigger" onClick={() => { setIsNaming((open) => !open); setMessage(""); }}>{isNaming ? "Cancel" : "Save current view"}</button>
          {selectedSavedView ? <button type="button" className="saved-view-delete" onClick={() => deleteMutation.mutate(selectedSavedView.id)} disabled={deleteMutation.isPending}>Delete “{selectedSavedView.name}”</button> : null}
        </div>
      </div>
      {matchingPreset?.research ? (
        <div className="chart-research-note">
          <p>{matchingPreset.research.insight}</p>
          <a href={matchingPreset.research.sourceUrl} target="_blank" rel="noreferrer">Research: {matchingPreset.research.source} ↗<span className="sr-only"> (opens in a new tab)</span></a>
        </div>
      ) : null}
      {isNaming ? (
        <form className="saved-view-form" onSubmit={submitName}>
          <label htmlFor={`${dataset}-saved-view-name`}>View name</label>
          <div>
            <input ref={nameRef} id={`${dataset}-saved-view-name`} name="view-name" autoComplete="off" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="RB receiving upside…" />
            <button type="submit" disabled={saveMutation.isPending} aria-busy={saveMutation.isPending}>Save{saveMutation.isPending ? <span className="sr-only"> Saving…</span> : null}</button>
          </div>
        </form>
      ) : null}
      {viewsQuery.isError ? <p className="saved-view-status" role="status">Saved views couldn’t be loaded.</p> : message ? <p className="saved-view-status" role="status">{message}</p> : null}
    </div>
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
  const decimals = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)}${metric.unit ?? ""}`;
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

function AdaptiveChartLabels({ data, leaderIds, selectedTeamIds, xAxisMap, yAxisMap, offset }: AdaptiveChartLabelsProps) {
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
  const density = (x: number, y: number) => points.filter((point) => Math.abs(point.x - x) < 52 && Math.abs(point.y - y) < 26).length;
  const ordered = points.slice().sort((a, b) => {
    const selectedTeamDifference = Number(selectedTeamIds.has(b.datum.id)) - Number(selectedTeamIds.has(a.datum.id));
    if (selectedTeamDifference !== 0) return selectedTeamDifference;
    const densityDifference = density(b.x, b.y) - density(a.x, a.y);
    if (densityDifference !== 0) return densityDifference;
    const leaderDifference = Number(leaderIds.has(b.datum.id)) - Number(leaderIds.has(a.datum.id));
    return leaderDifference || a.datum.id.localeCompare(b.datum.id);
  });
  const placed: LabelPlacement[] = [];

  for (const point of ordered) {
    const width = Math.min(94, Math.max(25, point.datum.label.length * 5.4 + 6));
    const height = 13;
    const candidates: Array<LabelBox & { textX: number; textY: number; anchor: "start" | "middle" | "end" }> = [
      { left: point.x - width / 2, top: point.y - 20, width, height, textX: point.x, textY: point.y - 10, anchor: "middle" },
      { left: point.x - width / 2, top: point.y + 8, width, height, textX: point.x, textY: point.y + 18, anchor: "middle" },
      { left: point.x + 9, top: point.y - height / 2, width, height, textX: point.x + 12, textY: point.y + 3, anchor: "start" },
      { left: point.x - width - 9, top: point.y - height / 2, width, height, textX: point.x - 12, textY: point.y + 3, anchor: "end" },
      { left: point.x + 7, top: point.y - 19, width, height, textX: point.x + 10, textY: point.y - 9, anchor: "start" },
      { left: point.x - width - 7, top: point.y - 19, width, height, textX: point.x - 10, textY: point.y - 9, anchor: "end" },
      { left: point.x + 7, top: point.y + 7, width, height, textX: point.x + 10, textY: point.y + 17, anchor: "start" },
      { left: point.x - width - 7, top: point.y + 7, width, height, textX: point.x - 10, textY: point.y + 17, anchor: "end" },
    ];

    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [index, candidate] of candidates.entries()) {
      const outside = Math.max(0, left + 3 - candidate.left)
        + Math.max(0, candidate.left + candidate.width - right + 3)
        + Math.max(0, top + 3 - candidate.top)
        + Math.max(0, candidate.top + candidate.height - bottom + 3);
      const labelOverlap = placed.reduce((score, other) => score + boxOverlap(candidate, other), 0);
      const coveredPoints = points.reduce((count, other) => count + (other.datum.id !== point.datum.id && pointInsideBox(other.x, other.y, candidate, 3) ? 1 : 0), 0);
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
    if (best) placed.push({ ...best, datum: point.datum });
  }

  return (
    <g className="adaptive-chart-labels" aria-hidden="true">
      {placed.map((placement) => (
        <text
          key={placement.datum.id}
          className={selectedTeamIds.has(placement.datum.id) ? "adaptive-chart-label selected-team" : leaderIds.has(placement.datum.id) ? "adaptive-chart-label leader" : "adaptive-chart-label"}
          x={placement.textX}
          y={placement.textY}
          textAnchor={placement.anchor}
        >
          {placement.datum.label}
        </text>
      ))}
    </g>
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
  xAxis: ScatterAxisSpec;
  yAxis: ScatterAxisSpec;
  showQuadrants: boolean;
  xCutoff: number;
  yCutoff: number;
  ariaLabel: string;
};

function ScatterPlot({ others, leadersWithoutSelectedTeam, selectedTeamPlayers, labelData, leaderIds, selectedTeamIds, xAxis, yAxis, showQuadrants, xCutoff, yCutoff, ariaLabel }: ScatterPlotProps) {
  const plottedData = Array.from(new Map(
    [...others, ...leadersWithoutSelectedTeam, ...selectedTeamPlayers].map((point) => [point.id, point]),
  ).values());
  return (
    <div className="scatter-frame" role="group" aria-label={ariaLabel}>
      <p className="sr-only">{ariaLabel}. {plottedData.map((point) => `${point.name}, ${point.team}: ${xAxis.short} ${point.x}, ${yAxis.short} ${point.y}`).join("; ")}</p>
      <div aria-hidden="true" className="h-full">
      {showQuadrants ? <div className="quadrant-label high-high">SMASH SPOT</div> : null}
      <ChartContainer config={{ field: { label: "Field", color: "var(--chart-2)" }, team: { label: "My team", color: "var(--chart-1)" } }} className="aspect-auto h-full">
        <ScatterChart margin={{ top: 28, right: 12, bottom: 50, left: 2 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" />
          <XAxis
            type="number"
            dataKey="x"
            name={`${xAxis.short}${xAxis.titleSuffix}`}
            domain={["auto", "auto"]}
            reversed={xAxis.lowerIsBetter}
            tick={{ fill: "var(--dim)", fontSize: "var(--type-caption)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            label={{ value: `${xAxis.short}${xAxis.titleSuffix}`, position: "insideBottom", offset: -34, fill: "var(--text)", fontSize: "var(--type-caption)", fontWeight: 700 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={`${yAxis.short}${yAxis.titleSuffix}`}
            domain={["auto", "auto"]}
            reversed={yAxis.lowerIsBetter}
            width={42}
            tick={{ fill: "var(--dim)", fontSize: "var(--type-caption)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            label={{ value: `${yAxis.short}${yAxis.titleSuffix}`, angle: -90, position: "insideLeft", fill: "var(--text)", fontSize: "var(--type-caption)", fontWeight: 700 }}
          />
          <Tooltip cursor={{ stroke: "var(--foreground)", strokeDasharray: "3 3" }} contentStyle={chartTooltipStyle} />
          {showQuadrants ? <ReferenceLine x={xCutoff} stroke="var(--text)" strokeWidth={1.2} /> : null}
          {showQuadrants ? <ReferenceLine y={yCutoff} stroke="var(--text)" strokeWidth={1.2} /> : null}
          <Scatter name="Field" data={others} fill="var(--chart-2)" fillOpacity={0.72} />
          <Scatter name="Smash spots" data={leadersWithoutSelectedTeam} fill="var(--chart-2)" fillOpacity={0.72} />
          <Scatter name="My team" data={selectedTeamPlayers} fill="var(--chart-1)" stroke="var(--chart-1)" strokeWidth={1.5} />
          {labelData.length ? <Customized component={<AdaptiveChartLabels data={labelData} leaderIds={leaderIds} selectedTeamIds={selectedTeamIds} />} /> : null}
        </ScatterChart>
      </ChartContainer>
      </div>
    </div>
  );
}

function ChartKey({ leagueShortName, showQuadrants, xPercentile, yPercentile }: { leagueShortName: string; showQuadrants: boolean; xPercentile: number; yPercentile: number }) {
  return (
    <div className="chart-key">
      <span><i className="selected-team-dot" /> {leagueShortName}</span>
      <span><i /> All plotted players · bold labels mark cutoff leaders</span>
      {showQuadrants ? <span>Crosshairs = {xPercentile}th X · {yPercentile}th Y</span> : null}
    </div>
  );
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

function ChartDialog({ isOpen, onClose, title, subtitle, count, countLabel, closeLabel = "Close chart", children }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  count: number;
  countLabel: string;
  closeLabel?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose, isOpen);
  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="chart-result-backdrop" onClick={onClose}>
        <article ref={dialogRef} className="chart-result-card" role="dialog" aria-modal="true" aria-labelledby="chart-result-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <header className="chart-result-header">
          <div><h2 id="chart-result-title">{title}</h2><span>{subtitle}</span></div>
          <div className="chart-result-header-actions"><span><strong>{count}</strong> {countLabel}</span><button type="button" onClick={onClose} aria-label={closeLabel}>×</button></div>
        </header>
          <div className="chart-result-body">{children}</div>
        </article>
      </div>
    </ModalPortal>
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

function AnalyticsChart({ dashboard, league }: { dashboard: Dashboard; league: League }) {
  const [position, setPosition] = useState<BasePosition>("RB");
  const [window, setWindow] = useState<AnalyticsWindow>("season");
  const [xMetric, setXMetric] = useState(defaultAnalyticsAxes.RB[0]);
  const [yMetric, setYMetric] = useState(defaultAnalyticsAxes.RB[1]);
  const [plotLimit, setPlotLimit] = useState<PlotLimit>("40");
  const [showQuadrants, setShowQuadrants] = useState(true);
  const [xPercentile, setXPercentile] = useState(50);
  const [yPercentile, setYPercentile] = useState(50);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null);
  const [isChartOpen, setIsChartOpen] = useState(false);
  const advancedControlsRef = useRef<HTMLDetailsElement>(null);
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);
  const metrics = analyticsMetricsForLeague(position, league);
  const presets = analyticsPresets[position];
  const selectedX = metrics.find((metric) => metric.key === xMetric) ?? metrics[0];
  const selectedY = metrics.find((metric) => metric.key === yMetric) ?? metrics[1] ?? metrics[0];
  const config: SavedChartConfig = {
    dataset: "advanced",
    position,
    xMetric: selectedX?.key ?? xMetric,
    yMetric: selectedY?.key ?? yMetric,
    window,
    showQuadrants,
    xPercentile,
    yPercentile,
    plotLimit,
  };

  function openAdvancedControls() {
    if (advancedControlsRef.current && !advancedControlsRef.current.open) advancedControlsRef.current.open = true;
  }

  function closeAdvancedControls() {
    if (advancedControlsRef.current?.open) advancedControlsRef.current.open = false;
  }

  function choosePosition(nextPosition: BasePosition) {
    const [nextX, nextY] = defaultAnalyticsAxes[nextPosition];
    setPosition(nextPosition);
    setXMetric(nextX);
    setYMetric(nextY);
    setSelectedSavedViewId(null);
  }

  // When the league changes and the current position is no longer valid (e.g. a
  // K saved view carried over to Dynastical Cucks), reset to RB when valid,
  // otherwise the first valid position — with that position's default axes and
  // no selected saved view.
  useEffect(() => {
    if (validPositions.includes(position)) return;
    choosePosition(validPositions.includes("RB") ? "RB" : validPositions[0] ?? "QB");
  }, [validPositions, position, choosePosition]);

  function applySavedView(view: SavedChartView) {
    if (view.dataset !== "advanced") return;
    if (!validPositions.includes(view.position)) return;
    const validMetrics = analyticsMetricsForLeague(view.position, league);
    const [fallbackX, fallbackY] = defaultAnalyticsAxes[view.position];
    setPosition(view.position);
    setXMetric(validMetrics.some((metric) => metric.key === view.xMetric) ? view.xMetric : fallbackX);
    setYMetric(validMetrics.some((metric) => metric.key === view.yMetric) ? view.yMetric : fallbackY);
    setWindow(view.window);
    setShowQuadrants(view.showQuadrants);
    setXPercentile(view.xPercentile);
    setYPercentile(view.yPercentile);
    setPlotLimit(view.plotLimit);
    setSelectedSavedViewId(view.id);
  }

  const chartData = useMemo(() => {
    if (!selectedX || !selectedY) return [];
    const mapped = dashboard.analytics.entities
      .filter((entity) => entity.position === position)
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
        }];
      })
      .sort((a, b) => b.games - a.games || (Math.abs(b.x) + Math.abs(b.y)) - (Math.abs(a.x) + Math.abs(a.y)));
    if (plotLimit === "all") return mapped;
    const visible = mapped.slice(0, Number(plotLimit));
    const visibleIds = new Set(visible.map((row) => row.id));
    return [...visible, ...mapped.filter((row) => row.isSelectedTeam && !visibleIds.has(row.id))];
  }, [dashboard.analytics.entities, league, plotLimit, position, selectedX, selectedY, window]);

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

  if (!dashboard.analytics.entities.length || !selectedX || !selectedY) {
    return (
      <section className="analytics-view">
        <div className="analytics-empty">
          <strong>No advanced stats yet.</strong>
          <span>Refresh after nflverse publishes the next weekly file.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="analytics-view">
      <SegmentedControl
        className="analytics-position-tabs"
        value={position}
        onChange={choosePosition}
        label="Chart position"
        options={validPositions.map((item) => ({ value: item, label: item === "DEF" ? "DST" : item }))}
      />

      <SavedViewControls
        dataset="advanced"
        presets={presets}
        validPositions={validPositions}
        config={config}
        selectedSavedViewId={selectedSavedViewId}
        onSelectedSavedViewIdChange={setSelectedSavedViewId}
        onApplySavedView={applySavedView}
        onApplyBuiltIn={(preset) => { setXMetric(preset.x); setYMetric(preset.y); setSelectedSavedViewId(null); closeAdvancedControls(); }}
        onChooseCustom={openAdvancedControls}
      />

      <details className="chart-advanced-controls" ref={advancedControlsRef}>
        <summary>Advanced chart controls</summary>
        <div>
          <SegmentedControl
            className="lineup-mode-toggle analytics-window-toggle"
            value={window}
            onChange={(value) => { setWindow(value); setSelectedSavedViewId(null); }}
            label="Advanced stat window"
            options={[{ value: "season", label: "This season" }, { value: "rolling17", label: "Rolling 17 games" }]}
          />
          <div className="analytics-selectors advanced-only-selectors">
            <label><span>X axis</span><select aria-label="Choose horizontal axis" value={selectedX.key} onChange={(event) => { setXMetric(event.target.value); setSelectedSavedViewId(null); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
            <label><span>Y axis</span><select aria-label="Choose vertical axis" value={selectedY.key} onChange={(event) => { setYMetric(event.target.value); setSelectedSavedViewId(null); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
            <label className="plot-limit"><span>Players shown</span><select aria-label="Choose number of players shown" value={plotLimit} onChange={(event) => { setPlotLimit(event.target.value as PlotLimit); setSelectedSavedViewId(null); }}><option value="24">Top 24 + my team</option><option value="40">Top 40 + my team</option><option value="all">All with data</option></select></label>
            <PercentileCutoffSelect axis="X" value={xPercentile} onChange={(value) => { setXPercentile(value); setSelectedSavedViewId(null); }} />
            <PercentileCutoffSelect axis="Y" value={yPercentile} onChange={(value) => { setYPercentile(value); setSelectedSavedViewId(null); }} />
          </div>
          <label className="chart-checkbox"><input type="checkbox" checked={showQuadrants} onChange={(event) => { setShowQuadrants(event.target.checked); setSelectedSavedViewId(null); }} /><span>Show quadrant guides and percentile cutoffs</span></label>
        </div>
      </details>

      <button type="button" className="chart-open-button" onClick={() => setIsChartOpen(true)}>View chart</button>
      <ChartDialog
        isOpen={isChartOpen}
        onClose={() => setIsChartOpen(false)}
        title={`${position === "DEF" ? "DST" : position} field`}
        subtitle={`${window === "season" ? `${dashboard.season} games so far` : "Each player’s latest 17 games"} · per-game averages`}
        count={chartData.length}
        countLabel={position === "DEF" ? "teams" : "players"}
      >
        <ScatterPlot
          others={others}
          leadersWithoutSelectedTeam={leadersWithoutSelectedTeam}
          selectedTeamPlayers={selectedTeamPlayers}
          labelData={labelData}
          leaderIds={leaderIds}
          selectedTeamIds={selectedTeamIds}
          xAxis={{ short: selectedX.short, lowerIsBetter: selectedX.lowerIsBetter, titleSuffix: " / game" }}
          yAxis={{ short: selectedY.short, lowerIsBetter: selectedY.lowerIsBetter, titleSuffix: " / game" }}
          showQuadrants={showQuadrants}
          xCutoff={xCutoff}
          yCutoff={yCutoff}
          ariaLabel={`${position === "DEF" ? "DST" : position} scatter plot comparing ${selectedX.label} and ${selectedY.label}`}
        />
        <ChartKey leagueShortName={shortLeagueName(league.name)} showQuadrants={showQuadrants} xPercentile={xPercentile} yPercentile={yPercentile} />
        <OmittedChartLabels omittedNames={omittedNames} />
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
          <span className="tier-cliff-player"><strong>{row.name}</strong><small>{row.team} · {row.y.toFixed(1)} projected</small></span>
          <span className="tier-cliff-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (gap / maxGap) * 100)}%` }} /></span>
          <strong className="tier-cliff-drop">−{gap.toFixed(1)}</strong>
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
          <span className="boom-bust-values"><strong>{row.x.toFixed(1)}<span className="sr-only"> projected points</span></strong><small><span className="sr-only">2026 scoring range </span>{floor.toFixed(1)}–{ceiling.toFixed(1)}</small></span>
        </li>;
      })}
    </ol>
  );
}

function WeeklyProjections({ dashboard, league, view, selectedPlayer = null, onSelectedPlayerChange }: { dashboard: Dashboard; league: League; view: "charts" | "percentiles"; selectedPlayer?: PlayerSelection | null; onSelectedPlayerChange?: (player: PlayerSelection | null) => void }) {
  const entities = useMemo(() => buildWeeklyEntities(dashboard, league), [dashboard, league.id]);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const [playerQuery, setPlayerQuery] = useState("");
  const [position, setPosition] = useState<BasePosition>("RB");
  const [xMetric, setXMetric] = useState(defaultWeeklyAxes.RB[0]);
  const [yMetric, setYMetric] = useState(defaultWeeklyAxes.RB[1]);
  const [plotLimit, setPlotLimit] = useState<PlotLimit>("40");
  const [showQuadrants, setShowQuadrants] = useState(true);
  const [xPercentile, setXPercentile] = useState(50);
  const [yPercentile, setYPercentile] = useState(50);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null);
  const [isChartOpen, setIsChartOpen] = useState(false);
  const advancedControlsRef = useRef<HTMLDetailsElement>(null);
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

  const metrics = weeklyMetrics[position];
  const presets = weeklyPresets[position];
  const selectedX = metrics.find((metric) => metric.key === xMetric) ?? metrics[0];
  const selectedY = metrics.find((metric) => metric.key === yMetric) ?? metrics[1] ?? metrics[0];
  const isTierCliffView = selectedX?.key === "leaguePositionRank" && selectedY?.key === "league";
  const isBoomBustView = selectedX?.key === "league" && selectedY?.key === "boomBustRange";
  const boomBustPlayerIds = useMemo(() => entities
    .filter((entity) => entity.position === position && typeof entity.values.league === "number")
    .sort((a, b) => (b.values.league ?? 0) - (a.values.league ?? 0))
    .slice(0, 24)
    .map((entity) => entity.playerId), [entities, position]);
  const boomBustRangesQuery = useQuery({
    queryKey: ["projection-boom-bust-ranges", league.id, position, boomBustPlayerIds],
    queryFn: () => api.getBoomBustRanges({ leagueId: league.id, position: position as "QB" | "RB" | "WR" | "TE", playerIds: boomBustPlayerIds }),
    enabled: view === "charts" && isBoomBustView && position !== "K" && position !== "DEF" && boomBustPlayerIds.length > 0,
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
    position,
    xMetric: selectedX?.key ?? xMetric,
    yMetric: selectedY?.key ?? yMetric,
    window: "season",
    showQuadrants,
    xPercentile,
    yPercentile,
    plotLimit,
  };

  function openAdvancedControls() {
    if (advancedControlsRef.current && !advancedControlsRef.current.open) advancedControlsRef.current.open = true;
  }

  function closeAdvancedControls() {
    if (advancedControlsRef.current?.open) advancedControlsRef.current.open = false;
  }

  function choosePosition(nextPosition: BasePosition) {
    const [nextX, nextY] = defaultWeeklyAxes[nextPosition];
    setPosition(nextPosition);
    setXMetric(nextX);
    setYMetric(nextY);
    setSelectedSavedViewId(null);
  }

  // When the league changes and the current position is no longer valid, reset
  // to RB when valid, otherwise the first valid position — with that position's
  // default axes and no selected saved view.
  useEffect(() => {
    if (validPositions.includes(position)) return;
    choosePosition(validPositions.includes("RB") ? "RB" : validPositions[0] ?? "QB");
  }, [validPositions, position, choosePosition]);

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
  }
  const chartData = useMemo(() => {
    if (!selectedX || !selectedY) return [];
    const mapped = chartEntities
      .filter((entity) => entity.position === position)
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

  if (!entities.length || !selectedX || !selectedY) {
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

      {view === "charts" ? <>
      <SegmentedControl className="analytics-position-tabs" value={position} onChange={choosePosition} label="Weekly chart position" options={validPositions.map((item) => ({ value: item, label: item === "DEF" ? "DST" : item }))} />
      <SavedViewControls
        dataset="projections"
        presets={presets}
        validPositions={validPositions}
        config={config}
        selectedSavedViewId={selectedSavedViewId}
        onSelectedSavedViewIdChange={setSelectedSavedViewId}
        onApplySavedView={applySavedView}
        onApplyBuiltIn={(preset) => { setXMetric(preset.x); setYMetric(preset.y); setSelectedSavedViewId(null); closeAdvancedControls(); }}
        onChooseCustom={openAdvancedControls}
      />
      <details className="chart-advanced-controls" ref={advancedControlsRef}>
        <summary>Advanced chart controls</summary>
        <div>
          <div className="analytics-selectors advanced-only-selectors">
            <label><span>X axis</span><select aria-label="Choose weekly horizontal axis" value={selectedX.key} onChange={(event) => { setXMetric(event.target.value); setSelectedSavedViewId(null); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
            <label><span>Y axis</span><select aria-label="Choose weekly vertical axis" value={selectedY.key} onChange={(event) => { setYMetric(event.target.value); setSelectedSavedViewId(null); }}>{metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label>
            <label className="plot-limit"><span>Players shown</span><select aria-label="Choose weekly players shown" value={plotLimit} onChange={(event) => { setPlotLimit(event.target.value as PlotLimit); setSelectedSavedViewId(null); }}><option value="24">Top 24 + my team</option><option value="40">Top 40 + my team</option><option value="all">All with data</option></select></label>
            <PercentileCutoffSelect axis="X" value={xPercentile} onChange={(value) => { setXPercentile(value); setSelectedSavedViewId(null); }} />
            <PercentileCutoffSelect axis="Y" value={yPercentile} onChange={(value) => { setYPercentile(value); setSelectedSavedViewId(null); }} />
          </div>
          <label className="chart-checkbox"><input type="checkbox" checked={showQuadrants} onChange={(event) => { setShowQuadrants(event.target.checked); setSelectedSavedViewId(null); }} /><span>Show quadrant guides and percentile cutoffs</span></label>
        </div>
      </details>
      <button type="button" className="chart-open-button" onClick={() => setIsChartOpen(true)}>View chart</button>
      <ChartDialog
        isOpen={isChartOpen}
        onClose={() => setIsChartOpen(false)}
        title={`${position === "DEF" ? "DST" : position} field`}
        subtitle={`Week ${dashboard.week} projections`}
        count={chartData.length}
        countLabel={position === "DEF" ? "teams" : "players"}
      >
        {isTierCliffView ? (
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
              labelData={labelData}
              leaderIds={leaderIds}
              selectedTeamIds={selectedTeamIds}
              xAxis={{ short: selectedX.short, lowerIsBetter: selectedX.lowerIsBetter, titleSuffix: "" }}
              yAxis={{ short: selectedY.short, lowerIsBetter: selectedY.lowerIsBetter, titleSuffix: "" }}
              showQuadrants={showQuadrants}
              xCutoff={xCutoff}
              yCutoff={yCutoff}
              ariaLabel={`${position === "DEF" ? "DST" : position} weekly projection scatter plot comparing ${selectedX.label} and ${selectedY.label}`}
            />
            <ChartKey leagueShortName={shortLeagueName(league.name)} showQuadrants={showQuadrants} xPercentile={xPercentile} yPercentile={yPercentile} />
            <OmittedChartLabels omittedNames={omittedNames} />
          </>
        )}
      </ChartDialog>
      </> : null}
    </section>
  );
}

function ToolDatasetToggle({ value, onChange, label }: { value: ToolDataset; onChange: (value: ToolDataset) => void; label: string }) {
  return (
    <SegmentedControl
      className="tool-dataset-toggle"
      value={value}
      onChange={onChange}
      label={label}
      options={[{ value: "advanced", label: "Advanced Stats" }, { value: "projections", label: "Projections" }]}
    />
  );
}

export function ChartsTool({ dashboard, league }: { dashboard: Dashboard; league: League; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  const [dataset, setDataset] = useState<ToolDataset>("advanced");
  return (
    <>
      <ToolDatasetToggle value={dataset} onChange={setDataset} label="Chart dataset" />
      {dataset === "advanced"
        ? <AnalyticsChart dashboard={dashboard} league={league} />
        : <WeeklyProjections dashboard={dashboard} league={league} view="charts" />}
    </>
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

const projectionSupportingMetricKeys: Record<BasePosition, string[]> = {
  QB: ["leaguePositionRank", "sleeperProjection", "teamTotal", "stat_pass_yd", "stat_pass_td"],
  RB: ["leaguePositionRank", "sleeperProjection", "stat_rush_yd", "stat_rec"],
  WR: ["leaguePositionRank", "sleeperProjection", "stat_rec", "stat_rec_yd"],
  TE: ["leaguePositionRank", "sleeperProjection", "stat_rec", "stat_rec_yd"],
  K: ["leaguePositionRank", "sleeperProjection", "teamTotal"],
  DEF: ["opponentTotal"],
};

const advancedSupportingMetricKeys: Record<BasePosition, string[]> = {
  QB: ["pass_attempts", "passing_yards", "passing_tds", "passing_epa"],
  RB: ["touches", "scrimmage_yards", "target_share", "rushing_tds"],
  WR: ["targets", "receiving_yards", "target_share", "air_yards_share"],
  TE: ["targets", "receiving_yards", "target_share", "air_yards_share"],
  K: ["fg_attempts", "fg_made", "fg_40_plus", "fg_50_plus"],
  DEF: ["qb_hits", "takeaways", "sacks", "defensive_tds"],
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

function ComparisonMetricRow({ row, leftName, rightName }: { row: ComparisonRow; leftName: string; rightName: string }) {
  const { metric, leftValue, rightValue } = row;
  const leftWins = Boolean(leftValue && rightValue && (metric.lowerIsBetter ? leftValue.value < rightValue.value : leftValue.value > rightValue.value));
  const rightWins = Boolean(leftValue && rightValue && (metric.lowerIsBetter ? rightValue.value < leftValue.value : rightValue.value > leftValue.value));
  const tied = Boolean(leftValue && rightValue && leftValue.value === rightValue.value);
  const leftDisplay = leftValue ? metricDisplay(leftValue.value, metric) : "—";
  const rightDisplay = rightValue ? metricDisplay(rightValue.value, metric) : "—";
  const [leftShare, rightShare] = comparisonBarShares(row);

  return (
    <div
      className="comparison-data-row"
      role="group"
      aria-label={`${metric.label}. ${leftName}: ${leftDisplay}${leftWins ? ", leads" : tied ? ", tied" : ""}. ${rightName}: ${rightDisplay}${rightWins ? ", leads" : tied ? ", tied" : ""}.`}
    >
      <div className="comparison-data-label">
        <b>{metric.label}</b>
        {metric.lowerIsBetter ? <small>Lower is better</small> : null}
      </div>
      <div className="player-comparison-bar" aria-hidden="true">
        <span
          className={`player-comparison-segment left${leftWins ? " is-winner" : ""}${!leftValue ? " is-unavailable" : ""}`}
          style={{ width: `${leftShare}%` }}
        >
          <strong>{leftDisplay}</strong>
        </span>
        <span
          className={`player-comparison-segment right${rightWins ? " is-winner" : ""}${!rightValue ? " is-unavailable" : ""}`}
          style={{ width: `${rightShare}%` }}
        >
          <strong>{rightDisplay}</strong>
        </span>
      </div>
    </div>
  );
}

function comparisonMatchupLabel(player: ComparisonEntity): string {
  if (player.isBye) return "Bye week";
  if (!player.opponent) return "Matchup TBD";
  return `${player.isAway ? "@" : "vs"} ${player.opponent}`;
}

function ComparisonHeadToHead({ left, right }: { left: ComparisonEntity; right: ComparisonEntity }) {
  return (
    <div className="comparison-head-to-head" aria-label={`${left.name} versus ${right.name}`}>
      {[left, right].map((player, index) => (
        <div className="comparison-head-player" key={player.id}>
          <strong>{player.name}</strong>
          <span>{player.team || "Team TBD"} · {comparisonMatchupLabel(player)}</span>
          <time>{gameTimeLabel(player.gameTime)}</time>
          {index === 0 ? <i aria-hidden="true">VS</i> : null}
        </div>
      ))}
    </div>
  );
}

function ComparisonPlayerSlot({ slot, player, playerId, options, sosEntry, onChoose, onClear, onOpenPlayer, onOpenMatchup }: {
  slot: 1 | 2;
  player: ComparisonEntity | undefined;
  playerId?: string;
  options: ComparisonEntity[];
  sosEntry?: StrengthOfScheduleEntryLike;
  onChoose: (entity: ComparisonEntity) => void;
  onClear: () => void;
  onOpenPlayer?: (playerId: string) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const inputId = `comparison-position-player-${slot}`;
  const needle = comparablePlayerName(query.trim());

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

  function choose(entity: ComparisonEntity) {
    onChoose(entity);
    setQuery("");
  }

  function clear() {
    onClear();
    setQuery("");
  }

  return (
    <section className={`comparison-player-slot slot-${slot}${player ? " is-populated" : ""}`} aria-labelledby={`${inputId}-label`}>
      <div className="trade-side-heading comparison-slot-header">
        <div><h2 id={`${inputId}-label`}>Player {slot}</h2></div>
        {player ? <button type="button" onClick={clear} aria-label={`Clear player ${slot}`}>Clear</button> : null}
      </div>
      <div id={`${inputId}-editor`} className="trade-side-search-wrap comparison-slot-editor">
        <label className="sr-only" htmlFor={inputId}>{player ? `Replace player ${slot}` : `Search for player ${slot}`}</label>
        <div className="search-field comparison-slot-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            id={inputId}
            type="search"
            aria-label={player ? `Search to replace player ${slot}` : `Search players for comparison slot ${slot}`}
            name={`comparison-player-${slot}`}
            placeholder={player ? `Replace ${player.name}…` : `Add player ${slot}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const firstMatch = matches[0];
                if (firstMatch) { event.preventDefault(); choose(firstMatch); }
              } else if (event.key === "Escape") {
                setQuery("");
              }
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label={`Clear player ${slot} search`}>×</button> : null}
        </div>
        {needle ? (
          <div className="comparison-slot-results inline-search-results" aria-label={`Players available for comparison slot ${slot}`} aria-live="polite">
            {matches.map((entity) => (
              <button type="button" aria-current={player?.id === entity.id ? "true" : undefined} className={player?.id === entity.id ? "is-selected" : ""} key={entity.id} onClick={() => choose(entity)}>
                <span className="comparison-result-copy">
                  <span className="comparison-result-primary"><strong>{entity.name}</strong><b>{entity.position === "DEF" ? "DST" : entity.position}</b></span>
                  <span className="comparison-result-meta"><span className="comparison-matchup"><MatchupTag team={entity.team} opponent={entity.opponent} isAway={entity.isAway} isBye={entity.isBye} position={entity.position} entry={sosEntry} /></span><time>{gameTimeLabel(entity.gameTime)}</time></span>
                </span>
              </button>
            ))}
            {matches.length === 0 ? <div className="trade-search-empty">No players match “{query.trim()}”.</div> : null}
          </div>
        ) : null}
      </div>
      {player ? (
        <div className="comparison-selected-player">
          <div className="comparison-player-primary">
            {playerId && onOpenPlayer ? <button type="button" className="comparison-player-open" onClick={() => onOpenPlayer(playerId)} aria-label={`View ${player.name} details and news`}><strong>{player.name}</strong></button> : <strong>{player.name}</strong>}
            <b>{player.position === "DEF" ? "DST" : player.position}</b>
          </div>
          <div className="comparison-player-meta">
            <span className="comparison-matchup"><MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={player.team && player.opponent && onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase ?? null }) : undefined} /></span>
            <time>{gameTimeLabel(player.gameTime)}</time>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ComparisonView({ dashboard, league, dataset, window, position, initialPlayer, initialKey, onInitialPlayerApplied, onOpenPlayer, onOpenMatchup }: {
  dashboard: Dashboard;
  league: League;
  dataset: ToolDataset;
  window: AnalyticsWindow;
  position: BasePosition;
  initialPlayer: PlayerSelection | null;
  initialKey: number;
  onInitialPlayerApplied: () => void;
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
  const weeklyByIdentity = useMemo(() => new Map(weeklyEntities.map((entity) => [`${entity.position}:${comparablePlayerName(entity.name)}`, entity])), [weeklyEntities]);
  const entities = useMemo<ComparisonEntity[]>(() => {
    if (dataset === "projections") return weeklyEntities.filter((entity) => entity.position === position);
    return dashboard.analytics.entities.flatMap((entity) => {
      if (entity.position !== position) return [];
      const game = weeklyByIdentity.get(`${entity.position}:${comparablePlayerName(entity.name)}`);
      return [{
        id: entity.id,
        name: entity.name,
        team: entity.team,
        position: entity.position,
        opponent: game?.opponent ?? null,
        isAway: game?.isAway ?? null,
        isBye: game?.isBye ?? false,
        gameTime: game?.gameTime ?? null,
        gamePhase: game?.gamePhase ?? null,
        values: window === "season" ? entity.season : entity.rolling17,
      }];
    });
  }, [dashboard.analytics.entities, dataset, position, weeklyByIdentity, weeklyEntities, window]);

  const [selectedPlayers, setSelectedPlayers] = useState<[PlayerSelection | null, PlayerSelection | null]>([null, null]);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const initialSeedKey = useRef<number | null>(null);

  // Both slots start empty. The initialPlayer seed (waiver-row "Compare" swipe)
  // is applied only when initialKey changes, so dataset/window toggles never
  // wipe the user's picks.
  useEffect(() => {
    if (!initialPlayer || initialPlayer.position !== position) return;
    if (initialSeedKey.current === initialKey) return;
    const requested = entities.find((entity) => isSamePlayer(entity, initialPlayer));
    if (!requested) return;
    setSelectedPlayers([requested, null]);
    initialSeedKey.current = initialKey;
    onInitialPlayerApplied();
  }, [entities, initialKey, initialPlayer, onInitialPlayerApplied, position]);

  // Keep selections as player identities rather than source-specific row IDs.
  // Advanced stats and weekly projections are separate datasets and can use
  // different IDs for the same player, so resolve each pick against the active
  // dataset whenever the toggle changes. If one source has not published that
  // player yet, keep the selected card visible while showing no metrics.
  const selected = selectedPlayers.map((player): ComparisonEntity | undefined => {
    if (!player) return undefined;
    const activeEntity = entities.find((entity) => isSamePlayer(entity, player));
    if (activeEntity) return activeEntity;
    const weeklyEntity = weeklyEntities.find((entity) => isSamePlayer(entity, player));
    if (weeklyEntity) return { ...weeklyEntity, values: {} };
    return {
      ...player,
      id: player.playerId ?? `${player.position}:${comparablePlayerName(player.name)}`,
      opponent: null,
      isAway: null,
      isBye: false,
      gameTime: null,
      gamePhase: null,
      values: {},
    };
  });
  const left = selected[0];
  const right = selected[1];
  const playerDetailId = (player: ComparisonEntity | undefined): string | undefined => player
    ? player.playerId ?? weeklyByIdentity.get(`${player.position}:${comparablePlayerName(player.name)}`)?.playerId
    : undefined;
  const leftPlayerId = playerDetailId(left);
  const rightPlayerId = playerDetailId(right);
  const boomBustPlayerIds = [leftPlayerId, rightPlayerId].filter((playerId): playerId is string => Boolean(playerId));
  const supportsBoomBust = position === "QB" || position === "RB" || position === "WR" || position === "TE";
  const boomBustQuery = useQuery({
    queryKey: ["comparison-boom-bust-ranges", league.id, position, ...boomBustPlayerIds],
    queryFn: () => api.getBoomBustRanges({ leagueId: league.id, position: position as "QB" | "RB" | "WR" | "TE", playerIds: boomBustPlayerIds }),
    enabled: dataset === "projections" && supportsBoomBust && boomBustPlayerIds.length === 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const metricList = useMemo(() => {
    if (dataset === "advanced") return analyticsMetricsForLeague(position, league);
    const projectionMetrics = weeklyMetrics[position].filter((metric) => !redundantComparisonProjectionKeys.has(metric.key));
    return position === "DEF" ? projectionMetrics : [...projectionMetrics, ...teamContextMetrics];
  }, [dataset, league, position]);
  const rows: ComparisonRow[] = metricList.flatMap((metric) => {
    const leftValue = comparisonValue(left, metric);
    const rightValue = comparisonValue(right, metric);
    return leftValue || rightValue ? [{ metric, leftValue, rightValue }] : [];
  });
  const heroMetricKey = dataset === "projections" ? (position === "DEF" ? "projection" : "league") : "fantasy_league";
  const heroRow = rows.find((row) => row.metric.key === heroMetricKey) ?? rows[0];
  const supportingKeys = dataset === "projections" ? projectionSupportingMetricKeys[position] : advancedSupportingMetricKeys[position];
  const supportingRows = supportingKeys.flatMap((key) => {
    const row = rows.find((candidate) => candidate.metric.key === key);
    return row && row.metric.key !== heroRow?.metric.key ? [row] : [];
  });
  const projectionOutlookKeys = new Set(["leaguePositionRank", "sleeperProjection", "teamTotal", "opponentTotal"]);
  const productionRows = supportingRows.filter((row) => !projectionOutlookKeys.has(row.metric.key));
  const primaryKeys = new Set([heroRow?.metric.key, ...productionRows.map((row) => row.metric.key)]);
  const secondaryRows = rows.filter((row) => !primaryKeys.has(row.metric.key));
  const boomBustRows = (() => {
    if (dataset !== "projections" || !leftPlayerId || !rightPlayerId) return [];
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

  const comparisonRows = [...(heroRow ? [heroRow] : []), ...boomBustRows, ...productionRows, ...secondaryRows];
  const selectionStateClass = left && right ? " is-ready" : left || right ? " has-selection" : " is-empty";

  return (
    <section className={`comparison-view${selectionStateClass}`}>
      <div className="comparison-selector-card" aria-label={`${position === "DEF" ? "DST" : position} players being compared`}>
        <div className="comparison-cards">
          <ComparisonPlayerSlot slot={1} player={left} playerId={leftPlayerId} options={entities.filter((entity) => entity.id !== right?.id)} sosEntry={sosEntry} onChoose={(entity) => setSelectedPlayers((current) => [entity, current[1]])} onClear={() => setSelectedPlayers((current) => [null, current[1]])} onOpenPlayer={onOpenPlayer} onOpenMatchup={onOpenMatchup} />
          <ComparisonPlayerSlot slot={2} player={right} playerId={rightPlayerId} options={entities.filter((entity) => entity.id !== left?.id)} sosEntry={sosEntry} onChoose={(entity) => setSelectedPlayers((current) => [current[0], entity])} onClear={() => setSelectedPlayers((current) => [current[0], null])} onOpenPlayer={onOpenPlayer} onOpenMatchup={onOpenMatchup} />
        </div>
      </div>

      {entities.length === 0 ? (
        <div className="analytics-empty"><strong>{dataset === "advanced" ? `No ${position === "DEF" ? "DST" : position} advanced stats yet.` : `No ${position === "DEF" ? "DST" : position} weekly projections yet.`}</strong><span>{dataset === "advanced" ? "Refresh after nflverse publishes the next weekly file." : "Refresh to check the latest Vegas lines and nflverse usage data."}</span></div>
      ) : left && right ? (
        <>
          <button type="button" className="chart-open-button" onClick={() => setIsComparisonOpen(true)}>View comparison</button>
          <ChartDialog
            isOpen={isComparisonOpen}
            onClose={() => setIsComparisonOpen(false)}
            title="Player comparison"
            subtitle={`${position === "DEF" ? "DST" : position} · ${league.name}`}
            count={rows.length + boomBustRows.length}
            countLabel={rows.length + boomBustRows.length === 1 ? "metric" : "metrics"}
            closeLabel="Close comparison"
          >
            <div className="comparison-overview" aria-label={`${left.name} and ${right.name} comparison`}>
              <ComparisonHeadToHead left={left} right={right} />

              {comparisonRows.length > 0 ? (
                <div className="comparison-metric-list">
                  {comparisonRows.map((row) => <ComparisonMetricRow key={row.metric.key} row={row} leftName={left.name} rightName={right.name} />)}
                </div>
              ) : <div className="empty-inline">No shared metrics are available for these players.</div>}
            </div>
          </ChartDialog>
        </>
      ) : <div className="empty-inline">Choose two players to compare.</div>}
    </section>
  );
}

export function ComparisonTool({ dashboard, league, initialPlayer = null, initialKey = 0, onOpenPlayer, onOpenMatchup }: { dashboard: Dashboard; league: League; initialPlayer?: PlayerSelection | null; initialKey?: number; onOpenPlayer?: (playerId: string) => void; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);
  const [position, setPosition] = useState<BasePosition | null>(null);
  const [dataset, setDataset] = useState<ToolDataset>("projections");
  const [window, setWindow] = useState<AnalyticsWindow>("season");
  const [pendingSeed, setPendingSeed] = useState<{ key: number; player: PlayerSelection } | null>(null);
  const observedSeedKey = useRef<number | null>(null);

  useEffect(() => {
    if (!initialPlayer || observedSeedKey.current === initialKey) return;
    observedSeedKey.current = initialKey;
    if (!validPositions.includes(initialPlayer.position)) return;
    setPosition(initialPlayer.position);
    setPendingSeed({ key: initialKey, player: initialPlayer });
  }, [initialKey, initialPlayer, validPositions]);

  useEffect(() => {
    if (!position || validPositions.includes(position)) return;
    setPosition(null);
    setPendingSeed(null);
  }, [position, validPositions]);

  function choosePosition(next: BasePosition) {
    if (next === position) return;
    setPosition(next);
    setPendingSeed(null);
  }

  return (
    <div className="comparison-tool">
      <SegmentedControl<BasePosition | "">
        className="comparison-position-toggle analytics-position-tabs"
        value={position ?? ""}
        onChange={(next) => { if (next) choosePosition(next); }}
        label="Comparison position"
        options={validPositions.map((item) => ({ value: item, label: item === "DEF" ? "DST" : item }))}
      />
      <ToolDatasetToggle value={dataset} onChange={setDataset} label="Comparison dataset" />
      {dataset === "advanced" ? <SegmentedControl className="lineup-mode-toggle analytics-window-toggle" value={window} onChange={setWindow} label="Advanced stat window" options={[{ value: "season", label: "This season" }, { value: "rolling17", label: "Rolling 17 games" }]} /> : null}
      {position ? (
        <ComparisonView
          key={position}
          dashboard={dashboard}
          league={league}
          dataset={dataset}
          window={window}
          position={position}
          initialPlayer={pendingSeed?.player ?? null}
          initialKey={pendingSeed?.key ?? 0}
          onInitialPlayerApplied={() => setPendingSeed(null)}
          onOpenPlayer={onOpenPlayer}
          onOpenMatchup={onOpenMatchup}
        />
      ) : (
        <div className="comparison-position-empty empty-stack">
          <strong>Select a position to start.</strong>
          <span>You’ll choose two players from that position.</span>
        </div>
      )}
    </div>
  );
}


type TablesDataset = "sos" | "offense" | "defense" | "offensive-line" | "team-overall";
type PfnTableKey = Exclude<TablesDataset, "sos">;

const tableDatasets: { key: TablesDataset; label: string }[] = [
  { key: "sos", label: "SOS" },
  { key: "offense", label: "Offense" },
  { key: "defense", label: "Defense" },
  { key: "offensive-line", label: "O-Line" },
  { key: "team-overall", label: "Overall" },
];

const pfnFallbackLabels: Record<PfnTableKey, string> = {
  offense: "Offense",
  defense: "Defense",
  "offensive-line": "O-Line",
  "team-overall": "Overall",
};

function pfnUpdatedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function pfnValue(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function PfnTableView({ tableKey }: { tableKey: PfnTableKey }) {
  const query = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const table = query.data?.tables[tableKey] ?? null;
  const orderedColumns = useMemo(() => {
    if (!table) return [];
    // Use one ordered column list for both the header and every body row. PFN's
    // stored column order varies by table, while Grade always belongs directly
    // after Team.
    return ["grade", ...table.columns.filter((column) => !["rank", "team", "grade"].includes(column))];
  }, [table]);
  const [sortKey, setSortKey] = useState("rank");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setSortKey("rank");
    setSortDirection("asc");
  }, [tableKey]);

  const rows = useMemo(() => {
    if (!table) return [];
    const cleanRows = table.rows.filter((row) => row.team.trim().toLowerCase() !== "team");
    const getValue = (row: (typeof cleanRows)[number]): string | number | null => {
      if (sortKey === "rank") return row.rank;
      if (sortKey === "team") return row.team;
      return row[sortKey] ?? null;
    };
    return cleanRows.slice().sort((a, b) => {
      const aValue = getValue(a);
      const bValue = getValue(b);
      if (aValue === null && bValue === null) return a.rank - b.rank;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      const comparison = typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
      return (sortDirection === "asc" ? comparison : -comparison) || a.rank - b.rank;
    });
  }, [sortDirection, sortKey, table]);

  const changeSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "team" || key === "rank" ? "asc" : "desc");
  };

  const ariaSort = (key: string): "ascending" | "descending" | "none" => sortKey === key
    ? (sortDirection === "asc" ? "ascending" : "descending")
    : "none";

  const sortIndicator = (key: string) => (
    <span className={sortKey === key ? "pfn-sort-indicator active" : "pfn-sort-indicator"} aria-hidden="true">
      {sortKey === key && sortDirection === "desc" ? "↓" : "↑"}
    </span>
  );

  if (query.isPending) {
    return <div className="pfn-table-loading" role="status">Loading…</div>;
  }

  if (query.isError) {
    return (
      <div className="section-error compact" role="alert">
        <strong>PFN {pfnFallbackLabels[tableKey]} rankings didn’t load.</strong>
        <button type="button" onClick={() => { void query.refetch(); }} disabled={query.isFetching}>Retry</button>
      </div>
    );
  }

  if (!table) {
    return (
      <div className="section-error compact" role="status">
        <strong>No PFN {pfnFallbackLabels[tableKey]} rankings have been published yet.</strong>
        <button type="button" onClick={() => { void query.refetch(); }} disabled={query.isFetching}>Check again</button>
      </div>
    );
  }

  return (
    <section className="pfn-table-view" aria-label={`PFN ${table.label} rankings`}>
      <div className="section-heading">
        <h2>{table.label}</h2>
        <span>Updated {pfnUpdatedDate(table.fetched_at)}</span>
      </div>
      <div className="pfn-table-wrap" role="region" aria-label={`${table.label} team rankings`} tabIndex={0}>
        <Table className="pfn-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="pfn-rank-col" aria-sort={ariaSort("rank")}>
                <button type="button" className="pfn-sort-button" aria-label="Sort by rank" onClick={() => changeSort("rank")}>
                  <span className="pfn-header-label">Rank</span> {sortIndicator("rank")}
                </button>
              </TableHead>
              <TableHead scope="col" className="pfn-team-col" aria-sort={ariaSort("team")}>
                <button type="button" className="pfn-sort-button" onClick={() => changeSort("team")}>
                  Team {sortIndicator("team")}
                </button>
              </TableHead>
              {orderedColumns.map((column) => (
                <TableHead scope="col" className={column === "grade" ? "pfn-grade-col" : undefined} key={column} aria-sort={ariaSort(column)}>
                  <button type="button" className="pfn-sort-button" onClick={() => changeSort(column)}>
                    {column === "grade" ? "Grade" : (table.column_labels[column] ?? column)} {sortIndicator(column)}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.team}>
                <TableCell className="pfn-rank-col"><strong>{row.rank}</strong></TableCell>
                <TableHead scope="row" className="pfn-team-col">{row.team}</TableHead>
                {orderedColumns.map((column) => (
                  <TableCell className={column === "grade" ? "pfn-grade-col" : undefined} key={column}>
                    {column === "grade" ? <strong>{pfnValue(row[column])}</strong> : pfnValue(row[column])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function TablesTool({ dashboard, league, sosLoadFailed, onRetrySos, sosRetrying }: { dashboard: Dashboard; league: League; sosLoadFailed: boolean; onRetrySos: () => void; sosRetrying: boolean }) {
  const [dataset, setDataset] = useState<TablesDataset>("sos");
  return (
    <section className="tables-tool" aria-label="Team data tables">
      <Tabs value={dataset} onValueChange={(value) => setDataset(value as TablesDataset)} className="tables-dataset-tabs">
        <TabsList aria-label="Choose table" className="grid grid-cols-5">
          {tableDatasets.map((item) => (
            <TabsTrigger key={item.key} value={item.key}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {dataset === "sos"
        ? <StrengthOfScheduleTool dashboard={dashboard} league={league} loadFailed={sosLoadFailed} onRetry={onRetrySos} retrying={sosRetrying} />
        : <PfnTableView tableKey={dataset} />}
    </section>
  );
}

const sosPositions = ["QB", "RB", "WR", "TE"] as const;
type SosPosition = typeof sosPositions[number];

function sosCellTone(rank: number | null): string {
  if (rank === null) return "";
  if (rank <= 10) return " sos-soft";
  if (rank >= 23) return " sos-tough";
  return "";
}

type SosSort = { key: "team" | SosPosition; direction: "asc" | "desc" };

export function StrengthOfScheduleTool({ dashboard, league, loadFailed = false, onRetry, retrying = false }: { dashboard: Dashboard; league: League; loadFailed?: boolean; onRetry?: () => void; retrying?: boolean }) {
  const entry = dashboard.strengthOfSchedule.find((row) => row.leagueId === league.id);
  const [sort, setSort] = useState<SosSort>({ key: "team", direction: "asc" });
  const teams = useMemo(() => {
    if (!entry) return [];
    return Object.keys(entry.table).sort((a, b) => {
      if (sort.key === "team") return a.localeCompare(b);
      const aRank = entry.table[a]?.[sort.key]?.rank ?? Number.MAX_SAFE_INTEGER;
      const bRank = entry.table[b]?.[sort.key]?.rank ?? Number.MAX_SAFE_INTEGER;
      const order = sort.direction === "asc" ? aRank - bRank : bRank - aRank;
      return order || a.localeCompare(b);
    });
  }, [entry, sort]);

  function sortBy(key: "team" | SosPosition) {
    setSort((current) => {
      if (key === "team") return { key: "team", direction: "asc" };
      if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      return { key, direction: "asc" };
    });
  }

  function indicator(key: "team" | SosPosition): string {
    if (sort.key !== key) return "";
    return sort.direction === "asc" ? " ↑" : " ↓";
  }

  return (
    <section className="sos-view" aria-label="Fantasy strength of schedule">
      <div className="section-heading">
        <h2>Fantasy Strength of Schedule</h2>
        {entry ? <span>through Week {entry.throughWeek}{entry.throughWeek <= 3 ? " · early-season sample" : ""}</span> : null}
      </div>
      <div className="sos-legend" aria-label="Matchup highlighting legend">
        <span><i className="sos-legend-swatch sos-soft" aria-hidden="true" />Ranks 1–10 · soft</span>
        <span><i className="sos-legend-swatch sos-tough" aria-hidden="true" />Ranks 23–32 · tough</span>
      </div>
      {entry && teams.length > 0 ? (
        <div className="sos-table-wrap" role="region" aria-label="Defense versus position ranks" tabIndex={0}>
          <Table className="sos-table">
            <colgroup>
              <col className="sos-column" />
              {sosPositions.map((position) => <col className="sos-column" key={position} />)}
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="sos-team-col" aria-sort={sort.key === "team" ? "ascending" : "none"}>
                  <button type="button" onClick={() => sortBy("team")} aria-label="Sort teams alphabetically">Team<span aria-hidden="true">{indicator("team")}</span></button>
                </TableHead>
                {sosPositions.map((position: SosPosition) => (
                  <TableHead key={position} scope="col" aria-sort={sort.key === position ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => sortBy(position)} aria-label={`Sort ${position} matchups ${sort.key === position && sort.direction === "asc" ? "toughest first" : "softest first"}`}>
                      {position}<span aria-hidden="true">{indicator(position)}</span>
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team}>
                  <TableHead scope="row" className="sos-team-col">{team}</TableHead>
                  {sosPositions.map((position: SosPosition) => {
                    const cell = entry.table[team]?.[position];
                    return (
                      <TableCell
                        key={position}
                        className={`sos-cell${sosCellTone(cell?.rank ?? null)}`}
                        aria-label={cell ? `${team} ${position} matchup rank ${cell.rank}${cell.rank <= 10 ? ", soft matchup" : cell.rank >= 23 ? ", tough matchup" : ""}` : `${team} ${position} matchup unavailable`}
                      >
                        {cell ? cell.rank : "—"}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : loadFailed ? (
        <div className="section-error compact" role="alert">
          <strong>Strength of schedule didn’t load.</strong>
          {onRetry ? <button type="button" onClick={onRetry} disabled={retrying}>Retry</button> : null}
        </div>
      ) : (
        <div className="sos-empty" role="status">Strength of schedule isn’t ready yet. It will appear after the first finalized week.</div>
      )}
    </section>
  );
}
