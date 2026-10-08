import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import React from "react";
// Local replacement for @hatch/space-sdk's SafeAreaTopScrim (removed during
// Vercel migration). Renders a top scrim respecting the device safe area.
function SafeAreaTopScrim({ backgroundColor }: { backgroundColor?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height: "env(safe-area-inset-top, 0px)",
        backgroundColor: backgroundColor ?? "transparent",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    />
  );
}
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";
import { supabase } from "./supabase";

const BROWSER_DASHBOARD_CACHE_KEY = "fantasy-rankings-dashboard-v7";

function signOutForPersonalData(error: unknown): void {
  const message = error instanceof Error ? error.message : "";
  if (!supabase) return;
  if (message !== "Sign in required." && !message.includes("API 401")) return;
  localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
  void supabase.auth.signOut();
}
import { MatchupTag, ModalPortal, SegmentedControl, useDialogFocusTrap, type StrengthOfScheduleEntryLike } from "./shared";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type League = Dashboard["leagues"][number];
type RosterPlayer = League["starters"][number];
type Tab = "team" | "rankings" | "waivers" | "power" | "draft" | "trade" | "charts" | "comparison" | "strengthOfSchedule";
type PrimaryPage = "team" | "players" | "league" | "draft" | "tools";
type PlayerNews = ApiResponse<typeof api, "getPlayerNews">;
type DraftCenterData = ApiResponse<typeof api, "getDraftCenter">;
type DashboardSection = ApiResponse<typeof api, "getDashboardSection">;
type MetaSection = Extract<DashboardSection, { section: "meta" }>;
type TeamSection = Extract<DashboardSection, { section: "team" }>;
type PlayersSection = Extract<DashboardSection, { section: "players" }>;
type LeagueSection = Extract<DashboardSection, { section: "league" }>;
type AnalyticsSection = Extract<DashboardSection, { section: "analytics" }>;
type PlayerNewsItem = PlayerNews["runs"][number]["items"][number];
type ValueHistorySeries = ApiResponse<typeof api, "getValueHistory">["series"][number];
type HistoricalTrades = ApiResponse<typeof api, "getHistoricalTrades">;
type HistoricalTrade = HistoricalTrades["trades"][number];
type HistoricalTradeTeam = HistoricalTrade["teams"][number];
type BoomBustHistory = ApiResponse<typeof api, "getBoomBustHistory">;
type PfnTables = ApiResponse<typeof api, "getPfnTables">["tables"];
type PfnTable = NonNullable<PfnTables[keyof PfnTables]>;
type PfnRow = PfnTable["rows"][number];
type TeamSituational = NonNullable<ApiResponse<typeof api, "getPfnTables">["teamSituational"]>;
type TeamSituationalRow = TeamSituational["rows"][number];
type BasePosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
type BoomBustPosition = Extract<BasePosition, "QB" | "RB" | "WR" | "TE">;
type PositionFilter = BasePosition | "ALL" | "FLEX" | "SUPER" | "ROOKIES";
type TradeAsset = Dashboard["seasonLongRankings"][number];
type PlayerSearchResult = {
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

type PlayerDetailTab = "overview" | "season" | "advanced";
type AnalyticsEntity = Dashboard["analytics"]["entities"][number];
type DetailMetric = { key: string; label: string; unit?: string; digits?: number; derived?: (values: Record<string, number>) => number | null };

const detailAdvancedMetrics: Partial<Record<BasePosition, DetailMetric[]>> = {
  QB: [
    { key: "pass_attempts", label: "Pass attempts / game", digits: 1 },
    { key: "completion_pct", label: "Completion rate", unit: "%", digits: 1 },
    { key: "cpoe", label: "CPOE", unit: "%", digits: 1 },
    { key: "epa_per_play", label: "EPA / play", digits: 2 },
    { key: "carries", label: "Carries / game", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
  ],
  RB: [
    { key: "touches", label: "Touches / game", digits: 1 },
    { key: "target_share", label: "Target share", unit: "%", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
    { key: "scrimmage_yards", label: "Scrimmage yds / game", digits: 1 },
    { key: "yards_per_touch", label: "Yards / touch", digits: 2, derived: (values) => {
      const touches = values.touches;
      const yards = values.scrimmage_yards;
      return typeof touches === "number" && touches > 0 && typeof yards === "number" ? yards / touches : null;
    } },
    { key: "rushing_epa", label: "Rushing EPA / game", digits: 2 },
  ],
  WR: [
    { key: "targets", label: "Targets / game", digits: 1 },
    { key: "target_share", label: "Target share", unit: "%", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
    { key: "air_yards_share", label: "Air-yards share", unit: "%", digits: 1 },
    { key: "wopr", label: "WOPR", digits: 2 },
    { key: "yards_per_target", label: "Yards / target", digits: 2, derived: (values) => {
      const targets = values.targets;
      const yards = values.receiving_yards;
      return typeof targets === "number" && targets > 0 && typeof yards === "number" ? yards / targets : null;
    } },
  ],
  TE: [
    { key: "targets", label: "Targets / game", digits: 1 },
    { key: "target_share", label: "Target share", unit: "%", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
    { key: "air_yards_share", label: "Air-yards share", unit: "%", digits: 1 },
    { key: "wopr", label: "WOPR", digits: 2 },
    { key: "yards_per_target", label: "Yards / target", digits: 2, derived: (values) => {
      const targets = values.targets;
      const yards = values.receiving_yards;
      return typeof targets === "number" && targets > 0 && typeof yards === "number" ? yards / targets : null;
    } },
  ],
  K: [
    { key: "fg_attempts", label: "FG attempts / game", digits: 1 },
    { key: "fg_pct", label: "Field-goal rate", unit: "%", digits: 1 },
    { key: "fg_50_plus", label: "50+ FG / game", digits: 1 },
    { key: "pat_attempts", label: "PAT attempts / game", digits: 1 },
  ],
  DEF: [
    { key: "qb_hits", label: "QB hits / game", digits: 1 },
    { key: "sacks", label: "Sacks / game", digits: 1 },
    { key: "takeaways", label: "Takeaways / game", digits: 1 },
    { key: "tackles_for_loss", label: "TFL / game", digits: 1 },
  ],
};

const gameLogStatLabels: Record<string, string> = {
  passCmp: "CMP", passAtt: "ATT", passYds: "PASS YDS", passTd: "PASS TD", interceptions: "INT",
  rushAtt: "CAR", rushYds: "RUSH YDS", rushTd: "RUSH TD", targets: "TGT", receptions: "REC",
  recYds: "REC YDS", recTd: "REC TD", fantasyPoints: "FPTS",
};

function usePlayerCardHistory() {
  const [history, setHistory] = useState<{ entries: PlayerSearchResult[]; index: number }>({ entries: [], index: -1 });

  const open = useCallback((player: PlayerSearchResult) => {
    setHistory((current) => {
      const active = current.index >= 0 ? current.entries[current.index] : undefined;
      if (active?.playerId === player.playerId) return current;
      const entries = [...current.entries.slice(0, current.index + 1), player];
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const back = useCallback(() => {
    setHistory((current) => current.index > 0 ? { ...current, index: current.index - 1 } : current);
  }, []);

  const close = useCallback(() => {
    setHistory({ entries: [], index: -1 });
  }, []);

  const current = history.index >= 0 ? history.entries[history.index] ?? null : null;
  return {
    current,
    canGoBack: history.index > 0,
    isOpen: current !== null,
    open,
    back,
    close,
  };
}

const LazyPowerRankings = lazy(() => import("./PowerRankings").then((module) => ({ default: module.PowerRankings })));
const LazyChartsTool = lazy(() => import("./AnalyticsViews").then((module) => ({ default: module.ChartsTool })));
const LazyComparisonTool = lazy(() => import("./AnalyticsViews").then((module) => ({ default: module.ComparisonTool })));
const LazyTablesTool = lazy(() => import("./AnalyticsViews").then((module) => ({ default: module.TablesTool })));

const basePositionOrder: BasePosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

function isBoomBustPosition(position: string): position is BoomBustPosition {
  return position === "QB" || position === "RB" || position === "WR" || position === "TE";
}

function positionsForFilter(filter: PositionFilter): BasePosition[] {
  if (filter === "ALL") return ["QB", "RB", "WR", "TE"];
  if (filter === "FLEX") return ["RB", "WR", "TE"];
  if (filter === "SUPER") return ["QB", "RB", "WR", "TE"];
  if (filter === "ROOKIES") return ["QB", "RB", "WR", "TE"];
  return [filter];
}

type ValuationMode = "market" | "league";
type TradeTeam = League["tradeTeams"][number];

type OptimizedRoster = {
  starters: RosterPlayer[];
  bench: RosterPlayer[];
  score: number;
};

function tradeTotal(assets: TradeAsset[]): number {
  return assets.reduce((total, asset) => total + asset.value, 0);
}

function shortLeagueName(name: string): string {
  return name
    .replace("Tits Out for The Ladz XII (TWELVE😤)", "Ladz XII")
    .replace("C2C. The real superconference", "C2C Superconference")
    .replace("Hoe Ass Dynasty League", "Hoe Ass Dynasty");
}

function formatProjectionPoints(value: number | null, source?: PlayerSearchResult["projectionSource"]): string {
  if (value === null) return "—";
  return source === "vegas" ? value.toString() : value.toFixed(1);
}

type ProjectionComponent = { key: string; label: string; value: number; isYards: boolean };

const projectionComponentFields: Partial<Record<BasePosition, ReadonlyArray<{ key: string; label: string }>>> = {
  QB: [
    { key: "pass_yd", label: "Pass yds" },
    { key: "pass_td", label: "Pass TD" },
    { key: "pass_int", label: "INT" },
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
  ],
  RB: [
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Rec yds" },
    { key: "rec_td", label: "Rec TD" },
  ],
  WR: [
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Rec yds" },
    { key: "rec_td", label: "Rec TD" },
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
  ],
  TE: [
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Rec yds" },
    { key: "rec_td", label: "Rec TD" },
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
  ],
};

const kickerComponentLabels: Record<string, string> = {
  fgm: "Field goals made",
  fgmiss: "Field goals missed",
  fgm_0_19: "FG made · 0–19",
  fgm_20_29: "FG made · 20–29",
  fgm_30_39: "FG made · 30–39",
  fgm_40_49: "FG made · 40–49",
  fgm_50_59: "FG made · 50–59",
  fgm_60p: "FG made · 60+",
  fgm_50p: "FG made · 50+",
  fgmiss_0_19: "FG missed · 0–19",
  fgmiss_20_29: "FG missed · 20–29",
  fgmiss_30_39: "FG missed · 30–39",
  fgmiss_40_49: "FG missed · 40–49",
  fgmiss_50_59: "FG missed · 50–59",
  fgmiss_60p: "FG missed · 60+",
  xpm: "Extra points made",
  xpmiss: "Extra points missed",
};

const defenseComponentLabels: Record<string, string> = {
  sack: "Sacks",
  int: "Interceptions",
  fum_rec: "Fumble recoveries",
  def_td: "Defensive TDs",
  safe: "Safeties",
  blk_kick: "Blocked kicks",
  def_2pt: "Defensive 2-pt",
  st_td: "Return TDs",
  st_fum_rec: "ST fumble recoveries",
  pr_yd: "Punt return yds",
  kr_yd: "Kick return yds",
  pr_td: "Punt return TDs",
  kr_td: "Kick return TDs",
  pts_allow: "Points allowed",
  yds_allow: "Yards allowed",
};

function projectionComponentsForPlayer(player: PlayerSearchResult): ProjectionComponent[] {
  const components = player.projectionComponents;
  if (!components || player.position === "DEF") return [];
  if (player.position === "K") {
    const preferredOrder = Object.keys(kickerComponentLabels);
    return Object.entries(components)
      .filter(([key, value]) => key in kickerComponentLabels && Number.isFinite(value))
      .sort(([a], [b]) => {
        const aIndex = preferredOrder.indexOf(a);
        const bIndex = preferredOrder.indexOf(b);
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex) || a.localeCompare(b);
      })
      .map(([key, value]) => ({
        key,
        label: kickerComponentLabels[key] ?? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value,
        isYards: /(?:^|_)yds?$/.test(key),
      }));
  }
  return (projectionComponentFields[player.position as BasePosition] ?? []).flatMap(({ key, label }) => {
    const value = components[key];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ key, label, value, isYards: key.endsWith("_yd") }]
      : [];
  });
}

function matchupLabel(opponent: string | null, isAway: boolean | null | undefined): string {
  if (!opponent) return "";
  return `${isAway ? "@" : "vs"} ${opponent}`;
}

function accessibleMatchupLabel(team: string | null, opponent: string | null, isAway: boolean | null | undefined, isBye: boolean): string {
  if (opponent) return `${team ?? "free agent"} ${isAway ? "at" : "versus"} ${opponent}`;
  return isBye ? `${team ?? "free agent"}, bye` : `${team ?? "free agent"}, matchup unavailable`;
}

function decimalPlaces(value: number): number {
  const normalized = value.toString().toLowerCase();
  if (!normalized.includes("e")) return normalized.split(".")[1]?.length ?? 0;
  const [coefficient = "0", exponentText = "0"] = normalized.split("e");
  const exponent = Number(exponentText);
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  return Math.max(0, fractionLength - exponent);
}

function forecastPoints(value: number | null, players: RosterPlayer[]): string {
  if (value === null) return "—";
  const vegasPrecision = players.reduce((precision, player) => (
    player.gamePhase !== "final" && player.projectionSource === "vegas" && player.projection !== null
      ? Math.max(precision, decimalPlaces(player.projection))
      : precision
  ), 0);
  return vegasPrecision > 0 ? value.toFixed(vegasPrecision) : formatProjectionPoints(value);
}

function comparablePlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function playerScore(player: RosterPlayer): { value: number | null; label: "PROJ" | "PTS" } {
  return player.gamePhase === "final"
    ? { value: player.actual, label: "PTS" }
    : { value: player.projection, label: "PROJ" };
}

function sleeperInjuryTag(status: string): string {
  const normalized = status.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  const labels: Record<string, string> = {
    questionable: "Q",
    doubtful: "D",
    out: "O",
    "injured reserve": "IR",
    ir: "IR",
    "physically unable to perform": "PUP",
    pup: "PUP",
    suspended: "SUS",
    suspension: "SUS",
    sus: "SUS",
    "non football injury": "NFI",
    "non football illness": "NFI",
    nfi: "NFI",
    inactive: "INA",
    covid: "COV",
    "covid 19": "COV",
  };
  return labels[normalized] ?? (status.length <= 4 ? status.toUpperCase() : status.slice(0, 1).toUpperCase());
}

function newsTimeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function groupNewsItemsByPlayer(news: PlayerNews | undefined): Map<string, PlayerNewsItem[]> {
  const itemsByPlayer = new Map<string, PlayerNewsItem[]>();
  for (const run of news?.runs ?? []) {
    for (const item of run.items) {
      const items = itemsByPlayer.get(item.playerId);
      if (items) items.push(item);
      else itemsByPlayer.set(item.playerId, [item]);
    }
  }
  return itemsByPlayer;
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg className={spinning ? "spin" : ""} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.3 9A7 7 0 0 0 6.5 6.5L4 9m16 6-2.5 2.5A7 7 0 0 1 5.7 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavigationIcon({ page }: { page: PrimaryPage }) {
  const paths: Record<PrimaryPage, ReactNode> = {
    team: <><path d="M4 19V8l8-4 8 4v11" /><path d="M8 19v-5h8v5M8 9h.01M12 9h.01M16 9h.01" /></>,
    players: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-4 2.3-6 5.5-6s5 2 5.5 6M16 6.5a2.5 2.5 0 0 1 0 5M16 14c2.7.2 4.2 1.9 4.5 5" /></>,
    league: <><path d="M7 4h10v3c0 3-2 5-5 5S7 10 7 7V4Z" /><path d="M7 6H4v1c0 2 1.4 3.5 3.5 3.8M17 6h3v1c0 2-1.4 3.5-3.5 3.8M12 12v4M8 20h8M9 16h6" /></>,
    draft: <><path d="M5 4h14v4H5z" /><path d="M4 10h16v10H4zM8 13v4M12 13v4M16 13v4" /></>,
    tools: <><path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z" /></>,
  };
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[page]}</g>
    </svg>
  );
}

function primaryPageForTab(tab: Tab): PrimaryPage {
  if (tab === "rankings" || tab === "waivers") return "players";
  if (tab === "power") return "league";
  if (tab === "trade" || tab === "charts" || tab === "comparison" || tab === "strengthOfSchedule") return "tools";
  return tab;
}

function movementPercent(value: number, change: number | null): number | null {
  if (change === null) return null;
  const priorValue = value - change;
  if (priorValue <= 0) return change > 0 ? Number.POSITIVE_INFINITY : 0;
  return (change / priorValue) * 100;
}

function movementLabel(percent: number | null): string {
  if (percent === null) return "No 30-day history";
  if (!Number.isFinite(percent)) return "Up from zero over 30 days";
  const rounded = Math.round(percent);
  return `${rounded > 0 ? "+" : ""}${rounded}% over 30 days`;
}

function SectionError({ title, onRetry, retrying = false, compact = false }: { title: string; onRetry: () => void; retrying?: boolean; compact?: boolean }) {
  return (
    <div className={`section-error${compact ? " compact" : ""}`} role="alert">
      <strong>{title}</strong>
      <button type="button" onClick={onRetry} disabled={retrying}>
        <RefreshIcon spinning={retrying} /> Retry
      </button>
    </div>
  );
}

function canonicalNflTeam(team: string | null): string | null {
  if (!team) return null;
  const normalized = team.trim().toUpperCase();
  if (normalized === "JAC") return "JAX";
  if (normalized === "WSH") return "WAS";
  if (normalized === "LA") return "LAR";
  return normalized;
}

function pfnNumber(row: PfnRow | undefined, key: string): number | null {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pfnSortedMetricValues(table: PfnTable | null, key: string, higherIsBetter = true): number[] | null {
  if (!table) return null;
  return table.rows
    .map((row) => pfnNumber(row, key))
    .filter((value): value is number => value !== null)
    .sort((a, b) => higherIsBetter ? b - a : a - b);
}

function pfnRankForRow(table: PfnTable | null, row: PfnRow | undefined, key: string, higherIsBetter = true): number | null {
  const value = pfnNumber(row, key);
  if (value === null) return null;
  const values = pfnSortedMetricValues(table, key, higherIsBetter);
  if (!values) return null;
  const index = values.findIndex((candidate) => candidate === value);
  return index < 0 ? null : index + 1;
}

function pfnDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

type PfnContextStat = {
  label: string;
  value: number;
  rank: number | null;
  suffix?: string;
};

function PlayerTeamContext({ player }: { player: PlayerSearchResult }) {
  const query = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const tables = query.data?.tables;
  const team = canonicalNflTeam(player.team);
  const opponent = canonicalNflTeam(player.opponent);
  const findRow = (table: PfnTable | null | undefined, code: string | null) => table?.rows.find((row) => canonicalNflTeam(row.team) === code);
  const offensiveLine = tables?.["offensive-line"] ?? null;
  const offense = tables?.offense ?? null;
  const defense = tables?.defense ?? null;
  const teamLine = findRow(offensiveLine, team);
  const teamOffense = findRow(offense, team);
  const teamDefense = findRow(defense, team);
  const opponentOffense = findRow(offense, opponent);
  const opponentDefense = findRow(defense, opponent);
  const stats: PfnContextStat[] = [];

  const addStat = (label: string, table: PfnTable | null, row: PfnRow | undefined, key: string, options?: { higherIsBetter?: boolean; suffix?: string; tableRank?: boolean }) => {
    const value = pfnNumber(row, key);
    if (value === null) return;
    stats.push({
      label,
      value,
      rank: options?.tableRank ? row?.rank ?? null : pfnRankForRow(table, row, key, options?.higherIsBetter ?? true),
      suffix: options?.suffix,
    });
  };

  if (player.position === "QB") {
    addStat("Pass-block rank", offensiveLine, teamLine, "pass_block");
    addStat("Team pass grade", offense, teamOffense, "pass");
    addStat("Opponent pass defense", defense, opponentDefense, "pass");
  } else if (player.position === "RB") {
    addStat("Run-block rank", offensiveLine, teamLine, "run_block");
    addStat("Opponent run defense", defense, opponentDefense, "run");
  } else if (player.position === "WR" || player.position === "TE") {
    addStat("Team pass grade", offense, teamOffense, "pass");
    addStat("Pass-block rank", offensiveLine, teamLine, "pass_block");
    addStat("Opponent pass defense", defense, opponentDefense, "pass");
  } else if (player.position === "DEF") {
    addStat("Defensive grade", defense, teamDefense, "grade", { tableRank: true });
    addStat("Points-allowed rank", defense, teamDefense, "pts_allowed_per_game", { higherIsBetter: false, suffix: " PPG" });
    addStat("Opponent offense", offense, opponentOffense, "grade", { tableRank: true });
  } else if (player.position === "K") {
    addStat("Team scoring", offense, teamOffense, "ppg", { suffix: " PPG" });
  }

  const fetchedAt = offensiveLine?.fetched_at ?? offense?.fetched_at ?? defense?.fetched_at ?? null;
  return (
    <section className="player-team-context" aria-label={`${player.name} team and matchup context`}>
      <div className="section-heading">
        <h3>Team context</h3>
        <span>{fetchedAt ? `PFN · ${pfnDateLabel(fetchedAt)}` : "PFN"}</span>
      </div>
      {query.isPending ? (
        <div className="player-team-context-state" role="status">Loading team context…</div>
      ) : query.isError ? (
        <SectionError title="Team context didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} compact />
      ) : stats.length > 0 ? (
        <div className="player-team-context-grid">
          {stats.map((stat) => (
            <div key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.rank === null ? "—" : `#${stat.rank}`}</strong>
              <small>{stat.value.toFixed(1)}{stat.suffix ?? " grade"}</small>
            </div>
          ))}
        </div>
      ) : (
        <SectionError title="No PFN team context found for this matchup." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} compact />
      )}
    </section>
  );
}

export type MatchupSelection = {
  team: string;
  opponent: string;
  isAway: boolean | null;
  gamePhase: "pregame" | "live" | "final" | null;
};

type MatchupGrade = { value: number | null; rank: number | null };
type MatchupStatConfig = {
  label: string;
  offKey: string;
  defKey: string;
  format: (value: number) => string;
  offHigher: boolean;
  defHigher: boolean;
};

const matchupStatConfigs: ReadonlyArray<MatchupStatConfig> = [
  { label: "Grade", offKey: "grade", defKey: "grade", format: (value) => value.toFixed(1), offHigher: true, defHigher: true },
  { label: "Scoring", offKey: "ppg", defKey: "pts_allowed_per_game", format: (value) => value.toFixed(1), offHigher: true, defHigher: false },
  { label: "Pass", offKey: "pass", defKey: "pass", format: (value) => value.toFixed(1), offHigher: true, defHigher: true },
  { label: "Run", offKey: "run", defKey: "run", format: (value) => value.toFixed(1), offHigher: true, defHigher: true },
  { label: "EPA/Play", offKey: "epa_per_play", defKey: "epa_per_play", format: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`, offHigher: true, defHigher: false },
  { label: "Yds/Play", offKey: "yds_per_play", defKey: "yds_per_play", format: (value) => value.toFixed(1), offHigher: true, defHigher: false },
  { label: "Success%", offKey: "success_pct", defKey: "success_pct", format: (value) => `${value.toFixed(1)}%`, offHigher: true, defHigher: false },
  { label: "Expl%", offKey: "expl_pct", defKey: "expl_pct", format: (value) => `${value.toFixed(1)}%`, offHigher: true, defHigher: false },
];

function matchupGrade(table: PfnTable | null, row: PfnRow | undefined, key = "grade", higherIsBetter = true): MatchupGrade {
  return {
    value: pfnNumber(row, key),
    rank: key === "grade" ? row?.rank ?? null : pfnRankForRow(table, row, key, higherIsBetter),
  };
}

function MatchupDataModal({ matchup, season, week, onClose }: { matchup: MatchupSelection; season: number; week: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const tablesQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const scoreQuery = useQuery({
    queryKey: ["nfl-matchup-box-score", matchup.team, matchup.opponent, season, week],
    queryFn: () => api.getMatchupBoxScore({ team: matchup.team, opponent: matchup.opponent, season, week }),
    enabled: matchup.gamePhase === "final",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const tables = tablesQuery.data?.tables;
  const offense = tables?.offense ?? null;
  const defense = tables?.defense ?? null;
  const offensiveLine = tables?.["offensive-line"] ?? null;
  const teamCode = canonicalNflTeam(matchup.team);
  const opponentCode = canonicalNflTeam(matchup.opponent);
  const findRow = (table: PfnTable | null, code: string | null) => table?.rows.find((row) => canonicalNflTeam(row.team) === code);
  const teamRows = {
    offense: findRow(offense, teamCode),
    defense: findRow(defense, teamCode),
  };
  const opponentRows = {
    offense: findRow(offense, opponentCode),
    defense: findRow(defense, opponentCode),
  };
  const teamOffSos = pfnNumber(teamRows.offense, "sos");
  const teamDefSos = pfnNumber(teamRows.defense, "sos");
  const oppOffSos = pfnNumber(opponentRows.offense, "sos");
  const oppDefSos = pfnNumber(opponentRows.defense, "sos");
  const teamOffSosRank = pfnRankForRow(offense, teamRows.offense, "sos");
  const teamDefSosRank = pfnRankForRow(defense, teamRows.defense, "sos");
  const oppOffSosRank = pfnRankForRow(offense, opponentRows.offense, "sos");
  const oppDefSosRank = pfnRankForRow(defense, opponentRows.defense, "sos");
  const sosBadgeClass = (rank: number | null): string => (
    rank !== null && rank <= 10 ? " sos-tough" : rank !== null && rank >= 23 ? " sos-soft" : ""
  );
  const matchupPairings = [
    {
      id: "team-offense",
      leftUnit: "OFF",
      rightUnit: "DEF",
      leftLabel: `${matchup.team} offense`,
      rightLabel: `${matchup.opponent} defense`,
      leftRow: teamRows.offense,
      rightRow: opponentRows.defense,
      leftSide: "offense" as const,
      rightSide: "defense" as const,
    },
    {
      id: "team-defense",
      leftUnit: "DEF",
      rightUnit: "OFF",
      leftLabel: `${matchup.team} defense`,
      rightLabel: `${matchup.opponent} offense`,
      leftRow: teamRows.defense,
      rightRow: opponentRows.offense,
      leftSide: "defense" as const,
      rightSide: "offense" as const,
    },
  ];
  const matchupStatGroups = matchupStatConfigs.map((stat) => ({
    ...stat,
    pairings: matchupPairings.map((pairing) => ({
      ...pairing,
      left: pairing.leftSide === "offense"
        ? matchupGrade(offense, pairing.leftRow, stat.offKey, stat.offHigher)
        : matchupGrade(defense, pairing.leftRow, stat.defKey, stat.defHigher),
      right: pairing.rightSide === "offense"
        ? matchupGrade(offense, pairing.rightRow, stat.offKey, stat.offHigher)
        : matchupGrade(defense, pairing.rightRow, stat.defKey, stat.defHigher),
    })),
  }));
  const fetchedAt = offensiveLine?.fetched_at ?? offense?.fetched_at ?? defense?.fetched_at ?? null;
  const score = scoreQuery.data;

  return (
    <ModalPortal>
      <div className="matchup-card-backdrop" onClick={onClose}>
        <article ref={dialogRef} className="matchup-data-card" role="dialog" aria-modal="true" aria-labelledby="matchup-card-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <header className="matchup-data-header">
            <div>
              <h2 id="matchup-card-title">{matchup.team} {matchup.isAway ? "@" : "vs"} {matchup.opponent}</h2>
              <span>{fetchedAt ? `PFN grades · ${pfnDateLabel(fetchedAt)}` : "PFN matchup grades"}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close matchup data">×</button>
          </header>

          {matchup.gamePhase === "final" ? (
            scoreQuery.isPending ? <div className="matchup-card-status" role="status"><RefreshIcon spinning /> Loading box score…</div>
              : score?.status === "owner_required" ? (
                <div className="matchup-card-status" role="status">Live box scores are available when the owner opens this matchup.</div>
              ) : scoreQuery.isError || score?.status !== "available" || !score.game ? (
                <SectionError title="Final box score didn’t load." onRetry={() => { void scoreQuery.refetch(); }} retrying={scoreQuery.isFetching} compact />
              ) : (
                <section className="matchup-box-score" aria-label="Final box score">
                  <span>Final</span>
                  <strong>{score.game.score}</strong>
                  <small>{score.game.title}</small>
                  {score.game.sourceUrl ? <a href={score.game.sourceUrl} target="_blank" rel="noreferrer">{score.game.sourceLabel ?? "Box score source"}</a> : null}
                </section>
              )
          ) : tablesQuery.isPending ? (
            <div className="matchup-card-status" role="status"><RefreshIcon spinning /> Loading PFN grades…</div>
          ) : tablesQuery.isError ? (
            <SectionError title="PFN matchup data didn’t load." onRetry={() => { void tablesQuery.refetch(); }} retrying={tablesQuery.isFetching} compact />
          ) : (
            <>
              <section className="matchup-grade-section" aria-labelledby="offense-defense-heading">
                <h3 id="offense-defense-heading">Matchups</h3>
                <div className="matchup-stat-groups" aria-label={`${matchup.team} and ${matchup.opponent} PFN offense versus defense matchups`}>
                  <div className="matchup-stat-columns" aria-label={`Left column ${matchup.team}; right column ${matchup.opponent}`}>
                    <div className="matchup-stat-team">
                      <strong>{matchup.team}</strong>
                      <span className={`matchup-reference-tag${sosBadgeClass(teamOffSosRank)}`}>OFF SOS: {teamOffSos === null ? "—" : teamOffSos.toFixed(1)}</span>
                      <span className={`matchup-reference-tag${sosBadgeClass(teamDefSosRank)}`}>DEF SOS: {teamDefSos === null ? "—" : teamDefSos.toFixed(1)}</span>
                    </div>
                    <div className="matchup-stat-team">
                      <strong>{matchup.opponent}</strong>
                      <span className={`matchup-reference-tag${sosBadgeClass(oppOffSosRank)}`}>OFF SOS: {oppOffSos === null ? "—" : oppOffSos.toFixed(1)}</span>
                      <span className={`matchup-reference-tag${sosBadgeClass(oppDefSosRank)}`}>DEF SOS: {oppDefSos === null ? "—" : oppDefSos.toFixed(1)}</span>
                    </div>
                  </div>
                  {matchupStatGroups.map((stat) => (
                    <div className="matchup-stat-group" key={stat.label}>
                      <div className="comparison-metric-label"><strong>{stat.label}</strong></div>
                      {stat.pairings.map((pairing) => {
                        const leftWins = pairing.left.rank !== null && pairing.right.rank !== null && pairing.left.rank < pairing.right.rank;
                        const rightWins = pairing.left.rank !== null && pairing.right.rank !== null && pairing.right.rank < pairing.left.rank;
                        const leftPoints = pairing.left.rank === null ? null : 33 - pairing.left.rank;
                        const rightPoints = pairing.right.rank === null ? null : 33 - pairing.right.rank;
                        const pointsTotal = leftPoints !== null && rightPoints !== null ? leftPoints + rightPoints : 0;
                        const leftShare = leftPoints !== null && rightPoints !== null && pointsTotal > 0
                          ? (leftPoints / pointsTotal) * 100
                          : 50;
                        const rightShare = 100 - leftShare;
                        const leftValue = pairing.left.value === null ? "—" : stat.format(pairing.left.value);
                        const rightValue = pairing.right.value === null ? "—" : stat.format(pairing.right.value);
                        const leftRank = pairing.left.rank === null ? "rank unavailable" : `rank #${pairing.left.rank}`;
                        const rightRank = pairing.right.rank === null ? "rank unavailable" : `rank #${pairing.right.rank}`;
                        const edgeLabel = leftWins
                          ? `${pairing.leftLabel} has the edge`
                          : rightWins
                            ? `${pairing.rightLabel} has the edge`
                            : pairing.left.rank === null || pairing.right.rank === null
                              ? "the edge is unavailable"
                              : "neither side has the edge";
                        return (
                          <div className="comparison-bar-group" key={`${stat.label}-${pairing.id}`}>
                            <div className="comparison-values" aria-hidden="true">
                              <span>
                                <span className="matchup-unit-label">{pairing.leftUnit}</span>
                                <strong className="matchup-stat-value">{leftValue}</strong>
                                {pairing.left.rank === null ? null : <small>#{pairing.left.rank}</small>}
                              </span>
                              <span>
                                <span className="matchup-unit-label">{pairing.rightUnit}</span>
                                <strong className="matchup-stat-value">{rightValue}</strong>
                                {pairing.right.rank === null ? null : <small>#{pairing.right.rank}</small>}
                              </span>
                            </div>
                            <div className="comparison-stacked-bar" role="img" aria-label={`${stat.label}, ${pairing.leftSide} versus ${pairing.rightSide}: ${pairing.leftLabel}, ${leftValue}, ${leftRank}; ${pairing.rightLabel}, ${rightValue}, ${rightRank}; ${edgeLabel}.`}>
                              <i className={`comparison-segment left${leftWins ? " winner" : ""}`} style={{ width: `${leftShare}%` }} aria-hidden="true" />
                              <i className={`comparison-segment right${rightWins ? " winner" : ""}`} style={{ width: `${rightShare}%` }} aria-hidden="true" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>
              {!offense || !defense ? <SectionError title="PFN matchup data is incomplete." onRetry={() => { void tablesQuery.refetch(); }} retrying={tablesQuery.isFetching} compact /> : null}
            </>
          )}
        </article>
      </div>
    </ModalPortal>
  );
}

function NewsCardModal({ item, onClose }: { item: PlayerNewsItem; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const severity = item.newsType === "headline"
    ? item.playerId === "league" ? "Breaking" : "League news"
    : item.newsType === "waiver" ? "Waiver signal" : "Roster update";

  return (
    <ModalPortal>
      <div className="news-card-backdrop" onClick={onClose}>
        <article
        ref={dialogRef}
        className="news-card-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticker-news-headline"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="news-card-header">
          <div>
            <span className={`news-severity ${item.newsType}`}>{severity}</span>
            <time>{item.sourcePublishedAt ? newsTimeLabel(item.sourcePublishedAt) : "Recent"}</time>
          </div>
          <button type="button" onClick={onClose} aria-label="Close news card">×</button>
        </header>
        <strong id="ticker-news-headline" className="news-card-headline">{item.change}</strong>
        <p>{item.roleContext}</p>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel}</a>
        </article>
      </div>
    </ModalPortal>
  );
}

function gameLogSummary(position: string, stats: Record<string, number>): string {
  const value = (key: string): number => stats[key] ?? 0;
  const pieces = position === "QB"
    ? [`${value("passCmp")}/${value("passAtt")} passing`, `${value("passYds")} pass yds`, `${value("passTd")} pass TD`, `${value("interceptions")} INT`, `${value("rushYds")} rush yds`]
    : position === "RB"
      ? [`${value("rushAtt")} car`, `${value("rushYds")} rush yds`, `${value("targets")} tgt`, `${value("receptions")} rec`, `${value("recYds")} rec yds`, `${value("rushTd") + value("recTd")} TD`]
      : [`${value("targets")} tgt`, `${value("receptions")} rec`, `${value("recYds")} rec yds`, `${value("recTd")} rec TD`, `${value("rushYds")} rush yds`];
  return pieces.join(" · ");
}

function SeasonGameLog({ player, history, isLoading }: { player: PlayerSearchResult; history: BoomBustHistory | undefined; isLoading: boolean }) {
  const games = history?.gameLog ?? [];
  const totals = history?.seasonTotals ?? {};
  const totalOrder = player.position === "QB"
    ? ["fantasyPoints", "passCmp", "passAtt", "passYds", "passTd", "interceptions", "rushYds", "rushTd"]
    : player.position === "RB"
      ? ["fantasyPoints", "rushAtt", "rushYds", "rushTd", "targets", "receptions", "recYds", "recTd"]
      : ["fantasyPoints", "targets", "receptions", "recYds", "recTd", "rushAtt", "rushYds", "rushTd"];
  const totalRows = totalOrder.flatMap((key) => typeof totals[key] === "number" ? [{ key, value: totals[key] ?? 0 }] : []);

  if (isLoading && !history) return <div className="player-tab-loading"><span className="loading-shimmer" /><span className="loading-shimmer" /><span className="loading-shimmer" /></div>;
  if (!isBoomBustPosition(player.position)) return <div className="player-tab-empty"><strong>Season log unavailable</strong><span>Weekly stat logs are currently available for QB, RB, WR, and TE.</span></div>;
  if (history?.status === "unavailable") return <div className="player-tab-empty"><strong>Season log didn’t load</strong><span>Try again after the next Sleeper data refresh.</span></div>;
  if (games.length === 0) return <div className="player-tab-empty"><strong>No games yet this season</strong><span>Games appear after Sleeper records participation.</span></div>;

  return (
    <div className="player-season-panel">
      <section aria-labelledby="player-season-totals-heading">
        <div className="section-heading"><h3 id="player-season-totals-heading">Season totals</h3><span>{games.length} game{games.length === 1 ? "" : "s"}</span></div>
        <div className="player-season-totals">
          {totalRows.map(({ key, value: totalValue }) => (
            <div key={key}><span>{gameLogStatLabels[key] ?? key}</span><strong>{key === "fantasyPoints" ? totalValue.toFixed(1) : Number.isInteger(totalValue) ? totalValue : totalValue.toFixed(1)}</strong></div>
          ))}
        </div>
      </section>
      <section className="player-game-log" aria-labelledby="player-game-log-heading">
        <div className="section-heading"><h3 id="player-game-log-heading">Game log</h3><span>2026 regular season</span></div>
        <div className="player-game-log-list">
          {[...games].reverse().map((game) => (
            <article key={`${game.season}-${game.week}`}>
              <div><strong>W{game.week}</strong><span>{game.opponent ? `vs ${game.opponent}` : "Opponent unavailable"}</span></div>
              <p>{gameLogSummary(player.position, game.stats)}</p>
              <b>{game.points.toFixed(1)}<small>PTS</small></b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function normalizePlayerIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function PlayerAdvancedPanel({ player, analytics, children }: { player: PlayerSearchResult; analytics: Dashboard["analytics"]; children: ReactNode }) {
  const position = (["QB", "RB", "WR", "TE", "K", "DEF"] as string[]).includes(player.position) ? player.position as BasePosition : null;
  const normalizedPlayerName = normalizePlayerIdentity(player.name);
  const playerTeam = canonicalNflTeam(player.team);
  const entity: AnalyticsEntity | undefined = position
    ? analytics.entities.find((candidate) => candidate.position === position && (
      normalizePlayerIdentity(candidate.name) === normalizedPlayerName
      || (position === "DEF" && canonicalNflTeam(candidate.team) === playerTeam)
    ))
    : undefined;
  const values = entity?.season ?? {};
  const metrics = (position ? detailAdvancedMetrics[position] ?? [] : []).flatMap((metric) => {
    const metricValue = metric.derived ? metric.derived(values) : values[metric.key];
    return typeof metricValue === "number" && Number.isFinite(metricValue) ? [{ ...metric, value: metricValue }] : [];
  });

  return (
    <div className="player-advanced-panel">
      <section aria-labelledby="player-advanced-metrics-heading">
        <div className="section-heading"><h3 id="player-advanced-metrics-heading">Efficiency &amp; usage</h3><span>{entity ? `${entity.seasonGames} games` : null}</span></div>
        {metrics.length > 0 ? (
          <div className="player-advanced-grid">
            {metrics.map((metric) => <div key={metric.key}><span>{metric.label}</span><strong>{metric.value.toFixed(metric.digits ?? 1)}{metric.unit ?? ""}</strong></div>)}
          </div>
        ) : <div className="player-tab-empty compact"><strong>No advanced metrics yet</strong><span>nflverse has not published a matching season row for this player.</span></div>}
        {entity && analytics.throughWeek !== null ? <p className="player-tab-source">Through Week {analytics.throughWeek} · nflverse weekly player stats</p> : null}
      </section>
      {children}
    </div>
  );
}

function PlayerDetailSheet({
  player,
  week,
  leagueId,
  formatKey,
  mode,
  analytics,
  newsItems,
  sosEntry,
  newsLoading = false,
  newsError = false,
  onRetryNews,
  onModeChange,
  onOpenMatchup,
  onBack,
  canGoBack,
  onClose,
}: {
  player: PlayerSearchResult;
  week: number;
  leagueId: string;
  formatKey: string;
  mode: "details" | "chart";
  analytics: Dashboard["analytics"];
  newsItems: PlayerNewsItem[];
  sosEntry?: StrengthOfScheduleEntryLike;
  newsLoading?: boolean;
  newsError?: boolean;
  onRetryNews?: () => void;
  onModeChange?: (mode: "details" | "chart") => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
  onBack: () => void;
  canGoBack: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const directionTimerRef = useRef<number | null>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    rawDx: number;
    rawDy: number;
    startedAt: number;
    axis: "x" | "y" | "none" | null;
    horizontalBlocked: boolean;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [contentDirection, setContentDirection] = useState<"back" | "none">("none");
  const [activeTab, setActiveTab] = useState<PlayerDetailTab>("overview");
  useDialogFocusTrap(sheetRef, onClose);

  const resetDrag = useCallback((animate: boolean) => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    setDragging(false);
    setSettling(animate);
    setDragOffset({ x: 0, y: 0 });
    if (animate) {
      settleTimerRef.current = window.setTimeout(() => setSettling(false), 190);
    }
  }, []);

  useEffect(() => () => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    if (directionTimerRef.current) window.clearTimeout(directionTimerRef.current);
  }, []);

  useEffect(() => {
    gestureRef.current = null;
    resetDrag(false);
    setActiveTab("overview");
  }, [player.playerId, resetDrag]);

  const beginTouch = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) {
      gestureRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target instanceof Element ? event.target : null;
    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      rawDx: 0,
      rawDy: 0,
      startedAt: performance.now(),
      axis: null,
      horizontalBlocked: Boolean(target?.closest("canvas, svg, .recharts-wrapper, .player-value-trend, .boom-bust-panel, [data-player-chart]")),
    };
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    setSettling(false);
  };

  const moveTouch = (event: ReactTouchEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch) return;
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    gesture.rawDx = dx;
    gesture.rawDy = dy;
    if (gesture.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        gesture.axis = canGoBack && dx > 0 && !gesture.horizontalBlocked ? "x" : "none";
      } else {
        gesture.axis = sheetRef.current?.scrollTop === 0 && dy > 0 ? "y" : "none";
      }
    }
    if (gesture.axis === "none") return;
    if (gesture.axis === "y" && (dy <= 0 || (sheetRef.current?.scrollTop ?? 0) > 0)) {
      gesture.axis = "none";
      resetDrag(true);
      return;
    }
    if (gesture.axis === "x" && dx <= 0) {
      gesture.axis = "none";
      resetDrag(true);
      return;
    }
    event.preventDefault();
    setDragging(true);
    setDragOffset(gesture.axis === "x"
      ? { x: Math.max(0, dx * 0.82), y: 0 }
      : { x: 0, y: Math.max(0, dy * 0.72) });
  };

  const navigateBack = () => {
    if (!canGoBack) return;
    setContentDirection("back");
    resetDrag(false);
    onBack();
    if (directionTimerRef.current) window.clearTimeout(directionTimerRef.current);
    directionTimerRef.current = window.setTimeout(() => setContentDirection("none"), 190);
  };

  const endTouch = (event: ReactTouchEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const touch = event.changedTouches[0];
    if (gesture && touch) {
      gesture.rawDx = touch.clientX - gesture.startX;
      gesture.rawDy = touch.clientY - gesture.startY;
    }
    gestureRef.current = null;
    if (!gesture || gesture.axis === null || gesture.axis === "none") {
      resetDrag(false);
      return;
    }
    const elapsed = Math.max(1, performance.now() - gesture.startedAt);
    if (gesture.axis === "y") {
      const velocity = gesture.rawDy / elapsed;
      if (gesture.rawDy > 110 || (gesture.rawDy > 34 && velocity > 0.5)) {
        onClose();
        return;
      }
      resetDrag(true);
      return;
    }
    const velocity = gesture.rawDx / elapsed;
    if (canGoBack && (gesture.rawDx > 70 || (gesture.rawDx > 24 && velocity > 0.5))) {
      navigateBack();
      return;
    }
    resetDrag(true);
  };

  const cancelTouch = () => {
    gestureRef.current = null;
    resetDrag(true);
  };

  const boomBustPosition = isBoomBustPosition(player.position) ? player.position : null;
  const supportsBoomBust = boomBustPosition !== null;
  const [boomBustView, setBoomBustView] = useState<"season" | "last3">("season");
  useEffect(() => setBoomBustView("season"), [player.playerId]);
  const boomBustQuery = useQuery({
    queryKey: ["boom-bust-history", leagueId, player.playerId, boomBustView],
    queryFn: () => {
      if (!boomBustPosition) throw new Error("Unsupported position");
      return api.getBoomBustHistory({ leagueId, playerId: player.playerId, position: boomBustPosition, view: boomBustView });
    },
    enabled: supportsBoomBust,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["fantasycalc-value-history", formatKey, [player.playerId]],
    queryFn: () => api.getValueHistory({ formatKey, playerIds: [player.playerId] }),
    enabled: player.position !== "PICK" && player.seasonValue !== null,
    staleTime: 30 * 60 * 1000,
  });
  const valueHistory = historyQuery.data?.series.find((series) => series.playerId === player.playerId);

  const weeklyWidth = player.weeklyProjection === null ? 0 : Math.min(100, Math.max(4, player.weeklyProjection / 30 * 100));
  const valueWidth = player.seasonValue === null ? 0 : Math.min(100, Math.max(4, player.seasonValue / 10_000 * 100));
  const positionLabel = player.position === "DEF" ? "DST" : player.position;
  const projectionComponents = projectionComponentsForPlayer(player);
  const defenseProjectionComponents = player.defenseComponents
    ? Object.entries(defenseComponentLabels).flatMap(([key, label]) => {
        const value = player.defenseComponents?.[key];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ key, label, value, isYards: key === "pr_yd" || key === "kr_yd" || key === "yds_allow" }]
          : [];
      })
    : [];

  return (
    <ModalPortal>
      <div className="player-detail-backdrop" onClick={onClose}>
        <section
        ref={sheetRef}
        className={`player-detail-sheet${dragging ? " is-dragging" : ""}${settling ? " is-settling" : ""}`}
        style={{ transform: `translate3d(0, ${dragOffset.y}px, 0)` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-detail-name"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={beginTouch}
        onTouchMove={moveTouch}
        onTouchEnd={endTouch}
        onTouchCancel={cancelTouch}
      >
        <div
          key={player.playerId}
          className={`player-detail-content${contentDirection === "back" ? " history-back" : ""}${dragging ? " is-dragging" : ""}${settling ? " is-settling" : ""}`}
          style={{ transform: `translate3d(${dragOffset.x}px, 0, 0)` }}
        >
        <div className="player-sheet-grabber" aria-hidden="true" />
        <header className="player-detail-header">
          <div>
            <div className="player-detail-title-line">
              <h2 id="player-detail-name">{player.name}</h2>
            </div>
            <p><span>{positionLabel}</span><MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={player.team && player.opponent && onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase ?? null }) : undefined} /></p>
          </div>
          <div className="player-detail-actions">
            {canGoBack ? <button type="button" onClick={navigateBack} aria-label="Previous player">←</button> : null}
            <button type="button" onClick={onClose} aria-label="Close player details">×</button>
          </div>
        </header>
        <nav className="player-detail-tabs" role="tablist" aria-label={`${player.name} details`}>
          {([[
            "overview", "Overview",
          ], ["season", "Season"], ["advanced", "Advanced"]] as const).map(([tab, label]) => (
            <button
              key={tab}
              id={`player-detail-${tab}-tab`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`player-detail-${tab}-panel`}
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
            >{label}</button>
          ))}
        </nav>
        {activeTab === "overview" ? <div id="player-detail-overview-panel" role="tabpanel" aria-labelledby="player-detail-overview-tab">
        {onModeChange ? (
          <SegmentedControl
            className="player-detail-mode-toggle"
            value={mode}
            onChange={onModeChange}
            label={`${player.name} detail view`}
            options={[{ value: "details", label: "Details" }, { value: "chart", label: "Chart" }]}
          />
        ) : null}
        {mode === "chart" ? (
          <div className="player-chart-peek">
            <div><span>Week {week} {player.gamePhase === "final" ? "points" : player.gamePhase === "live" ? "live projection" : "projection"}</span><i><b style={{ width: `${weeklyWidth}%` }} /></i><strong>{formatProjectionPoints(player.weeklyProjection, player.projectionSource)}</strong></div>
            <div><span>Season-long market value</span><i><b style={{ width: `${valueWidth}%` }} /></i><strong>{player.seasonValue === null ? "—" : player.seasonValue.toLocaleString()}</strong></div>
          </div>
        ) : (
          <div className="player-detail-values">
            <div><span>Week {week} {player.gamePhase === "final" ? "points" : player.gamePhase === "live" ? "live projection" : "projection"}</span><strong>{formatProjectionPoints(player.weeklyProjection, player.projectionSource)}</strong><small>{player.weeklyProjection === null ? "No weekly projection" : player.weeklyRank === null ? "No weekly rank" : `${positionLabel} #${player.weeklyRank}`}</small></div>
            <div><span>Season-long value</span><strong>{player.seasonValue === null ? "—" : player.seasonValue.toLocaleString()}</strong><small>{player.seasonRank === null ? "No season rank" : `${positionLabel} #${player.seasonRank}`}</small></div>
          </div>
        )}
        <div className="player-detail-meta">
          <span>{player.isRostered ? "Rostered in this league" : "Available in this league"}</span>
          {player.injuryStatus ? <span className="player-detail-injury">Injury status: {player.injuryStatus}</span> : null}
          {player.seasonValue !== null ? <span className="player-detail-movement">{movementLabel(player.movement30Day)}</span> : null}
        </div>
        {player.waiverTrends && (player.waiverTrends.adds || player.waiverTrends.drops) ? (
          <section className="player-detail-waiver-trends" aria-label={`${player.name} waiver activity`}>
            <div className="section-heading"><h3>Waiver activity</h3><span>Last 24 hours</span></div>
            <div className="player-detail-waiver-trend-list">
              {player.waiverTrends.adds ? (
                <div>
                  <span className="trending-add">+{player.waiverTrends.adds.rank} TREND</span>
                  <strong>{player.waiverTrends.adds.count.toLocaleString()} adds</strong>
                </div>
              ) : null}
              {player.waiverTrends.drops ? (
                <div>
                  <span className="trending-drop">−{player.waiverTrends.drops.rank} DROP</span>
                  <strong>{player.waiverTrends.drops.count.toLocaleString()} drops</strong>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {player.position !== "DEF" && player.gamePhase !== "final" && projectionComponents.length > 0 ? (
          <section className="dst-breakdown" aria-label={`${player.name} projection components`}>
            <div className="section-heading"><h3>Projection components</h3></div>
            <div className="dst-breakdown-grid">
              {projectionComponents.map((component) => (
                <div key={component.key}>
                  <span>{component.label}</span>
                  <strong>{component.isYards ? Math.round(component.value) : component.value.toFixed(1)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {player.position === "DEF" && player.gamePhase !== "final" && defenseProjectionComponents.length > 0 ? (
          <section className="dst-breakdown" aria-label={`${player.name} projection components`}>
            <div className="section-heading"><h3>Projection components</h3></div>
            <div className="dst-breakdown-grid">
              {defenseProjectionComponents.map((component) => (
                <div key={component.key}>
                  <span>{component.label}</span>
                  <strong>{component.isYards ? Math.round(component.value) : component.value.toFixed(1)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <PlayerTeamContext player={player} />
        <section className="player-news-section" aria-label={`${player.name} news`}>
          <div className="section-heading"><h3>Latest news</h3><span>{newsItems.length > 0 ? newsItems.length : null}</span></div>
          {newsError && onRetryNews ? (
            <SectionError title="News didn’t load." onRetry={onRetryNews} compact />
          ) : newsLoading ? (
            <div className="empty-inline compact">Loading news…</div>
          ) : newsItems.length > 0 ? newsItems.slice(0, 4).map((item) => (
            <article className="player-news-item" key={item.id}>
              <div><span className={`news-severity ${item.newsType}`}>{item.newsType === "headline" ? "League news" : item.newsType === "waiver" ? "Waiver signal" : "Roster update"}</span><time>{item.sourcePublishedAt ? newsTimeLabel(item.sourcePublishedAt) : "Recent"}</time></div>
              <strong>{item.change}</strong>
              <p>{item.roleContext}</p>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel}<span className="sr-only"> (opens in new tab)</span></a>
            </article>
          )) : <div className="empty-inline compact">No recent news for this player.</div>}
        </section>
        {player.position !== "PICK" && player.seasonValue !== null ? (
          <PlayerValueTrend name={player.name} history={valueHistory} isLoading={historyQuery.isPending} />
        ) : null}
        {supportsBoomBust ? (
          <BoomBustPanel name={player.name} view={boomBustView} onViewChange={setBoomBustView} history={boomBustQuery.data} isLoading={boomBustQuery.isPending} />
        ) : null}
        </div> : null}
        {activeTab === "season" ? (
          <div id="player-detail-season-panel" role="tabpanel" aria-labelledby="player-detail-season-tab">
            <SeasonGameLog player={player} history={boomBustQuery.data} isLoading={boomBustQuery.isPending} />
          </div>
        ) : null}
        {activeTab === "advanced" ? (
          <div id="player-detail-advanced-panel" role="tabpanel" aria-labelledby="player-detail-advanced-tab">
            <PlayerAdvancedPanel player={player} analytics={analytics}>
              <PlayerTeamContext player={player} />
            </PlayerAdvancedPanel>
          </div>
        ) : null}
        </div>
        </section>
      </div>
    </ModalPortal>
  );
}

function MatchupPlayer({ player, side, sosEntry, isSwappedIn = false, isDemoted = false, onOpen, onOpenMatchup }: { player: RosterPlayer | undefined; side: "mine" | "theirs"; sosEntry?: StrengthOfScheduleEntryLike; isSwappedIn?: boolean; isDemoted?: boolean; onOpen?: (player: RosterPlayer) => void; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  if (!player) return <div className={`matchup-player ${side} empty-player`}>—</div>;
  const score = playerScore(player);
  const openPlayer = () => onOpen?.(player);
  const position = player.position === "DEF" ? "DST" : player.position;
  const matchup = accessibleMatchupLabel(player.team, player.opponent, player.isAway, player.isBye);
  const scoreDescription = `${formatProjectionPoints(score.value, score.label === "PROJ" ? player.projectionSource : null)} ${score.label === "PROJ" ? "projected points" : "points"}`;
  const injuryDescription = player.injuryStatus ? `, injury status ${player.injuryStatus}` : "";
  const substitutionDescription = isSwappedIn
    ? ", swapped into optimized lineup"
    : isDemoted
      ? ", moved to bench in optimized lineup"
      : "";
  return (
    <div className={`matchup-player ${side}${isSwappedIn ? " swapped-in" : ""}${isDemoted ? " demoted" : ""}`}>
      <button type="button" className="matchup-player-open" onClick={openPlayer} aria-label={`View ${player.name} details and news, ${position}, ${matchup}, ${scoreDescription}${injuryDescription}${substitutionDescription}`}>
        <span className="matchup-name-line">
          <strong>{player.name}</strong>
          {isSwappedIn || isDemoted ? (
            <span className={`matchup-substitution-tag ${isSwappedIn ? "in" : "out"}`} aria-hidden="true">
              {isSwappedIn ? "IN" : "OUT"}
            </span>
          ) : null}
          {player.injuryStatus ? (
            <span className="injury" aria-label={`Injury status: ${player.injuryStatus}`} title={player.injuryStatus}>
              {sleeperInjuryTag(player.injuryStatus)}
            </span>
          ) : null}
        </span>
      </button>
      <div className="matchup-meta">
        <MatchupTag
          team={player.team}
          opponent={player.opponent}
          isAway={player.isAway}
          isBye={player.isBye}
          position={player.position}
          entry={sosEntry}
          onClick={player.team && player.opponent && onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase }) : undefined}
        />
      </div>
      <button type="button" className={`matchup-number matchup-player-score ${score.label === "PTS" ? "actual" : ""}`} onClick={openPlayer} tabIndex={-1} aria-hidden="true">
        <b>{formatProjectionPoints(score.value, score.label === "PROJ" ? player.projectionSource : null)}</b>
      </button>
    </div>
  );
}

function eligibleForSlot(position: string, slot: string): boolean {
  if (slot === position) return true;
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
  if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
  if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
  return false;
}

const flexLineupSlots = new Set(["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"]);

function relabelOptimizedStarters(players: RosterPlayer[], slots: string[]): RosterPlayer[] {
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
        if ((mask & bit) !== 0 || !eligibleForSlot(player.position, slot)) return;
        const flexValue = player.gamePhase === "final" ? (player.actual ?? player.projection ?? -1000) : (player.projection ?? -1000);
        const isFlexSlot = flexLineupSlots.has(slot);
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

function optimizeLineup(startersInput: RosterPlayer[], benchInput: RosterPlayer[]): { starters: RosterPlayer[]; bench: RosterPlayer[] } {
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
        if ((mask & bit) !== 0 || !eligibleForSlot(player.position, slot)) return;
        const nextMask = mask | bit;
        const candidate: State = {
          score: state.score + (player.gamePhase === "final" ? (player.actual ?? player.projection ?? -1000) : (player.projection ?? -1000)),
          currentCount: state.currentCount + (currentStarterIds.has(player.playerId) ? 1 : 0),
          assignments: state.assignments.map((assigned, index) => index === slotIndex ? player : assigned),
        };
        const existing = next.get(nextMask);
        if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.currentCount > existing.currentCount)) {
          next.set(nextMask, candidate);
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
  const starters = relabelOptimizedStarters(optimized, filledSlots);
  const starterIds = new Set(starters.map((player) => player.playerId));
  const bench = roster.filter((player) => !starterIds.has(player.playerId)).map((player) => ({ ...player, isStarter: false, lineupSlot: null }));
  return { starters, bench };
}

function forecastTotal(players: RosterPlayer[]): number | null {
  const values = players.flatMap((player) => {
    const value = player.gamePhase === "final" ? player.actual : player.projection;
    return value === null ? [] : [value];
  });
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function Lineup({ league, dashboard, news, newsLoading, newsError, onRetryNews, onOpenMatchup }: { league: League; dashboard: Dashboard; news: PlayerNews | undefined; newsLoading: boolean; newsError: boolean; onRetryNews: () => void; onOpenMatchup: (matchup: MatchupSelection) => void }) {
  const [mode, setMode] = useState<"current" | "optimized">("current");
  const playerHistory = usePlayerCardHistory();
  const newsItemsByPlayer = useMemo(() => groupNewsItemsByPlayer(news), [news]);
  const selectedPlayerNews = playerHistory.current ? newsItemsByPlayer.get(playerHistory.current.playerId) ?? [] : [];
  const openPlayer = (player: RosterPlayer) => {
    const season = dashboard.seasonLongRankings.find((row) => row.playerId === player.playerId && row.formatKey === league.seasonLongFormat.key);
    playerHistory.open({
      key: `lineup:${player.playerId}`,
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      position: player.position,
      opponent: player.opponent,
      isAway: player.isAway,
      isBye: player.isBye,
      injuryStatus: player.injuryStatus,
      weeklyRank: player.rank,
      weeklyProjection: player.gamePhase === "final" ? player.actual : player.projection,
      projectionSource: player.projectionSource,
      seasonRank: season?.positionRank ?? null,
      seasonValue: season?.value ?? null,
      movement30Day: season?.trend30Day ?? null,
      isRostered: true,
      gamePhase: player.gamePhase,
      defenseComponents: player.defenseComponents,
      projectionComponents: player.projectionComponents,
    });
  };
  const opponent = league.opponentTeam;
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const optimized = useMemo(() => optimizeLineup(league.starters, league.bench), [league.starters, league.bench]);
  const mine = mode === "optimized" ? optimized.starters : league.starters;
  const myBench = mode === "optimized" ? optimized.bench : league.bench;
  const theirs = opponent?.starters;
  const theirBench = opponent?.bench;
  const optimizedForecast = forecastTotal(optimized.starters);
  const optimizedGain = optimizedForecast !== null && league.teamProjection !== null
    ? Number((optimizedForecast - league.teamProjection).toFixed(1))
    : null;
  const userTeamName = league.tradeTeams.find((team) => team.isUser)?.teamName ?? "My Team";
  const starterCount = Math.max(mine.length, theirs?.length ?? 0);
  const rows = Array.from({ length: starterCount }, (_, index) => ({
    mine: mine[index],
    theirs: theirs?.[index],
  }));
  const benchCount = Math.max(myBench.length, theirBench?.length ?? 0);
  const benchRows = Array.from({ length: benchCount }, (_, index) => ({
    mine: myBench[index],
    theirs: theirBench?.[index],
  }));

  return (
    <>
      <SegmentedControl
        className="lineup-mode-toggle"
        value={mode}
        onChange={setMode}
        label="Your lineup version"
        options={[{ value: "current", label: "Current lineup" }, { value: "optimized", label: "Optimized lineup" }]}
      />

      <section className="matchup-score" aria-label="Head-to-head score">
        <div className="score-team mine">
          <span>{userTeamName}</span>
          <div className="score-line">
            <strong>{formatProjectionPoints(league.teamActual)}</strong>
            <small>{forecastPoints(mode === "optimized" ? optimizedForecast : league.teamProjection, mode === "optimized" ? optimized.starters : league.starters)}<span className="sr-only"> projected points</span></small>
            {mode === "optimized" && optimizedGain !== null ? <em className="optimized-gain">{optimizedGain >= 0 ? "+" : ""}{optimizedGain.toFixed(1)} <span>vs current</span></em> : null}
          </div>
        </div>
        <div className="versus">VS</div>
        <div className="score-team theirs">
          <span>{opponent?.name ?? "OPPONENT"}</span>
          <div className="score-line"><strong>{formatProjectionPoints(opponent?.teamActual ?? null)}</strong><small>{forecastPoints(opponent?.teamProjection ?? null, opponent?.starters ?? [])}<span className="sr-only"> projected points</span></small></div>
        </div>
        <div className="matchup-context">
          <span>{league.record.wins}-{league.record.losses}{league.record.ties ? `-${league.record.ties}` : ""} record</span>
          <span>{league.scoringLabel}</span>
        </div>
      </section>

      <section className="lineup-section matchup-section">
        <div className="section-heading"><h2>Starters</h2></div>
        <div className="matchup-column-key"><span>{userTeamName}</span><span>SLOT</span><span>{opponent?.name ?? "OPP"}</span></div>
        <div className="matchup-list">
          {rows.map(({ mine: myPlayer, theirs }, index) => (
            <div className="matchup-row" key={`${myPlayer?.playerId ?? "empty"}-${theirs?.playerId ?? "empty"}-${index}`}>
              <MatchupPlayer
                player={myPlayer}
                side="mine"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
                isSwappedIn={mode === "optimized" && Boolean(myPlayer) && !league.starters.some((starter) => starter.playerId === myPlayer?.playerId)}
              />
              <span className="matchup-slot">{(myPlayer?.lineupSlot ?? theirs?.lineupSlot ?? "—").replace("_", " ")}</span>
              <MatchupPlayer
                player={theirs}
                side="theirs"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
              />
            </div>
          ))}
        </div>
        {!opponent ? <div className="empty-inline compact">Sleeper hasn’t posted an opponent for this week.</div> : null}
      </section>

      <section className="lineup-section matchup-section bench-matchup-section" aria-label="Bench matchup">
        <div className="section-heading"><h2>Bench</h2></div>
        <div className="matchup-column-key"><span>{userTeamName}</span><span>BENCH</span><span>{opponent?.name ?? "OPP"}</span></div>
        <div className="matchup-list">
          {benchRows.map(({ mine: myPlayer, theirs }, index) => (
            <div className="matchup-row" key={`${myPlayer?.playerId ?? "empty"}-${theirs?.playerId ?? "empty"}-bench-${index}`}>
              <MatchupPlayer
                player={myPlayer}
                side="mine"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
                isDemoted={mode === "optimized" && Boolean(myPlayer) && league.starters.some((starter) => starter.playerId === myPlayer?.playerId)}
              />
              <span className="matchup-slot">BN</span>
              <MatchupPlayer player={theirs} side="theirs" sosEntry={sosEntry} onOpen={openPlayer} onOpenMatchup={onOpenMatchup} />
            </div>
          ))}
        </div>
        {benchRows.length === 0 ? <div className="empty-inline compact">No bench players are listed.</div> : null}
        {!opponent ? <div className="empty-inline compact">Sleeper hasn’t posted an opponent for this week.</div> : null}
      </section>
      {playerHistory.current ? <PlayerDetailSheet player={playerHistory.current} week={dashboard.week} leagueId={league.id} formatKey={league.seasonLongFormat.key} mode="details" analytics={dashboard.analytics} sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id)} newsItems={selectedPlayerNews} newsLoading={newsLoading} newsError={newsError} onRetryNews={onRetryNews} onOpenMatchup={onOpenMatchup} onBack={playerHistory.back} canGoBack={playerHistory.canGoBack} onClose={playerHistory.close} /> : null}
    </>
  );
}

type TeamCardSelection = {
  team: string;
};

type TeamUsage = Dashboard["analytics"]["teamUsage"][number];
type NflTeamRecord = Dashboard["analytics"]["teamRecords"][number];

function offensiveLineTone(rank: number | null): "" | " oline-strong" | " oline-weak" {
  if (rank === null || !Number.isInteger(rank) || rank < 1 || rank > 32) return "";
  if (rank <= 10) return " oline-strong";
  if (rank >= 23) return " oline-weak";
  return "";
}

function offensiveLineRanksByTeam(table: PfnTable | null): Map<string, number> {
  const rows = table?.rows.flatMap((row) => {
    const team = canonicalNflTeam(row.team);
    return team ? [{ team, row }] : [];
  }) ?? [];
  const suppliedRanks = rows.map(({ row }) => row.rank);
  const hasCompleteRankOrder = rows.length === 32
    && suppliedRanks.every((rank) => Number.isInteger(rank) && rank >= 1 && rank <= 32)
    && new Set(suppliedRanks).size === 32;

  if (hasCompleteRankOrder) {
    return new Map(rows.map(({ team, row }) => [team, row.rank]));
  }

  // Some older PFN payloads put a grade-like value in `rank`. Recover the
  // published ordering from grade only when all 32 teams are present; a
  // partial or unmatched table stays neutral rather than implying a bad tier.
  const gradedRows = rows.flatMap(({ team, row }) => {
    const grade = pfnNumber(row, "grade");
    return grade === null ? [] : [{ team, grade }];
  });
  if (gradedRows.length !== 32 || new Set(gradedRows.map(({ team }) => team)).size !== 32) return new Map();

  gradedRows.sort((a, b) => b.grade - a.grade || a.team.localeCompare(b.team));
  return new Map(gradedRows.map(({ team }, index) => [team, index + 1]));
}

function SeasonTeamPill({ team, lineRank, onOpen }: { team: string | null; lineRank: number | null; onOpen?: () => void }) {
  const teamLabel = team ?? "FA";
  const className = `matchup-reference-tag season-team-pill${offensiveLineTone(lineRank)}`;
  if (!team || !onOpen) return <span className={className}>{teamLabel}</span>;
  return (
    <button
      type="button"
      className={`${className} matchup-reference-button`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={`View ${teamLabel} team data${lineRank === null ? "" : `, offensive line rank ${lineRank}`}`}
      aria-haspopup="dialog"
      title={lineRank === null ? `${teamLabel} team data` : `${teamLabel} offensive line rank #${lineRank}`}
    >
      <span className="matchup-reference-button-label">{teamLabel}</span>
      <span className="matchup-reference-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function TeamDataModal({
  selection,
  offensiveLine,
  defense,
  offense,
  teamOverall,
  usage,
  record,
  situational,
  situationalSource,
  loading,
  loadError,
  onRetry,
  onClose,
}: {
  selection: TeamCardSelection;
  offensiveLine: PfnTable | null;
  defense: PfnTable | null;
  offense: PfnTable | null;
  teamOverall: PfnTable | null;
  usage: TeamUsage | null;
  record: NflTeamRecord | null;
  situational: TeamSituationalRow | null;
  situationalSource: Pick<TeamSituational, "fetchedAt" | "sourceUrl"> | null;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const teamCode = canonicalNflTeam(selection.team);
  const lineRow = offensiveLine?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const defenseRow = defense?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const offenseRow = offense?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const overallRow = teamOverall?.rows.find((row) => canonicalNflTeam(row.team) === teamCode);
  const lineGrade = pfnNumber(lineRow, "grade");
  const defenseGrade = pfnNumber(defenseRow, "grade");
  const offenseGrade = pfnNumber(offenseRow, "grade");
  const lineRank = lineRow?.rank ?? null;
  const defenseRank = defenseRow?.rank ?? null;
  const offenseRank = offenseRow?.rank ?? null;
  const epaPerPlay = pfnNumber(offenseRow, "epa_per_play");
  const successPct = pfnNumber(offenseRow, "success_pct");
  const yardsPerPlay = pfnNumber(offenseRow, "yds_per_play");
  const explosivePct = pfnNumber(offenseRow, "expl_pct");
  const teamName = lineRow?.team_name ?? defenseRow?.team_name ?? offenseRow?.team_name ?? overallRow?.team_name ?? selection.team;
  const usageWeek = usage ? `Through ${usage.games} game${usage.games === 1 ? "" : "s"}` : null;
  const pfnRecord = overallRow?.record;
  const recordLabel = typeof pfnRecord === "string" && /^\d+-\d+(?:-\d+)?$/.test(pfnRecord)
    ? pfnRecord
    : record ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}` : "—";

  return (
    <ModalPortal>
      <div className="matchup-card-backdrop" onClick={onClose}>
        <article ref={dialogRef} className="matchup-data-card team-data-card" role="dialog" aria-modal="true" aria-labelledby="team-card-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <header className="matchup-data-header">
            <div>
              <h2 id="team-card-title">{selection.team} team card</h2>
              <span>{teamName}{offensiveLine?.fetched_at || defense?.fetched_at || offense?.fetched_at ? ` · PFN ${pfnDateLabel(offensiveLine?.fetched_at ?? defense?.fetched_at ?? offense?.fetched_at ?? "")}` : ""}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close team data">×</button>
          </header>

          <section className="team-card-stat-section" aria-labelledby="team-basic-stats-title">
            <div className="team-card-section-heading">
              <h3 id="team-basic-stats-title">Basic</h3>
              <span>{usageWeek ?? "Season production"}</span>
            </div>
            <div className="team-card-metrics">
              <div>
                <span>Points scored</span>
                <strong>{usage ? usage.pointsScored.toLocaleString() : "—"}</strong>
                <small>{usageWeek ?? "nflverse unavailable"}</small>
              </div>
              <div>
                <span>Total yards</span>
                <strong>{usage ? usage.totalYards.toLocaleString() : "—"}</strong>
                <small>{usageWeek ?? "nflverse unavailable"}</small>
              </div>
              <div>
                <span>Passing yards</span>
                <strong>{usage ? usage.passingYards.toLocaleString() : "—"}</strong>
                <small>Season total</small>
              </div>
              <div>
                <span>Rushing yards</span>
                <strong>{usage ? usage.rushingYards.toLocaleString() : "—"}</strong>
                <small>Season total</small>
              </div>
              <div>
                <span>Win–loss record</span>
                <strong>{recordLabel}</strong>
                <small>Season</small>
              </div>
              <div>
                <span>Offensive touchdowns</span>
                <strong>{usage ? usage.offensiveTouchdowns.toLocaleString() : "—"}</strong>
                <small>Pass catches + rushes</small>
              </div>
              <div>
                <span>Turnovers</span>
                <strong>{usage ? usage.turnovers.toLocaleString() : "—"}</strong>
                <small>Interceptions + fumbles lost</small>
              </div>
              <div>
                <span>Pace of play</span>
                <strong>{usage ? usage.playsPerGame.toFixed(1) : "—"}</strong>
                <small>{usageWeek ? `plays / game · ${usageWeek}` : "nflverse unavailable"}</small>
              </div>
              <div>
                <span>Run / pass split</span>
                <strong>{usage ? `${Math.round(usage.runPct)} / ${Math.round(usage.passPct)}` : "—"}</strong>
                <small>{usage ? "run% / pass%" : "nflverse unavailable"}</small>
              </div>
            </div>
          </section>

          <section className="team-card-stat-section" aria-labelledby="team-advanced-stats-title">
            <div className="team-card-section-heading">
              <h3 id="team-advanced-stats-title">Advanced</h3>
              <span>Offensive efficiency</span>
            </div>
            <div className="team-card-metrics team-card-advanced-metrics">
              <div>
                <span>PFN O-line rank</span>
                <strong>{loading ? "…" : lineRank === null ? "—" : `#${lineRank}`}</strong>
                <small>{lineGrade === null ? "PFN rank" : `${lineGrade.toFixed(1)} grade`}</small>
              </div>
              <div>
                <span>PFN defense rank</span>
                <strong>{loading ? "…" : defenseRank === null ? "—" : `#${defenseRank}`}</strong>
                <small>{defenseGrade === null ? "PFN rank" : `${defenseGrade.toFixed(1)} grade`}</small>
              </div>
              <div>
                <span>Offensive efficiency</span>
                <strong>{loading ? "…" : offenseRank === null ? "—" : `#${offenseRank}`}</strong>
                <small>{offenseGrade === null ? "PFN rank" : `${offenseGrade.toFixed(1)} PFN grade`}</small>
              </div>
              <div>
                <span>Red-zone TD rate</span>
                <strong>{situational ? `${situational.redZoneTdPct.toFixed(0)}%` : "—"}</strong>
                <small>{situational ? `${situational.games} game${situational.games === 1 ? "" : "s"}` : "Source unavailable"}</small>
              </div>
              <div>
                <span>Third-down conversion</span>
                <strong>{situational ? `${situational.thirdDownPct.toFixed(0)}%` : "—"}</strong>
                <small>{situational ? `${situational.games} game${situational.games === 1 ? "" : "s"}` : "Source unavailable"}</small>
              </div>
              <div>
                <span>EPA / play</span>
                <strong>{epaPerPlay === null ? "—" : `${epaPerPlay > 0 ? "+" : ""}${epaPerPlay.toFixed(2)}`}</strong>
                <small>PFN offense</small>
              </div>
              <div>
                <span>Success rate</span>
                <strong>{successPct === null ? "—" : `${successPct.toFixed(1)}%`}</strong>
                <small>PFN offense</small>
              </div>
              <div>
                <span>Yards / play</span>
                <strong>{yardsPerPlay === null ? "—" : yardsPerPlay.toFixed(1)}</strong>
                <small>PFN offense</small>
              </div>
              <div>
                <span>Explosive play rate</span>
                <strong>{explosivePct === null ? "—" : `${explosivePct.toFixed(1)}%`}</strong>
                <small>PFN offense</small>
              </div>
            </div>
            {situationalSource ? (
              <p className="team-card-source">
                Situational rates · <a href={situationalSource.sourceUrl} target="_blank" rel="noreferrer">Sportskeeda</a> · fetched {pfnDateLabel(situationalSource.fetchedAt)}
              </p>
            ) : null}
          </section>
          {loadError ? <SectionError title="Team data didn’t load." onRetry={onRetry} compact /> : null}
        </article>
      </div>
    </ModalPortal>
  );
}

function PlayerPool({ dashboard, league, availableOnly, news, newsLoading, newsError, onRetryNews, draftData, onOpenMatchup }: { dashboard: Dashboard; league: League; availableOnly: boolean; news: PlayerNews | undefined; newsLoading: boolean; newsError: boolean; onRetryNews: () => void; draftData: DraftCenterData | undefined; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  const [position, setPosition] = useState<PositionFilter>("QB");
  const [query, setQuery] = useState("");
  const playerHistory = usePlayerCardHistory();
  const [sheetMode, setSheetMode] = useState<"details" | "chart">("details");
  const [rankingMode, setRankingMode] = useState<"week" | "ros" | "dynasty">("week");
  const [visibleRowCount, setVisibleRowCount] = useState(120);
  const [selectedTeam, setSelectedTeam] = useState<TeamCardSelection | null>(null);
  const queryClient = useQueryClient();
  const isSeasonLong = rankingMode !== "week";
  const pfnTablesQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    enabled: isSeasonLong,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const offensiveLine = pfnTablesQuery.data?.tables["offensive-line"] ?? null;
  const defense = pfnTablesQuery.data?.tables.defense ?? null;
  const offense = pfnTablesQuery.data?.tables.offense ?? null;
  const teamOverall = pfnTablesQuery.data?.tables["team-overall"] ?? null;
  const teamSituational = pfnTablesQuery.data?.teamSituational ?? null;
  const offensiveLineRankByTeam = useMemo(() => offensiveLineRanksByTeam(offensiveLine), [offensiveLine]);
  const teamSituationalByTeam = useMemo(() => new Map(
    (teamSituational?.rows ?? []).map((row) => [canonicalNflTeam(row.team) ?? row.team, row]),
  ), [teamSituational]);
  const teamUsageByTeam = useMemo(() => new Map(
    dashboard.analytics.teamUsage.map((usage) => [canonicalNflTeam(usage.team) ?? usage.team, usage]),
  ), [dashboard.analytics.teamUsage]);
  const teamRecordByTeam = useMemo(() => new Map(
    (dashboard.analytics.teamRecords ?? []).map((record) => [canonicalNflTeam(record.team) ?? record.team, record]),
  ), [dashboard.analytics.teamRecords]);
  const redraftFormatKey = `redraft-${league.seasonLongFormat.numQbs}qb-${league.seasonLongFormat.numTeams}t-${league.seasonLongFormat.ppr}ppr`;
  const seasonFormatKey = rankingMode === "dynasty" ? league.seasonLongFormat.key : redraftFormatKey;
  const basePositions = basePositionOrder.filter((item) => league.rankingPositions.includes(item) && (!isSeasonLong || ["QB", "RB", "WR", "TE"].includes(item)));
  const positionFilters: PositionFilter[] = [...basePositions];
  const modifierFilters: PositionFilter[] = [
    ...(isSeasonLong ? ["ALL" as const] : []),
    "FLEX",
    ...(league.showSuperFilter ? ["SUPER" as const] : []),
    ...(rankingMode === "dynasty" ? ["ROOKIES" as const] : []),
  ];
  const visiblePositions: PositionFilter[] = [...positionFilters, ...modifierFilters];
  const effectivePosition = visiblePositions.includes(position) ? position : (visiblePositions[0] ?? "QB");
  const includedPositions = positionsForFilter(effectivePosition);
  const myRoster = new Set([...league.starters, ...league.bench].map((player) => player.playerId));
  const rosterTeamByPlayer = useMemo(
    () => new Map((league.rosterAssignments ?? []).map((assignment) => [assignment.playerId, assignment])),
    [league.rosterAssignments],
  );
  const leagueRankings = useMemo(() => dashboard.rankings.filter((row) => row.leagueId === league.id), [dashboard.rankings, league.id]);
  const leagueDefenses = useMemo(() => dashboard.defenses.filter((row) => row.leagueId === league.id), [dashboard.defenses, league.id]);
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);

  useEffect(() => {
    if (position !== effectivePosition) setPosition(effectivePosition);
  }, [effectivePosition, position]);

  useEffect(() => {
    setVisibleRowCount(120);
  }, [availableOnly, effectivePosition, league.id, rankingMode]);

  const allPlayerDetails = useMemo<PlayerSearchResult[]>(() => {
    const rostered = new Set(league.rosteredPlayerIds);
    const seasonRows = dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key && row.position !== "PICK");
    const seasonById = new Map(seasonRows.map((row) => [row.playerId, row]));
    const seasonByName = new Map(seasonRows.map((row) => [comparablePlayerName(row.name), row]));
    const matchedSeasonIds = new Set<string>();
    const results: PlayerSearchResult[] = leagueRankings.map((row) => {
      const nameRow = seasonByName.get(comparablePlayerName(row.name));
      const seasonRow = seasonById.get(row.playerId) ?? (nameRow && nameRow.position === row.position && (nameRow.team ?? null) === (row.team ?? null) ? nameRow : undefined);
      if (seasonRow) matchedSeasonIds.add(seasonRow.playerId);
      return {
        key: `player-${row.playerId}`,
        playerId: row.playerId,
        name: row.name,
        team: row.team || seasonRow?.team || null,
        position: row.position,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: row.isBye,
        injuryStatus: row.injuryStatus,
        weeklyRank: row.leagueProjection === null ? null : league.rankingField === "ppr" ? row.pprRank : row.halfPprRank,
        weeklyProjection: league.rankingField === "ppr" ? row.ppr : row.halfPpr,
        projectionSource: row.projectionSource,
        projectionComponents: row.projectionComponents,
        seasonRank: seasonRow?.positionRank ?? null,
        seasonValue: seasonRow?.value ?? null,
        movement30Day: seasonRow ? movementPercent(seasonRow.value, seasonRow.trend30Day) : null,
        isRostered: rostered.has(row.playerId),
      };
    });

    seasonRows.forEach((row) => {
      if (matchedSeasonIds.has(row.playerId)) return;
      results.push({
        key: `season-${row.playerId}`,
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        opponent: null,
        isAway: null,
        isBye: false,
        injuryStatus: null,
        weeklyRank: null,
        weeklyProjection: null,
        projectionComponents: null,
        seasonRank: row.positionRank,
        seasonValue: row.value,
        movement30Day: movementPercent(row.value, row.trend30Day),
        isRostered: rostered.has(row.playerId),
      });
    });

    leagueDefenses.forEach((row) => {
      results.push({
        key: `defense-${row.team}`,
        playerId: row.team,
        name: `${row.team} Defense`,
        team: row.team,
        position: "DEF",
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: false,
        injuryStatus: null,
        weeklyRank: row.rank,
        weeklyProjection: row.displayProjection,
        projectionSource: row.projectionSource,
        seasonRank: null,
        seasonValue: null,
        movement30Day: null,
        isRostered: rostered.has(row.team),
        gamePhase: row.gamePhase,
        defenseComponents: row.components,
        projectionComponents: null,
      });
    });
    return results;
  }, [dashboard.seasonLongRankings, league.rankingField, league.rosteredPlayerIds, league.seasonLongFormat.key, leagueDefenses, leagueRankings]);

  const allPlayerDetailsById = useMemo(
    () => new Map(allPlayerDetails.map((player) => [player.playerId, player])),
    [allPlayerDetails],
  );
  const trendingByPlayerId = useMemo(
    () => new Map((draftData?.trending ?? []).map((item) => [item.playerId, item])),
    [draftData?.trending],
  );
  const trendingDropsByPlayerId = useMemo(
    () => new Map((draftData?.trendingDrops ?? []).map((item) => [item.playerId, item])),
    [draftData?.trendingDrops],
  );
  const newsItemsByPlayer = useMemo(() => groupNewsItemsByPlayer(news), [news]);
  const selectedPlayerNews = playerHistory.current ? newsItemsByPlayer.get(playerHistory.current.playerId) ?? [] : [];

  const searchMatches = useMemo<PlayerSearchResult[]>(() => {
    const needle = comparablePlayerName(query.trim());
    if (!needle) return [];
    return allPlayerDetails
      .filter((row) => comparablePlayerName(row.name).includes(needle))
      .sort((a, b) => {
        const aName = comparablePlayerName(a.name);
        const bName = comparablePlayerName(b.name);
        const aPriority = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
        const bPriority = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
        return aPriority - bPriority
          || (a.weeklyRank ?? a.seasonRank ?? Number.MAX_SAFE_INTEGER) - (b.weeklyRank ?? b.seasonRank ?? Number.MAX_SAFE_INTEGER)
          || a.name.localeCompare(b.name);
      });
  }, [allPlayerDetails, query]);
  const searchRows = useMemo(() => searchMatches.slice(0, 80), [searchMatches]);
  const weeklyContextByPlayerId = useMemo(
    () => new Map(leagueRankings.map((row) => [row.playerId, row])),
    [leagueRankings],
  );
  const rows = useMemo(() => {
    const rostered = new Set(league.rosteredPlayerIds);
    if (isSeasonLong) {
      return dashboard.seasonLongRankings
        .filter((row) => row.formatKey === seasonFormatKey && row.position !== "PICK" && includedPositions.includes(row.position))
        .filter((row) => effectivePosition !== "ROOKIES" || row.isRookie)
        .filter((row) => !availableOnly || !rostered.has(row.playerId))
        .map((row) => {
          const rosterAssignment = rosterTeamByPlayer.get(row.playerId);
          const weeklyContext = weeklyContextByPlayerId.get(row.playerId);
          const team = row.team ?? weeklyContext?.team ?? null;
          return {
            key: row.playerId,
            rank: row.positionRank,
            sortRank: row.overallRank,
            name: row.name,
            meta: row.isRookie ? "Rookie" : "",
            teamContext: {
              team,
              opponent: weeklyContext?.opponent ?? null,
              isAway: weeklyContext?.isAway ?? null,
              isBye: weeklyContext?.isBye ?? false,
            },
            rosterTeamName: rosterAssignment?.teamName ?? null,
            rosterIsUser: rosterAssignment?.isUser ?? false,
            projection: row.value,
            projectionLabel: "VALUE",
            projectionSource: null,
            position: row.position,
            injuryStatus: null,
            movement30Day: movementPercent(row.value, row.trend30Day),
          };
        })
        .sort((a, b) => effectivePosition === "ALL"
          ? (b.projection ?? -1) - (a.projection ?? -1) || a.sortRank - b.sortRank
          : effectivePosition === "QB" || effectivePosition === "RB" || effectivePosition === "WR" || effectivePosition === "TE"
            ? a.rank - b.rank
            : a.sortRank - b.sortRank);
    }
    if (effectivePosition === "DEF") {
      return leagueDefenses
        .filter((row) => !availableOnly || !rostered.has(row.team))
        .map((row) => {
          const rosterAssignment = rosterTeamByPlayer.get(row.team);
          return {
            key: row.team,
            rank: row.rank,
            name: `${row.team} Defense`,
            meta: matchupLabel(row.opponent, row.isAway),
            teamContext: null,
            rosterTeamName: rosterAssignment?.teamName ?? null,
            rosterIsUser: rosterAssignment?.isUser ?? false,
            projection: row.displayProjection,
            projectionLabel: row.gamePhase === "final" ? "PTS" : "PROJ",
            projectionSource: row.projectionSource,
            position: "DEF",
            injuryStatus: null,
            movement30Day: null,
          };
        });
    }
    return leagueRankings
      .filter((row) => includedPositions.includes(row.position))
      .filter((row) => !availableOnly || !rostered.has(row.playerId))
      .map((row) => {
        const rosterAssignment = rosterTeamByPlayer.get(row.playerId);
        return {
          key: row.playerId,
          rank: league.rankingField === "ppr" ? row.pprRank : row.halfPprRank,
          name: row.name,
          meta: `${row.position} · ${row.team}${row.opponent ? ` · ${matchupLabel(row.opponent, row.isAway)}` : ""}`,
          teamContext: null,
          rosterTeamName: rosterAssignment?.teamName ?? null,
          rosterIsUser: rosterAssignment?.isUser ?? false,
          projection: league.rankingField === "ppr" ? row.ppr : row.halfPpr,
          projectionLabel: "PROJ",
          projectionSource: row.projectionSource,
          position: row.position,
          injuryStatus: row.injuryStatus,
          movement30Day: null,
        };
      })
      .sort((a, b) => effectivePosition === "FLEX" || effectivePosition === "SUPER"
        ? (b.projection ?? -1) - (a.projection ?? -1) || a.rank - b.rank
        : a.rank - b.rank);
  }, [availableOnly, dashboard.seasonLongRankings, effectivePosition, includedPositions, isSeasonLong, league.rankingField, league.rosteredPlayerIds, leagueDefenses, leagueRankings, rosterTeamByPlayer, seasonFormatKey, weeklyContextByPlayerId]);
  const visibleRows = rows.slice(0, visibleRowCount);
  const hasSearch = query.trim().length > 0;
  const prefetchPlayerPanels = (player: PlayerSearchResult) => {
    const position = isBoomBustPosition(player.position) ? player.position : null;
    if (position !== null) {
      void queryClient.prefetchQuery({
        queryKey: ["boom-bust-history", league.id, player.playerId, "season"],
        queryFn: () => api.getBoomBustHistory({ leagueId: league.id, playerId: player.playerId, position, view: "season" }),
        staleTime: 30 * 60 * 1000,
      });
    }
    if (player.position !== "PICK" && player.seasonValue !== null) {
      void queryClient.prefetchQuery({
        queryKey: ["fantasycalc-value-history", league.seasonLongFormat.key, [player.playerId]],
        queryFn: () => api.getValueHistory({ formatKey: league.seasonLongFormat.key, playerIds: [player.playerId] }),
        staleTime: 30 * 60 * 1000,
      });
    }
  };
  const selectSearchResult = (player: PlayerSearchResult) => {
    setSheetMode("details");
    playerHistory.open(player);
  };

  return (
    <section className="rankings-view">
      <div className="rankings-toolbar">
        <label className="search-field">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input
            type="search"
            aria-label="Search all players by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Search all players"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {hasSearch ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="Clear player search">×</button> : null}
        </label>
        {!hasSearch ? (
          <div className="position-filter-rows" role="group" aria-label="Position filter">
            <SegmentedControl
              className={`position-tabs${!positionFilters.includes(effectivePosition) ? " no-active" : ""}`}
              value={effectivePosition}
              onChange={setPosition}
              label="Positions"
              options={positionFilters.map((item) => ({ value: item, label: item === "DEF" ? "DST" : item }))}
            />
            {modifierFilters.length > 0 ? (
              <SegmentedControl
                className={`position-tabs position-modifier-tabs${!modifierFilters.includes(effectivePosition) ? " no-active" : ""}`}
                value={effectivePosition}
                onChange={setPosition}
                label="Position modifiers"
                options={modifierFilters.map((item) => ({ value: item, label: item }))}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {hasSearch ? (
        <>
          <div className="player-search-head" aria-hidden="true"><span>Player</span><span>Week</span><span>Value</span></div>
          <div className="player-search-list" aria-label="Matching players">
            {searchRows.map((row) => {
              const isMine = myRoster.has(row.playerId);
              return (
              <button
                className={`player-search-result${isMine ? " is-my-roster" : ""}`}
                key={row.key}
                type="button"
                onPointerDown={() => prefetchPlayerPanels(row)}
                onFocus={() => prefetchPlayerPanels(row)}
                onClick={() => selectSearchResult(row)}
                aria-label={`View ${row.name}, ${row.position === "DEF" ? "DST" : row.position}, ${accessibleMatchupLabel(row.team, row.opponent, row.isAway, row.isBye)}, ${row.weeklyProjection === null ? "no projection" : `${formatProjectionPoints(row.weeklyProjection, row.projectionSource)} projected points`}, ${row.seasonValue === null ? "no season value" : `${row.seasonValue.toLocaleString()} season value`}${row.injuryStatus ? `, injury status ${row.injuryStatus}` : ""}${isMine ? ", on your team" : ""}`}
              >
                <span className="player-search-main">
                  <span className="player-search-name">
                    <strong>{row.name}</strong>
                    {row.injuryStatus ? <span className="injury" aria-label={`Injury status: ${row.injuryStatus}`} title={row.injuryStatus}>{sleeperInjuryTag(row.injuryStatus)}</span> : null}
                  </span>
                  <span className="player-search-meta"><span>{row.position}</span><MatchupTag team={row.team} opponent={row.opponent} isAway={row.isAway} isBye={row.isBye} position={row.position} entry={sosEntry} onClick={row.team && row.opponent && onOpenMatchup ? (event) => { event.stopPropagation(); onOpenMatchup({ team: row.team ?? "", opponent: row.opponent ?? "", isAway: row.isAway, gamePhase: row.gamePhase ?? null }); } : undefined} /></span>
                </span>
                <span className="player-search-value"><strong>{formatProjectionPoints(row.weeklyProjection, row.projectionSource)}</strong><small>{row.weeklyProjection === null ? "No projection" : row.weeklyRank === null ? "—" : `#${row.weeklyRank}`}</small></span>
                <span className="player-search-value"><strong>{row.seasonValue === null ? "—" : row.seasonValue.toLocaleString()}</strong><small>{row.seasonRank === null ? "—" : `#${row.seasonRank}`}</small></span>
              </button>
              );
            })}
          </div>
          {searchRows.length === 0 ? <div className="empty-inline">No player names match “{query.trim()}”.</div> : null}
        </>
      ) : (
        <>
          <SegmentedControl
            className="lineup-mode-toggle rankings-mode-toggle"
            value={rankingMode}
            onChange={setRankingMode}
            label={availableOnly ? "Waiver ranking horizon" : "Ranking horizon"}
            options={league.seasonLongFormat.isDynasty
              ? [{ value: "week", label: `Week ${dashboard.week}` }, { value: "ros", label: "Season Long" }, { value: "dynasty", label: "Dynasty" }]
              : [{ value: "week", label: `Week ${dashboard.week}` }, { value: "ros", label: "Season Long" }]}
          />
          <div className="rankings-note">
            <span>{isSeasonLong
              ? `${availableOnly ? "Available · " : ""}${rankingMode === "dynasty"
                ? league.seasonLongFormat.label
                : `Redraft · ${league.seasonLongFormat.numTeams}-team · ${league.seasonLongFormat.numQbs === 2 ? "Superflex / 2QB" : "1QB"} · ${league.seasonLongFormat.ppr === 1 ? "PPR" : league.seasonLongFormat.ppr === 0.5 ? "Half PPR" : "Standard"}`}`
              : availableOnly ? `Available · ${league.scoringLabel}` : league.scoringLabel}</span>
            {!isSeasonLong && effectivePosition === "DEF"
              ? <span>Actual shown after final</span>
              : !isSeasonLong && effectivePosition === "K"
                ? <span>Rank follows opposing DST, worst first</span>
                : <span>{rows.length} players</span>}
          </div>
          <div className="ranking-list">
            {visibleRows.map((row) => {
              const isMine = !availableOnly && myRoster.has(row.key);
              const detail = allPlayerDetailsById.get(row.key) ?? null;
              const trend = availableOnly ? trendingByPlayerId.get(row.key) : undefined;
              const trendDrop = availableOnly ? trendingDropsByPlayerId.get(row.key) : undefined;
              const accessibleMatchup = isSeasonLong
                ? [
                    row.teamContext?.team ?? "Free agent",
                    row.teamContext?.opponent ? `${row.teamContext.isAway ? "at" : "versus"} ${row.teamContext.opponent}` : row.teamContext?.isBye ? "bye week" : null,
                    row.meta || null,
                  ].filter((value): value is string => Boolean(value)).join(", ")
                : detail
                  ? accessibleMatchupLabel(detail.team, detail.opponent, detail.isAway, detail.isBye)
                  : "no projection";
              const accessibleValue = isSeasonLong
                ? `${Math.round(row.projection ?? 0).toLocaleString()} ${row.projectionLabel}`
                : `${formatProjectionPoints(row.projection, row.projectionSource)} projected points`;
              const rowAccessibleLabel = `View ${row.name}, ${accessibleMatchup}, ${accessibleValue}${row.injuryStatus ? `, injury status ${row.injuryStatus}` : ""}${row.rosterTeamName ? `, rostered by ${row.rosterTeamName}` : ""}`;
              const content = (
                <>
                  <span className="ranking-player">
                    <span className="ranking-name-line">
                      <strong>{row.name}</strong>
                      {!isSeasonLong && row.injuryStatus ? <span className="injury" aria-label={`Injury status: ${row.injuryStatus}`} title={row.injuryStatus}>{sleeperInjuryTag(row.injuryStatus)}</span> : null}
                    </span>
                    <span className="ranking-meta-line">
                      {isSeasonLong ? (
                        <>
                          <SeasonTeamPill
                            team={row.teamContext?.team ?? null}
                            lineRank={row.teamContext?.team ? offensiveLineRankByTeam.get(canonicalNflTeam(row.teamContext.team) ?? row.teamContext.team) ?? null : null}
                            onOpen={row.teamContext?.team ? () => setSelectedTeam({
                              team: row.teamContext?.team ?? "",
                            }) : undefined}
                          />
                          {row.meta ? <span className="ranking-player-context">{row.meta}</span> : null}
                        </>
                      ) : (
                        <span className="ranking-football-meta matchup-meta-group">
                          <MatchupTag team={detail?.team ?? null} opponent={detail?.opponent ?? null} isAway={detail?.isAway} isBye={detail?.isBye} position={row.position} entry={sosEntry} onClick={detail?.team && detail.opponent && onOpenMatchup ? (event) => { event.stopPropagation(); onOpenMatchup({ team: detail.team ?? "", opponent: detail.opponent ?? "", isAway: detail.isAway, gamePhase: detail.gamePhase ?? null }); } : undefined} />
                        </span>
                      )}
                      {row.rosterTeamName ? (
                        <span className={`roster-owner-tag${row.rosterIsUser ? " is-user" : ""}`} title={row.rosterIsUser ? "Your roster" : `Rostered by ${row.rosterTeamName}`}>
                          {row.rosterTeamName}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="ranking-proj"><strong>{isSeasonLong ? Math.round(row.projection ?? 0).toLocaleString() : formatProjectionPoints(row.projection, row.projectionSource)}</strong>{!isSeasonLong && row.projection === null ? <span>No projection</span> : <span>{row.projectionLabel}</span>}</span>
                </>
              );
              const detailWithWaiverTrends: PlayerSearchResult | null = detail ? {
                ...detail,
                waiverTrends: availableOnly ? {
                  adds: trend ? { rank: trend.rank, count: trend.count } : null,
                  drops: trendDrop ? { rank: trendDrop.rank, count: trendDrop.count } : null,
                } : undefined,
              } : null;
              const openSheet = (mode: "details" | "chart") => {
                if (!detailWithWaiverTrends) return;
                setSheetMode(mode);
                playerHistory.open(detailWithWaiverTrends);
              };
              return (
                <div
                  className={`ranking-row ranking-row-button${isMine ? " is-my-roster" : ""}`}
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  onPointerDown={() => detailWithWaiverTrends && prefetchPlayerPanels(detailWithWaiverTrends)}
                  onFocus={() => detailWithWaiverTrends && prefetchPlayerPanels(detailWithWaiverTrends)}
                  onClick={() => openSheet("details")}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    openSheet("details");
                  }}
                  aria-label={rowAccessibleLabel}
                >
                  {content}
                </div>
              );
            })}
            {rows.length > 0 ? (
              <div className="list-pagination-row">
                <span aria-live="polite">showing {Math.min(visibleRowCount, rows.length)} of {rows.length}</span>
                {visibleRowCount < rows.length ? <button type="button" onClick={() => setVisibleRowCount((count) => count + 120)}>Show more</button> : null}
              </div>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <div className="empty-inline empty-stack">
              <strong>{isSeasonLong && !availableOnly ? "No rankings for this format." : availableOnly ? "No available players match this filter." : "No rankings match this filter."}</strong>
              <span>{isSeasonLong && !availableOnly ? "Choose another league or try Current week." : "Choose another position or league."}</span>
            </div>
          ) : null}
        </>
      )}

      {playerHistory.current ? <PlayerDetailSheet player={playerHistory.current} week={dashboard.week} leagueId={league.id} formatKey={league.seasonLongFormat.key} mode={sheetMode} analytics={dashboard.analytics} sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id)} newsItems={selectedPlayerNews} newsLoading={newsLoading} newsError={newsError} onRetryNews={onRetryNews} onModeChange={availableOnly ? setSheetMode : undefined} onOpenMatchup={onOpenMatchup} onBack={playerHistory.back} canGoBack={playerHistory.canGoBack} onClose={playerHistory.close} /> : null}
      {selectedTeam ? (
        <TeamDataModal
          selection={selectedTeam}
          offensiveLine={offensiveLine}
          defense={defense}
          offense={offense}
          teamOverall={teamOverall}
          usage={teamUsageByTeam.get(canonicalNflTeam(selectedTeam.team) ?? selectedTeam.team) ?? null}
          record={teamRecordByTeam.get(canonicalNflTeam(selectedTeam.team) ?? selectedTeam.team) ?? null}
          situational={teamSituationalByTeam.get(canonicalNflTeam(selectedTeam.team) ?? selectedTeam.team) ?? null}
          situationalSource={teamSituational ? { fetchedAt: teamSituational.fetchedAt, sourceUrl: teamSituational.sourceUrl } : null}
          loading={pfnTablesQuery.isPending}
          loadError={pfnTablesQuery.isError}
          onRetry={() => { void pfnTablesQuery.refetch(); }}
          onClose={() => setSelectedTeam(null)}
        />
      ) : null}
    </section>
  );
}


function BoomBustPanel({
  name,
  view,
  onViewChange,
  history,
  isLoading,
}: {
  name: string;
  view: "season" | "last3";
  onViewChange: (view: "season" | "last3") => void;
  history: BoomBustHistory | undefined;
  isLoading: boolean;
}) {
  const weeklyScores = history?.weeklyScores ?? [];
  const floor = history?.floor ?? null;
  const firstQuartile = history?.firstQuartile ?? null;
  const medianScore = history?.median ?? null;
  const meanScore = history?.mean ?? null;
  const thirdQuartile = history?.thirdQuartile ?? null;
  const ceiling = history?.ceiling ?? null;
  const plotMinimum = weeklyScores.length > 0 ? Math.min(...weeklyScores.map((score) => score.points)) : null;
  const range = plotMinimum !== null && ceiling !== null ? ceiling - plotMinimum : 0;
  const markerPosition = (value: number): number => range === 0 || plotMinimum === null ? 50 : ((value - plotMinimum) / range) * 100;
  const scoreLabel = (value: number | null): string => value === null ? "—" : value.toFixed(1);
  const gameLabel = (score: { season: number; week: number }): string => view === "last3" ? `${score.season} Week ${score.week}` : `Week ${score.week}`;
  const description = weeklyScores.map((score) => `${gameLabel(score)}: ${score.points.toFixed(1)}`).join(", ");
  const showQuartiles = weeklyScores.length >= 8 && firstQuartile !== null && thirdQuartile !== null;
  const quartileDescription = showQuartiles ? ` Interquartile range ${scoreLabel(firstQuartile)} to ${scoreLabel(thirdQuartile)}.` : "";
  const rangeLabel = view === "last3" ? "2024 through 2026 regular-season weekly scores" : "2026 weekly scores";

  return (
    <section className="boom-bust-panel" aria-label={`${name} boom bust history`}>
      <div className="boom-bust-heading">
        <div className="boom-bust-heading-copy">
          <span>Boom / Bust</span>
          <strong>{weeklyScores.length > 0 ? `${weeklyScores.length} game${weeklyScores.length === 1 ? "" : "s"}` : "Weekly range"}</strong>
        </div>
        <div className="boom-bust-toggle" role="group" aria-label="Boom Bust history range">
          <button type="button" className={view === "season" ? "active" : ""} aria-pressed={view === "season"} onClick={() => onViewChange("season")}>2026</button>
          <button type="button" className={view === "last3" ? "active" : ""} aria-pressed={view === "last3"} onClick={() => onViewChange("last3")}>Last 3 Years</button>
        </div>
      </div>
      {isLoading && !history ? (
        <div className="loading-shimmer boom-bust-loading" aria-hidden="true" />
      ) : weeklyScores.length > 0 && floor !== null && medianScore !== null && meanScore !== null && ceiling !== null ? (
        <div className="boom-bust-visual" role="img" aria-label={`${name} ${rangeLabel}. ${description}. Bust ${scoreLabel(floor)}, ${weeklyScores.length >= 5 ? "10th percentile" : "minimum with fewer than 5 qualified weeks"}; median ${scoreLabel(medianScore)}, mean ${scoreLabel(meanScore)}, ceiling ${scoreLabel(ceiling)}.${quartileDescription}`}>
          <div className="boom-bust-track">
            <div className="boom-bust-band" />
            {showQuartiles ? (
              <div
                className="boom-bust-iqr"
                style={{ left: `${markerPosition(firstQuartile)}%`, width: `${markerPosition(thirdQuartile) - markerPosition(firstQuartile)}%` }}
                title={`Middle 50%: ${firstQuartile.toFixed(1)}–${thirdQuartile.toFixed(1)} points`}
              />
            ) : null}
            {weeklyScores.map((score, index) => (
              <i
                className={`boom-bust-dot ${index % 2 === 0 ? "above" : "below"}`}
                key={`${score.season}-${score.week}`}
                style={{ left: `${markerPosition(score.points)}%` }}
                title={`${gameLabel(score)}: ${score.points.toFixed(1)} points`}
              />
            ))}
            <i className="boom-bust-bust-mark" style={{ left: `${markerPosition(floor)}%` }} title={weeklyScores.length >= 5 ? `Bust (10th percentile): ${floor.toFixed(1)} points` : `Bust (minimum): ${floor.toFixed(1)} points`} />
            <i className="boom-bust-median-mark" style={{ left: `${markerPosition(medianScore)}%` }} title={`Median: ${medianScore.toFixed(1)} points`} />
            <i className="boom-bust-mean-mark" style={{ left: `${markerPosition(meanScore)}%` }} title={`Mean: ${meanScore.toFixed(1)} points`} />
          </div>
          <div className="boom-bust-labels">
            <span><small>Bust · {weeklyScores.length >= 5 ? "10th %ile" : "min"}</small><strong>{scoreLabel(floor)}</strong></span>
            <span><small>Median</small><strong>{scoreLabel(medianScore)}</strong></span>
            <span><small>Mean</small><strong>{scoreLabel(meanScore)}</strong></span>
            <span><small>Ceiling</small><strong>{scoreLabel(ceiling)}</strong></span>
          </div>
        </div>
      ) : (
        <div className="boom-bust-empty">{isLoading ? "Loading weekly results…" : history?.status === "unavailable" ? "No scoring history yet. Try again after the next data refresh." : view === "last3" ? "No games in the last 3 seasons" : "No games yet this season"}</div>
      )}
      {view === "last3" && history?.coverageNote ? <p className="boom-bust-note">{history.coverageNote}</p> : null}
    </section>
  );
}

function PlayerValueTrend({ name, history, isLoading }: { name: string; history: ValueHistorySeries | undefined; isLoading: boolean }) {
  const points = history?.points ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last && points.length > 1 ? last.value - first.value : null;
  const formatDateTick = (value: string): string => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  };

  return (
    <section className="player-value-trend" aria-label={`${name} FantasyCalc value history`}>
      <div className="trade-stock-heading">
        <span>Value history</span>
        {change !== null ? <strong className={change > 0 ? "up" : change < 0 ? "down" : "flat"}>{change > 0 ? "+" : ""}{change.toLocaleString()}</strong> : isLoading && !history ? null : <strong className="flat">{points.length} snapshot{points.length === 1 ? "" : "s"}</strong>}
      </div>
      {isLoading && !history ? (
        <div className="loading-shimmer player-value-trend-loading" aria-hidden="true" />
      ) : points.length ? (
        <div className="player-value-trend-chart" role="img" aria-label={`${name} FantasyCalc value from ${first?.date ?? "first snapshot"} to ${last?.date ?? "latest snapshot"}`}>
          <ResponsiveContainer width="100%" height={112}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 18, left: 0 }}>
              <CartesianGrid stroke="var(--hairline)" strokeDasharray="2 5" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fill: "var(--dim)", fontSize: "var(--type-caption)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={18} />
              <YAxis domain={["dataMin", "dataMax"]} width={42} tick={{ fill: "var(--dim)", fontSize: "var(--type-caption)" }} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(label) => formatDateTick(String(label))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: "var(--type-caption)" }} />
              <Line type="monotone" dataKey="value" name="Value" stroke="var(--text)" strokeWidth={2} dot={{ r: points.length === 1 ? 3 : 2, fill: "var(--text)" }} activeDot={{ r: 4 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="player-value-trend-empty">{isLoading ? "Loading daily snapshots…" : "History begins with the next successful daily snapshot."}</div>}
    </section>
  );
}

function AggregateTradeHistory({ give, get, historyByPlayerId, isLoading }: { give: TradeAsset[]; get: TradeAsset[]; historyByPlayerId: Map<string, ValueHistorySeries>; isLoading: boolean }) {
  const playerSide = (assets: TradeAsset[]) => assets.filter((asset) => asset.position !== "PICK");
  const givePlayers = playerSide(give);
  const getPlayers = playerSide(get);
  const dates = [...new Set([...givePlayers, ...getPlayers].flatMap((asset) => historyByPlayerId.get(asset.playerId)?.points.map((point) => point.date) ?? []))].sort();
  const pointMap = new Map([...historyByPlayerId.entries()].map(([id, series]) => [id, new Map(series.points.map((point) => [point.date, point.value]))]));
  const totalOn = (assets: TradeAsset[], date: string): number | null => {
    if (assets.length === 0) return null;
    const values = assets.map((asset) => pointMap.get(asset.playerId)?.get(date));
    return values.every((value): value is number => typeof value === "number") ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const data = dates.map((date) => ({ date, give: totalOn(givePlayers, date), get: totalOn(getPlayers, date) }));
  const hasGive = data.some((point) => point.give !== null);
  const hasGet = data.some((point) => point.get !== null);
  const formatDateTick = (value: string): string => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  };

  return (
    <section className="trade-aggregate" aria-labelledby="trade-aggregate-heading">
      <div className="section-heading"><h2 id="trade-aggregate-heading">30-day trade value</h2><span>selected players only</span></div>
      {data.length > 0 && (hasGive || hasGet) ? (
        <>
          <div className="trade-aggregate-chart" role="img" aria-label="Thirty-day FantasyCalc total value for each side of the trade">
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={data} margin={{ top: 14, right: 12, bottom: 18, left: 2 }}>
                <CartesianGrid stroke="var(--hairline)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fill: "var(--dim)", fontSize: "var(--type-caption)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
                <YAxis width={48} tick={{ fill: "var(--dim)", fontSize: "var(--type-caption)" }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(label) => formatDateTick(String(label))} formatter={(value, name) => [Number(value).toLocaleString(), name === "give" ? "You give" : "You get"]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: "var(--type-caption)" }} />
                {hasGive ? <Line type="monotone" dataKey="give" name="give" stroke="var(--stat-weakness)" strokeWidth={2.3} dot={false} connectNulls={false} /> : null}
                {hasGet ? <Line type="monotone" dataKey="get" name="get" stroke="var(--stat-strength)" strokeWidth={2.3} dot={false} connectNulls={false} /> : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="trade-aggregate-key"><span><i className="give" />You give</span><span><i className="get" />You get</span></div>
        </>
      ) : <div className="trade-stock-empty">{isLoading ? "Loading FantasyCalc history…" : "Add a player to either side to chart its sourced daily value."}</div>}
      {(give.some((asset) => asset.position === "PICK") || get.some((asset) => asset.position === "PICK")) ? <p>Draft picks remain in the totals above but are excluded from this player-history chart.</p> : null}
    </section>
  );
}

function TradeAssetRow({ asset, onRemove, onOpenPlayer }: { asset: TradeAsset; onRemove: () => void; onOpenPlayer: (playerId: string) => void }) {
  return (
    <div className="trade-asset-block">
      <div className="trade-asset-row">
        <div className="trade-asset-main">
          <div className="trade-asset-name">
            {asset.position === "PICK" ? <strong>{asset.name}</strong> : <button type="button" className="trade-asset-open" onClick={() => onOpenPlayer(asset.playerId)} aria-label={`View ${asset.name} details and news`}><strong>{asset.name}</strong></button>}
            <span className={`asset-position${asset.position === "PICK" ? " pick" : ""}`}>{asset.position === "PICK" ? "PICK" : asset.position}</span>
          </div>
          <span>{asset.position === "PICK" ? "Dynasty draft pick" : asset.team ?? "Free agent"}</span>
        </div>
        <div className="trade-asset-value"><strong>{asset.value.toLocaleString()}</strong></div>
        <button className="remove-asset" onClick={onRemove} aria-label={`Remove ${asset.name}`} title={`Remove ${asset.name}`}>×</button>
      </div>
    </div>
  );
}

function projectionPoints(player: RosterPlayer): number {
  return player.gamePhase === "final" ? (player.actual ?? player.projection ?? 0) : (player.projection ?? 0);
}

function optimizeTradeRoster(players: RosterPlayer[], slots: string[]): OptimizedRoster {
  const currentStarterIds = new Set(players.filter((player) => player.isStarter).map((player) => player.playerId));
  type State = { score: number; currentCount: number; assignments: Array<RosterPlayer | undefined> };
  let states = new Map<number, State>([[0, { score: 0, currentCount: 0, assignments: Array.from({ length: slots.length }) }]]);
  for (const player of players) {
    if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(player.position)) continue;
    const next = new Map(states);
    for (const [mask, state] of states) {
      slots.forEach((slot, slotIndex) => {
        const bit = 2 ** slotIndex;
        if ((mask & bit) !== 0 || !eligibleForSlot(player.position, slot)) return;
        const nextMask = mask | bit;
        const candidate: State = {
          score: state.score + projectionPoints(player),
          currentCount: state.currentCount + (currentStarterIds.has(player.playerId) ? 1 : 0),
          assignments: state.assignments.map((assigned, index) => index === slotIndex ? player : assigned),
        };
        const existing = next.get(nextMask);
        if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.currentCount > existing.currentCount)) next.set(nextMask, candidate);
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
  const starters = bestState.assignments.flatMap((player, index) => player ? [{ ...player, isStarter: true, lineupSlot: slots[index] ?? player.position }] : []);
  const starterIds = new Set(starters.map((player) => player.playerId));
  const bench = players.filter((player) => !starterIds.has(player.playerId)).map((player) => ({ ...player, isStarter: false, lineupSlot: null }));
  return { starters, bench, score: Number(bestState.score.toFixed(2)) };
}

function tradeDepthScore(optimized: OptimizedRoster, slots: string[]): number {
  if (slots.length === 0) return 0;
  const nextUp = slots.map((slot) => optimized.bench
    .filter((player) => eligibleForSlot(player.position, slot))
    .reduce((best, player) => Math.max(best, projectionPoints(player)), 0));
  return Number((nextUp.reduce((sum, value) => sum + value, 0) / slots.length).toFixed(2));
}

type SideGrade = {
  lineupDelta: number;
  depthDelta: number;
  cuts: string[];
  adds: string[];
  explanation: string;
  missingProjections: number;
};

function gradeTradeSide(
  team: TradeTeam,
  outgoing: TradeAsset[],
  incoming: TradeAsset[],
  incomingTeam: TradeTeam,
  waiverPool: RosterPlayer[],
  slots: string[],
): SideGrade {
  const outgoingIds = new Set(outgoing.filter((asset) => asset.position !== "PICK").map((asset) => asset.playerId));
  const incomingIds = new Set(incoming.filter((asset) => asset.position !== "PICK").map((asset) => asset.playerId));
  const incomingPlayers = incomingTeam.players.filter((player) => incomingIds.has(player.playerId));
  const pre = optimizeTradeRoster(team.players, slots);
  let roster = [...team.players.filter((player) => !outgoingIds.has(player.playerId)), ...incomingPlayers.map((player) => ({ ...player, isStarter: false, lineupSlot: null }))];
  const cuts: string[] = [];
  while (roster.length > team.players.length) {
    const currentScore = optimizeTradeRoster(roster, slots).score;
    const cutCandidate = roster
      .map((player) => ({ player, cost: currentScore - optimizeTradeRoster(roster.filter((row) => row.playerId !== player.playerId), slots).score }))
      .sort((a, b) => a.cost - b.cost || projectionPoints(a.player) - projectionPoints(b.player) || a.player.name.localeCompare(b.player.name))[0];
    if (!cutCandidate) break;
    cuts.push(cutCandidate.player.name);
    roster = roster.filter((player) => player.playerId !== cutCandidate.player.playerId);
  }
  const adds: string[] = [];
  const unavailableIds = new Set([...team.players, ...incomingTeam.players].map((player) => player.playerId));
  while (roster.length < team.players.length) {
    const rosterIds = new Set(roster.map((player) => player.playerId));
    const add = waiverPool.find((player) => !rosterIds.has(player.playerId) && !unavailableIds.has(player.playerId) && !outgoingIds.has(player.playerId));
    if (!add) break;
    adds.push(add.name);
    roster.push({ ...add, isStarter: false, lineupSlot: null });
  }
  const post = optimizeTradeRoster(roster, slots);
  const lineupDelta = Number((post.score - pre.score).toFixed(2));
  const depthDelta = Number((tradeDepthScore(post, slots) - tradeDepthScore(pre, slots)).toFixed(2));

  const needRows = (["QB", "RB", "WR", "TE"] as const).flatMap((position) => {
    const pool = waiverPool.filter((player) => player.position === position && player.projection !== null).sort((a, b) => projectionPoints(a) - projectionPoints(b));
    const reference = pool[Math.floor(pool.length / 2)];
    if (!reference) return [];
    const gain = optimizeTradeRoster([...team.players, { ...reference, isStarter: false, lineupSlot: null }], slots).score - pre.score;
    return [{ position, gain }];
  }).sort((a, b) => b.gain - a.gain);
  const topNeed = needRows[0];

  const bestWaiver = waiverPool.find((player) => !team.players.some((row) => row.playerId === player.playerId));
  const surplusRows = outgoingIds.size === 0 ? [] : team.players
    .filter((player) => outgoingIds.has(player.playerId))
    .map((player) => {
      const without = team.players.filter((row) => row.playerId !== player.playerId);
      const refilled = bestWaiver ? [...without, { ...bestWaiver, isStarter: false, lineupSlot: null }] : without;
      return { player, cost: pre.score - optimizeTradeRoster(refilled, slots).score };
    })
    .sort((a, b) => a.cost - b.cost);
  const easiestOut = surplusRows[0];
  const needCopy = topNeed && topNeed.gain > 0.01 ? `${topNeed.position} is the clearest need (+${topNeed.gain.toFixed(1)} with a median available add).` : "No median waiver add changes the optimal lineup.";
  const surplusCopy = easiestOut ? `${easiestOut.player.name} has a ${Math.max(0, easiestOut.cost).toFixed(1)}-point removal cost after a waiver refill.` : "No outgoing player to test for surplus.";
  return {
    lineupDelta,
    depthDelta,
    cuts,
    adds,
    explanation: `${needCopy} ${surplusCopy}`,
    missingProjections: roster.filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position) && player.projection === null).length,
  };
}

function signed(value: number, digits = 1): string {
  if (Math.abs(value) < 0.005) return (0).toFixed(digits);
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function TradeSide({ title, assets, availableAssets, marketTotal, onAdd, onRemove, onClear, onOpenPlayer }: { title: string; assets: TradeAsset[]; availableAssets: TradeAsset[]; marketTotal: number; onAdd: (id: string) => void; onRemove: (id: string) => void; onClear: () => void; onOpenPlayer: (playerId: string) => void }) {
  const [query, setQuery] = useState("");
  const needle = comparablePlayerName(query.trim());
  const matches = availableAssets
    .filter((asset) => needle && comparablePlayerName(asset.name).includes(needle))
    .sort((a, b) => {
      const aName = comparablePlayerName(a.name);
      const bName = comparablePlayerName(b.name);
      const aPriority = aName === needle ? 0 : aName.startsWith(needle) ? 1 : 2;
      const bPriority = bName === needle ? 0 : bName.startsWith(needle) ? 1 : 2;
      return aPriority - bPriority || a.name.localeCompare(b.name);
    })
    .slice(0, 10);
  const searchId = `trade-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const chooseAsset = (asset: TradeAsset) => {
    onAdd(asset.playerId);
    setQuery("");
  };

  return (
    <section className="trade-side" aria-label={title}>
      <div className="trade-side-heading">
        <div><h2>{title}</h2></div>
        {assets.length ? <button onClick={onClear}>Clear</button> : null}
      </div>
      <div className="trade-side-list">
        <div className="trade-side-search-wrap">
          <label className="sr-only" htmlFor={searchId}>Search assets to add to {title.toLowerCase()}</label>
          <div className="search-field trade-side-search">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              id={searchId}
              type="search"
              aria-label={`Search players or draft picks to add to ${title.toLowerCase()}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const firstMatch = matches[0];
                  if (firstMatch) { event.preventDefault(); chooseAsset(firstMatch); }
                } else if (event.key === "Escape") {
                  setQuery("");
                }
              }}
              placeholder={`Add to ${title.toLowerCase()}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label={`Clear ${title.toLowerCase()} asset search`}>×</button> : null}
          </div>
          {needle ? (
            <div className="trade-side-search-results inline-search-results" role="region" aria-label={`Assets available for ${title.toLowerCase()}`} aria-live="polite">
              <span className="sr-only">{matches.length} {matches.length === 1 ? "result" : "results"} found.</span>
              {matches.map((asset) => (
                <button type="button" key={asset.playerId} onClick={() => chooseAsset(asset)}>
                  <span><strong>{asset.name}</strong><small>{asset.position} · {asset.team ?? "Draft pick"}</small></span>
                  <b>{asset.value.toLocaleString()}</b>
                </button>
              ))}
              {matches.length === 0 ? <div className="trade-search-empty">No eligible assets match “{query.trim()}”.</div> : null}
            </div>
          ) : null}
        </div>
        {assets.map((asset) => <TradeAssetRow key={asset.playerId} asset={asset} onRemove={() => onRemove(asset.playerId)} onOpenPlayer={onOpenPlayer} />)}
      </div>
      <div className="trade-side-total"><strong>{marketTotal.toLocaleString()}</strong></div>
    </section>
  );
}

function LeagueAssetPicker({
  sideTitle,
  team,
  assetById,
  selectedIds,
  onAdd,
  onClose,
}: {
  sideTitle: string;
  team: TradeTeam;
  assetById: Map<string, TradeAsset>;
  selectedIds: Set<string>;
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const titleId = `league-asset-picker-${sideTitle.toLowerCase().replace(/\s+/g, "-")}`;
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const playerRows = team.players
    .map((player) => ({ player, asset: assetById.get(player.playerId) }))
    .sort((a, b) => (b.asset?.value ?? -1) - (a.asset?.value ?? -1) || a.player.name.localeCompare(b.player.name));
  const picks = [...team.ownedPicks].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  return (
    <ModalPortal>
      <div className="trade-picker-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="trade-picker" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="trade-picker-header">
          <div><h2 id={titleId}>Add Player</h2><p>{team.teamName} · {sideTitle}</p></div>
          <button type="button" onClick={onClose}>Done</button>
        </header>
        <div className="trade-picker-scroll">
          <div className="trade-picker-table" aria-label={`${team.teamName} roster`}>
            <div className="trade-picker-columns" aria-hidden="true"><span>Player</span><span>Value</span><span /></div>
            {playerRows.map(({ player, asset }) => {
              const isSelected = selectedIds.has(player.playerId);
              const isUnavailable = !asset;
              return (
                <button
                  key={player.playerId}
                  type="button"
                  className="trade-picker-row"
                  disabled={isSelected || isUnavailable}
                  onClick={() => { if (asset) onAdd(asset.playerId); }}
                  aria-label={isSelected ? `${player.name}, already added` : isUnavailable ? `${player.name}, no FantasyCalc value` : `Add ${player.name}, value ${asset.value}`}
                >
                  <span className="trade-picker-player"><span className="asset-position">{player.position}</span><strong>{player.name}</strong></span>
                  <b>{asset ? asset.value.toLocaleString() : "—"}</b>
                  <span className={`row-toggle-state${isSelected ? " selected" : ""}`} aria-hidden="true">{isSelected ? "✓" : isUnavailable ? "—" : "+"}</span>
                </button>
              );
            })}
          </div>
          {picks.length > 0 ? (
            <section className="trade-picker-picks" aria-labelledby={`${titleId}-picks`}>
              <h3 id={`${titleId}-picks`}>Draft picks</h3>
              <div className="trade-picker-table">
                <div className="trade-picker-columns" aria-hidden="true"><span>Pick</span><span>Value</span><span /></div>
                {picks.map((pick) => {
                  const isSelected = selectedIds.has(pick.playerId);
                  return (
                    <button key={pick.playerId} type="button" className="trade-picker-row" disabled={isSelected} onClick={() => onAdd(pick.playerId)} aria-label={isSelected ? `${pick.name}, already added` : `Add ${pick.name}, value ${pick.value}`}>
                      <span className="trade-picker-player"><span className="asset-position pick">PICK</span><strong>{pick.name}</strong></span>
                      <b>{pick.value.toLocaleString()}</b>
                      <span className={`row-toggle-state${isSelected ? " selected" : ""}`} aria-hidden="true">{isSelected ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
        </section>
      </div>
    </ModalPortal>
  );
}

function LeagueTradeSide({
  title,
  team,
  assets,
  assetById,
  selectedIds,
  marketTotal,
  onAdd,
  onRemove,
  onClear,
  onOpenPlayer,
}: {
  title: string;
  team: TradeTeam;
  assets: TradeAsset[];
  assetById: Map<string, TradeAsset>;
  selectedIds: Set<string>;
  marketTotal: number;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    setIsPickerOpen(false);
  }, [team.rosterId]);

  return (
    <section className="trade-side league-trade-side" aria-label={title}>
      <div className="trade-side-heading">
        <div><h2>{title}</h2><span>{team.teamName}</span></div>
        {assets.length ? <button onClick={onClear}>Clear</button> : null}
      </div>
      <div className="trade-side-list">
        <div className="trade-add-wrap">
          <button type="button" className="trade-add-player" onClick={() => setIsPickerOpen(true)}>Add Player</button>
        </div>
        {assets.map((asset) => <TradeAssetRow key={asset.playerId} asset={asset} onRemove={() => onRemove(asset.playerId)} onOpenPlayer={onOpenPlayer} />)}
      </div>
      <div className="trade-side-total"><strong>{marketTotal.toLocaleString()}</strong></div>
      {isPickerOpen ? <LeagueAssetPicker sideTitle={title} team={team} assetById={assetById} selectedIds={selectedIds} onAdd={onAdd} onClose={() => setIsPickerOpen(false)} /> : null}
    </section>
  );
}

function TradeGradeCard({
  give,
  get,
  mine,
  theirs,
  league,
  perspectiveLabel = "You",
  singlePerspective = false,
}: {
  give: TradeAsset[];
  get: TradeAsset[];
  mine: TradeTeam;
  theirs: TradeTeam;
  league: League;
  perspectiveLabel?: string;
  singlePerspective?: boolean;
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const giveMarket = tradeTotal(give);
  const getMarket = tradeTotal(get);
  const myGrade = gradeTradeSide(mine, give, get, theirs, league.tradeWaiverPool, league.tradeStarterSlots);
  const theirGrade = gradeTradeSide(theirs, get, give, mine, league.tradeWaiverPool, league.tradeStarterSlots);
  const projectionAgeHours = league.tradeValuation.projectionAsOf ? (Date.now() - new Date(league.tradeValuation.projectionAsOf).getTime()) / 3_600_000 : null;
  const missingProjectionCount = singlePerspective ? myGrade.missingProjections : myGrade.missingProjections + theirGrade.missingProjections;
  const confidenceNotes = [
    projectionAgeHours === null || !Number.isFinite(projectionAgeHours)
      ? "Weekly projection timestamp was not provided."
      : projectionAgeHours > 48
        ? `Weekly projections are ${Math.floor(projectionAgeHours / 24)} days old.`
        : `Weekly projections updated ${Math.max(0, Math.round(projectionAgeHours))} hours ago.`,
    ...league.tradeValuation.unsupportedSettings,
    ...(missingProjectionCount > 0 ? [`${missingProjectionCount} post-trade roster player${missingProjectionCount === 1 ? "" : "s"} lack a weekly projection.`] : []),
  ];
  const moveText = (grade: SideGrade): string => {
    const parts = [grade.cuts.length ? `Cut ${grade.cuts.join(", ")}` : "No cut", grade.adds.length ? `Add ${grade.adds.join(", ")}` : "no waiver add"];
    return parts.join(" · ");
  };
  return (
    <section className="trade-grade" aria-label="League-adjusted trade result">
      <div className="trade-grade-heading"><div><strong>Market price + roster impact</strong></div><small>Today's league outlook</small></div>
      <div className={`trade-grade-grid${singlePerspective ? " single-perspective" : ""}`}>
        <div><span>Market balance</span><strong>{signed(getMarket - giveMarket, 0)}</strong><small>{perspectiveLabel}</small></div>
        <div><span>{singlePerspective ? "Lineup delta" : "Your lineup delta"}</span><strong className={myGrade.lineupDelta > 0 ? "positive" : myGrade.lineupDelta < 0 ? "negative" : ""}>{signed(myGrade.lineupDelta)}</strong><small>weekly points</small></div>
        {singlePerspective ? null : <div><span>Their lineup delta</span><strong className={theirGrade.lineupDelta > 0 ? "positive" : theirGrade.lineupDelta < 0 ? "negative" : ""}>{signed(theirGrade.lineupDelta)}</strong><small>weekly points</small></div>}
        <div><span>Depth / risk</span><strong>{signed(myGrade.depthDelta)}</strong><small>{perspectiveLabel}</small></div>
      </div>
      <div className={`trade-grade-disclosure${isDetailsOpen ? " open" : ""}`}>
        <button type="button" className="trade-grade-toggle" aria-expanded={isDetailsOpen} aria-controls="trade-grade-details" onClick={() => setIsDetailsOpen((open) => !open)}>
          <span>Details</span><span className="trade-grade-toggle-icon" aria-hidden="true">{isDetailsOpen ? "−" : "+"}</span>
        </button>
        {isDetailsOpen ? (
          <div id="trade-grade-details" className="trade-grade-detail">
            <div><strong>Roster moves</strong><p>{perspectiveLabel}: {moveText(myGrade)}</p>{singlePerspective ? null : <p>{theirs.teamName}: {moveText(theirGrade)}</p>}</div>
            <div><strong>Roster fit</strong><p>{perspectiveLabel}: {myGrade.explanation}</p>{singlePerspective ? null : <p>{theirs.teamName}: {theirGrade.explanation}</p>}</div>
            <div><strong>Confidence notes</strong><ul>{confidenceNotes.map((note) => <li key={note}>{note}</li>)}</ul></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type HistoricalTradeDisplayAsset = {
  key: string;
  name: string;
  meta: string;
  value: number;
  note: string | null;
  playerId?: string;
};

type HistoricalTradeSide = {
  team: HistoricalTradeTeam;
  display: HistoricalTradeDisplayAsset[];
  valued: TradeAsset[];
  total: number;
};

function historicalCurrentOccupant(team: HistoricalTradeTeam, league: League): TradeTeam | undefined {
  if (team.ownerId !== null && league.tradeTeams.some((current) => current.ownerId === team.ownerId)) return undefined;
  return league.tradeTeams.find((current) => current.rosterId === team.rosterId);
}

function HistoricalTeamName({ team, league }: { team: HistoricalTradeTeam; league: League }) {
  const currentOccupant = historicalCurrentOccupant(team, league);
  return <>{team.teamName}{currentOccupant ? <small className="historical-team-current">({currentOccupant.teamName})</small> : null}</>;
}

function HistoricalTeamMatchup({ trade, league }: { trade: HistoricalTrade; league: League }) {
  if (trade.teams.length !== 2) return <>{trade.teams.length}-team trade</>;
  const first = trade.teams[0];
  const second = trade.teams[1];
  if (!first || !second) return <>Trade</>;
  return <><HistoricalTeamName team={first} league={league} /><i className="historical-team-separator" aria-hidden="true">↔</i><HistoricalTeamName team={second} league={league} /></>;
}

function TradeResultCard({
  give,
  get,
  mine,
  theirs,
  league,
  valuationMode,
  giveMarketTotal,
  getMarketTotal,
  balancePercent,
  balanceCopy,
  historyByPlayerId,
  historyLoading,
  onClose,
  contextLine,
  giveLabel = "You give",
  getLabel = "You get",
  historicalSides,
  historicalComparisonSides,
  rosterFitUnavailableNote,
  onOpenPlayer,
}: {
  give: TradeAsset[];
  get: TradeAsset[];
  mine: TradeTeam | undefined;
  theirs: TradeTeam | undefined;
  league: League;
  valuationMode: ValuationMode;
  giveMarketTotal: number;
  getMarketTotal: number;
  balancePercent: number;
  balanceCopy: ReactNode;
  historyByPlayerId: Map<string, ValueHistorySeries>;
  historyLoading: boolean;
  onClose: () => void;
  contextLine?: ReactNode;
  giveLabel?: string;
  getLabel?: string;
  historicalSides?: HistoricalTradeSide[];
  historicalComparisonSides?: [HistoricalTradeSide, HistoricalTradeSide];
  rosterFitUnavailableNote?: string;
  onOpenPlayer?: (playerId: string) => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);

  return (
    <ModalPortal>
      <div className="trade-result-backdrop" onClick={onClose}>
        <article
        ref={dialogRef}
        className="trade-result-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-result-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trade-result-header">
          <div><h2 id="trade-result-title">{contextLine ? "Trade hindsight" : "Trade calculation"}</h2><span>{contextLine ?? league.seasonLongFormat.label}</span></div>
          <button type="button" onClick={onClose} aria-label="Close trade calculation">×</button>
        </header>
        <div className="trade-result-body">
          {historicalSides ? (
            <div className="historical-deal-assets">
              {historicalSides.map((side) => (
                <section key={side.team.rosterId} aria-label={`${side.team.teamName} received assets`}>
                  <h3><HistoricalTeamName team={side.team} league={league} /></h3>
                  {side.display.length ? side.display.map((asset) => (
                    <div className="historical-deal-asset" key={asset.key}>
                      <span>
                        {asset.playerId && onOpenPlayer ? (
                          <button type="button" className="historical-deal-player" aria-label={`Open ${asset.name}`} onClick={() => { const playerId = asset.playerId; if (playerId) onOpenPlayer?.(playerId); }}>{asset.name}</button>
                        ) : <strong>{asset.name}</strong>}
                        <small>{asset.meta}</small>
                        {asset.note ? <em>{asset.note}</em> : null}
                      </span>
                      <b>{asset.value.toLocaleString()}</b>
                    </div>
                  )) : <p>Nothing recorded</p>}
                  <div className="historical-deal-total"><span>Received total</span><strong>{side.total.toLocaleString()}</strong></div>
                </section>
              ))}
            </div>
          ) : null}
          <section className="trade-balance" aria-label="Trade value comparison">
            <div className="trade-balance-labels">
              {historicalComparisonSides ? historicalComparisonSides.map((side) => (
                <span className="trade-balance-side-label" key={side.team.rosterId}>
                  <span><HistoricalTeamName team={side.team} league={league} /></span>
                  <b>{side.total.toLocaleString()}</b>
                </span>
              )) : <><span>{giveLabel} <b>{giveMarketTotal.toLocaleString()}</b></span><span>{getLabel} <b>{getMarketTotal.toLocaleString()}</b></span></>}
            </div>
            <div className="trade-balance-track" aria-hidden="true"><span style={{ width: `${balancePercent}%` }} /></div>
            <p>{balanceCopy}</p>
          </section>
          {valuationMode === "league" && mine && theirs ? (
            <TradeGradeCard
              key={`${league.id}:${mine.rosterId}:${theirs.rosterId}:${give.map((asset) => asset.playerId).join(",")}:${get.map((asset) => asset.playerId).join(",")}`}
              give={give}
              get={get}
              mine={mine}
              theirs={theirs}
              league={league}
              perspectiveLabel={contextLine ? mine.teamName : "You"}
              singlePerspective={Boolean(contextLine)}
            />
          ) : rosterFitUnavailableNote ? (
            <section className="trade-grade trade-grade-unavailable" aria-label="Roster-fit grading unavailable">
              <div className="trade-grade-heading"><div><strong>Market price + roster impact</strong></div><small>Today's league outlook</small></div>
              <p>{rosterFitUnavailableNote}</p>
            </section>
          ) : null}
          <AggregateTradeHistory give={give} get={get} historyByPlayerId={historyByPlayerId} isLoading={historyLoading} />
        </div>
        </article>
      </div>
    </ModalPortal>
  );
}

function historicalPickValue(assets: TradeAsset[], season: number, round: number): TradeAsset | undefined {
  const ordinal = round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`;
  return assets
    .filter((asset) => asset.position === "PICK" && asset.name.includes(String(season)) && asset.name.toLowerCase().includes(ordinal))
    .sort((a, b) => Number(/\bmid\b/i.test(b.name)) - Number(/\bmid\b/i.test(a.name)) || b.value - a.value)[0];
}

function historicalReceivedAssets(team: HistoricalTradeTeam, assets: TradeAsset[], tradeId: string, currentSeason: number): { display: HistoricalTradeDisplayAsset[]; valued: TradeAsset[] } {
  const byPlayerId = new Map(assets.filter((asset) => asset.position !== "PICK").map((asset) => [asset.playerId, asset]));
  const display: HistoricalTradeDisplayAsset[] = [];
  const valued: TradeAsset[] = [];
  for (const player of team.assets.players) {
    const current = byPlayerId.get(player.playerId);
    display.push({
      key: `${tradeId}:${team.rosterId}:player:${player.playerId}`,
      name: player.name,
      meta: player.position,
      value: current?.value ?? 0,
      note: current ? null : "no current value",
      playerId: player.playerId,
    });
    valued.push(current ?? {
      formatKey: assets[0]?.formatKey ?? "historical",
      playerId: player.playerId,
      name: player.name,
      team: null,
      position: "PICK",
      overallRank: 9999,
      positionRank: 9999,
      value: 0,
      trend30Day: null,
      isRookie: false,
    });
  }
  for (const pick of team.assets.picks) {
    const draftedPlayer = pick.draftedPlayerId ? byPlayerId.get(pick.draftedPlayerId) : undefined;
    if (pick.draftedPlayerId) {
      const draftedPlayerName = draftedPlayer?.name ?? pick.draftedPlayerName ?? pick.description;
      display.push({
        key: `${tradeId}:${team.rosterId}:pick:${pick.season}:${pick.round}:${pick.fromRosterId ?? "unknown"}`,
        name: draftedPlayerName,
        meta: `via ${pick.description}`,
        value: draftedPlayer?.value ?? 0,
        note: draftedPlayer ? null : "no current value",
        playerId: pick.draftedPlayerId,
      });
      valued.push(draftedPlayer ? {
        ...draftedPlayer,
        playerId: `historical:${tradeId}:${team.rosterId}:${draftedPlayer.playerId}`,
      } : {
        formatKey: assets[0]?.formatKey ?? "historical",
        playerId: `historical:${tradeId}:${team.rosterId}:${pick.draftedPlayerId}`,
        name: draftedPlayerName,
        team: null,
        position: "PICK",
        overallRank: 9999,
        positionRank: 9999,
        value: 0,
        trend30Day: null,
        isRookie: false,
      });
      continue;
    }
    const current = pick.season > currentSeason ? historicalPickValue(assets, pick.season, pick.round) : undefined;
    const note = pick.season <= currentSeason ? "pick already used" : current ? null : "no current pick value";
    const value = current?.value ?? 0;
    display.push({
      key: `${tradeId}:${team.rosterId}:pick:${pick.season}:${pick.round}:${pick.fromRosterId ?? "unknown"}`,
      name: pick.description,
      meta: "Draft pick",
      value,
      note,
    });
    valued.push(current ? { ...current, playerId: `historical:${tradeId}:${team.rosterId}:${current.playerId}` } : {
      formatKey: assets[0]?.formatKey ?? "historical",
      playerId: `historical:${tradeId}:${team.rosterId}:pick:${pick.season}:${pick.round}`,
      name: pick.description,
      team: null,
      position: "PICK",
      overallRank: 9999,
      positionRank: 9999,
      value: 0,
      trend30Day: null,
      isRookie: false,
    });
  }
  if (team.assets.faabReceived > 0) {
    display.push({
      key: `${tradeId}:${team.rosterId}:faab`,
      name: `$${team.assets.faabReceived} FAAB`,
      meta: "Waiver budget",
      value: 0,
      note: "not valued",
    });
  }
  return { display, valued };
}

function historicalPerspectiveAssets(trade: HistoricalTrade, selected: HistoricalTradeTeam, assets: TradeAsset[], currentSeason: number): {
  give: { display: HistoricalTradeDisplayAsset[]; valued: TradeAsset[] };
  get: { display: HistoricalTradeDisplayAsset[]; valued: TradeAsset[] };
} {
  const received = historicalReceivedAssets(selected, assets, trade.id, currentSeason);
  const otherTeams = trade.teams.filter((team) => team.rosterId !== selected.rosterId);
  const outgoingPlayers = otherTeams.flatMap((team) => team.assets.players.filter((player) => player.fromRosterId === selected.rosterId || (trade.teams.length === 2 && player.fromRosterId === null)));
  const outgoingPicks = otherTeams.flatMap((team) => team.assets.picks.filter((pick) => pick.fromRosterId === selected.rosterId || (trade.teams.length === 2 && pick.fromRosterId === null)));
  const outgoingFaab = trade.teams.length === 2 ? (otherTeams[0]?.assets.faabReceived ?? 0) : 0;
  const gaveTeam: HistoricalTradeTeam = {
    rosterId: selected.rosterId,
    ownerId: selected.ownerId,
    teamName: selected.teamName,
    isUserTeam: selected.isUserTeam,
    assets: { players: outgoingPlayers, picks: outgoingPicks, faabReceived: outgoingFaab },
  };
  return { give: historicalReceivedAssets(gaveTeam, assets, `${trade.id}:gave`, currentSeason), get: received };
}

function compactHistoricalAssets(team: HistoricalTradeTeam): string {
  const labels = [
    ...team.assets.players.map((player) => player.name),
    ...team.assets.picks.map((pick) => pick.description),
    ...(team.assets.faabReceived > 0 ? [`$${team.assets.faabReceived} FAAB`] : []),
  ];
  if (labels.length === 0) return "No assets listed";
  const shown = labels.slice(0, 3).join(" · ");
  return labels.length > 3 ? `${shown} · +${labels.length - 3} more` : shown;
}

function TradeHistoryView({ dashboard, league, onOpenPlayer }: { dashboard: Dashboard; league: League; onOpenPlayer: (playerId: string) => void }) {
  const queryClient = useQueryClient();
  const refreshRequested = useRef<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | "all">(dashboard.season);
  const formatAssets = useMemo(
    () => dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key),
    [dashboard.seasonLongRankings, league.seasonLongFormat.key],
  );
  const queryKey = ["historical-trades", league.id, selectedSeason] as const;
  const tradesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await api.getHistoricalTrades(selectedSeason === "all"
          ? { leagueId: league.id, refresh: false }
          : { leagueId: league.id, refresh: false, season: selectedSeason });
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    const refreshKey = `${league.id}:${selectedSeason}`;
    if (!tradesQuery.data?.isStale || refreshRequested.current === refreshKey) return;
    refreshRequested.current = refreshKey;
    void api.getHistoricalTrades(selectedSeason === "all"
      ? { leagueId: league.id, refresh: true }
      : { leagueId: league.id, refresh: true, season: selectedSeason })
      .then((fresh) => queryClient.setQueryData(queryKey, fresh))
      .catch((error: unknown) => {
        signOutForPersonalData(error);
      });
  }, [league.id, queryClient, queryKey, selectedSeason, tradesQuery.data?.isStale]);

  useEffect(() => {
    setSelectedSeason(dashboard.season);
    setSelectedTradeId(null);
    refreshRequested.current = null;
  }, [dashboard.season, league.id]);

  useEffect(() => {
    if (selectedSeason === "all" || !tradesQuery.data?.seasons.length || tradesQuery.data.seasons.includes(selectedSeason)) return;
    setSelectedSeason(tradesQuery.data.seasons[0] ?? dashboard.season);
  }, [dashboard.season, selectedSeason, tradesQuery.data?.seasons]);

  const selectedTrade = tradesQuery.data?.trades.find((trade) => trade.id === selectedTradeId) ?? null;
  const selectedTeam = selectedTrade?.teams.find((team) => team.isUserTeam) ?? selectedTrade?.teams[0] ?? null;
  const perspective = selectedTrade && selectedTeam ? historicalPerspectiveAssets(selectedTrade, selectedTeam, formatAssets, dashboard.season) : null;
  const selectedSides: HistoricalTradeSide[] = selectedTrade?.teams.map((team) => {
    const received = historicalReceivedAssets(team, formatAssets, selectedTrade.id, dashboard.season);
    return { team, ...received, total: tradeTotal(received.valued) };
  }) ?? [];
  const rankedSelectedSides = [...selectedSides].sort((a, b) => b.total - a.total);
  const firstSelectedSide = rankedSelectedSides[0];
  const secondSelectedSide = rankedSelectedSides[1];
  const selectedComparisonSides: [HistoricalTradeSide, HistoricalTradeSide] | undefined = firstSelectedSide && secondSelectedSide
    ? [firstSelectedSide, secondSelectedSide]
    : undefined;
  const selectedWinners = firstSelectedSide ? selectedSides.filter((side) => side.total === firstSelectedSide.total) : [];
  const selectedWinner = selectedWinners.length === 1 ? selectedWinners[0] : undefined;
  const selectedWinMargin = selectedWinner && secondSelectedSide ? Math.max(0, selectedWinner.total - secondSelectedSide.total) : 0;
  const historicalPlayerIds = perspective
    ? [...perspective.give.valued, ...perspective.get.valued].filter((asset) => asset.position !== "PICK").map((asset) => asset.playerId).sort()
    : [];
  const historyQuery = useQuery({
    queryKey: ["fantasycalc-value-history", league.seasonLongFormat.key, historicalPlayerIds],
    queryFn: () => api.getValueHistory({ formatKey: league.seasonLongFormat.key, playerIds: historicalPlayerIds }),
    enabled: historicalPlayerIds.length > 0,
  });
  const historyByPlayerId = useMemo(() => new Map((historyQuery.data?.series ?? []).map((series) => [series.playerId, series])), [historyQuery.data]);
  // For historical trades, map each participant to their roster in the league.
  // If the user's team is involved, prefer ownerId matching; otherwise match by rosterId.
  // This enables roster-fit grading for trades between any two teams, not just the user's.
  const mine = selectedTeam
    ? (selectedTeam.isUserTeam
      ? league.tradeTeams.find((team) => selectedTeam.ownerId !== null && team.ownerId === selectedTeam.ownerId)
        ?? league.tradeTeams.find((team) => team.rosterId === selectedTeam.rosterId && team.isUser)
      : league.tradeTeams.find((team) => team.rosterId === selectedTeam.rosterId))
    : undefined;
  // For historical trades, "theirs" is the other participant's roster (not a synthetic combination).
  // For 2-team trades, find the other team's roster by rosterId.
  const historicalTheirs = selectedTrade && selectedTeam && !selectedTeam.isUserTeam && selectedTrade.teams.length === 2
    ? (() => {
        const otherTeam = selectedTrade.teams.find((team) => team.rosterId !== selectedTeam.rosterId);
        return otherTeam ? league.tradeTeams.find((team) => team.rosterId === otherTeam.rosterId) : undefined;
      })()
    : undefined;
  const incomingTeam = mine ? {
    rosterId: -1,
    ownerId: null,
    teamName: "Trade counterparties",
    isUser: false,
    players: league.tradeTeams.flatMap((team) => team.players),
    ownedPicks: league.tradeTeams.flatMap((team) => team.ownedPicks),
  } satisfies TradeTeam : undefined;
  // For historical non-user trades, use the actual participant rosters for grading
  const gradeMine = mine;
  const gradeTheirs = historicalTheirs ?? incomingTeam;
  const giveTotal = perspective ? tradeTotal(perspective.give.valued) : 0;
  const getTotal = perspective ? tradeTotal(perspective.get.valued) : 0;
  const comparisonLeftTotal = firstSelectedSide?.total ?? 0;
  const comparisonRightTotal = secondSelectedSide?.total ?? 0;
  const balancePercent = comparisonLeftTotal + comparisonRightTotal === 0 ? 50 : Math.max(8, Math.min(92, comparisonLeftTotal / (comparisonLeftTotal + comparisonRightTotal) * 100));
  const grouped = useMemo(() => {
    const groups = new Map<number, HistoricalTrade[]>();
    for (const trade of tradesQuery.data?.trades ?? []) groups.set(trade.season, [...(groups.get(trade.season) ?? []), trade]);
    return [...groups.entries()].sort(([a], [b]) => b - a);
  }, [tradesQuery.data?.trades]);
  const renderTradeRows = (trades: HistoricalTrade[]) => trades.map((trade) => {
    const teamValues = trade.teams.map((team) => ({ team, value: tradeTotal(historicalReceivedAssets(team, formatAssets, trade.id, dashboard.season).valued) }));
    const rankedTeams = [...teamValues].sort((a, b) => b.value - a.value);
    const leadingTeam = rankedTeams[0];
    const maxValue = leadingTeam?.value ?? 0;
    const winners = teamValues.filter((row) => row.value === maxValue);
    const runnerUp = rankedTeams[1]?.value ?? maxValue;
    return (
      <button
        type="button"
        className="trade-history-row"
        key={trade.id}
        onClick={() => setSelectedTradeId(trade.id)}
      >
        <span className="trade-history-row-heading"><span>Week {trade.week} · {trade.season}</span><strong><HistoricalTeamMatchup trade={trade} league={league} /></strong></span>
        <span className="trade-history-assets">{trade.teams.map((team) => <span key={team.rosterId}><b><HistoricalTeamName team={team} league={league} /></b>{compactHistoricalAssets(team)}</span>)}</span>
        <span className="trade-history-winner">{winners.length !== 1 || !leadingTeam ? "Even" : <><HistoricalTeamName team={leadingTeam.team} league={league} /> won · +{Math.max(0, maxValue - runnerUp).toLocaleString()}</>}</span>
      </button>
    );
  });

  if (tradesQuery.isPending) return <div className="trade-history-loading" aria-live="polite"><span className="loading-shimmer" /><span className="loading-shimmer" /><span className="loading-shimmer" /></div>;
  if (tradesQuery.isError) return <div className="section-error compact"><strong>Trade history is unavailable.</strong><button type="button" onClick={() => void tradesQuery.refetch()}>Try again</button></div>;
  return (
    <div className="trade-history-view">
      <label className="trade-history-filter">
        <span>Season</span>
        <select
          aria-label="Trade history season"
          value={selectedSeason}
          onChange={(event) => {
            const nextSeason = event.target.value === "all" ? "all" : Number(event.target.value);
            setSelectedSeason(nextSeason);
            setSelectedTradeId(null);
            refreshRequested.current = null;
          }}
        >
          {tradesQuery.data.seasons.map((season) => <option key={season} value={season}>{season}</option>)}
          <option value="all">All seasons</option>
        </select>
      </label>
      {tradesQuery.data.sourceErrors.length ? <p className="trade-history-source-note">{tradesQuery.data.sourceErrors.join(" ")}</p> : null}
      {!tradesQuery.data.trades.length ? (
        <div className="empty-inline empty-stack">
          <strong>{league.seasonLongFormat.isDynasty ? "No trades in league history" : "No trades yet this season"}</strong>
          <span>
            {league.seasonLongFormat.isDynasty
              ? "Past trades will appear here once they are made, with a winner call based on today's values."
              : "When a trade goes through, it will show up here with a winner call based on today's values."}
          </span>
        </div>
      ) : selectedSeason === "all" ? grouped.map(([season, trades]) => (
        <section className="trade-history-season" key={season} aria-labelledby={`trade-history-${league.id}-${season}`}>
          <h2 id={`trade-history-${league.id}-${season}`}>{season}</h2>
          <div className="trade-history-list">{renderTradeRows(trades)}</div>
        </section>
      )) : <div className="trade-history-list">{renderTradeRows(tradesQuery.data.trades)}</div>}
      {selectedTrade && selectedTeam && perspective ? (
        <TradeResultCard
          give={perspective.give.valued}
          get={perspective.get.valued}
          mine={gradeMine}
          theirs={gradeTheirs}
          league={league}
          valuationMode="league"
          giveMarketTotal={giveTotal}
          getMarketTotal={getTotal}
          balancePercent={balancePercent}
          balanceCopy={selectedWinner && secondSelectedSide ? <><HistoricalTeamName team={selectedWinner.team} league={league} /> won this trade by {selectedWinMargin.toLocaleString()} in today's market value.</> : "This deal is even at today's market values."}
          historyByPlayerId={historyByPlayerId}
          historyLoading={historyQuery.isPending}
          onClose={() => setSelectedTradeId(null)}
          contextLine={<>Week {selectedTrade.week}, {selectedTrade.season} · <HistoricalTeamMatchup trade={selectedTrade} league={league} /></>}
          historicalSides={selectedSides}
          historicalComparisonSides={selectedComparisonSides}
          rosterFitUnavailableNote={gradeMine && gradeTheirs ? undefined : `Roster-fit grading isn't available because the trade participants could not be matched to current rosters. Market values are still shown above.`}
          onOpenPlayer={onOpenPlayer}
        />
      ) : null}
    </div>
  );
}

function TradeCalculator({ dashboard, league, onOpenPlayer }: { dashboard: Dashboard; league: League; onOpenPlayer: (playerId: string) => void }) {
  const [tradeView, setTradeView] = useState<"analyze" | "history">("analyze");
  const [giveIds, setGiveIds] = useState<string[]>([]);
  const [getIds, setGetIds] = useState<string[]>([]);
  const [isResultOpen, setIsResultOpen] = useState(false);
  const [valuationMode, setValuationMode] = useState<ValuationMode>("league");
  const userTeam = league.tradeTeams.find((team) => team.isUser) ?? league.tradeTeams[0];
  const defaultOpponent = league.tradeTeams.find((team) => team.rosterId !== userTeam?.rosterId);
  const [theirRosterId, setTheirRosterId] = useState<number | null>(defaultOpponent?.rosterId ?? null);
  const assets = useMemo(() => dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key).sort((a, b) => a.overallRank - b.overallRank), [dashboard.seasonLongRankings, league.seasonLongFormat.key]);
  const teamPickAssets = useMemo(() => league.tradeTeams.flatMap((team) => team.ownedPicks), [league.tradeTeams]);
  const assetById = useMemo(() => new Map([...assets, ...teamPickAssets].map((asset) => [asset.playerId, asset])), [assets, teamPickAssets]);
  const give = giveIds.flatMap((id) => assetById.get(id) ?? []);
  const get = getIds.flatMap((id) => assetById.get(id) ?? []);
  const giveMarketTotal = tradeTotal(give);
  const getMarketTotal = tradeTotal(get);
  const difference = Math.abs(giveMarketTotal - getMarketTotal);
  const largerTotal = Math.max(giveMarketTotal, getMarketTotal);
  const balancePercent = largerTotal === 0 ? 50 : Math.max(8, Math.min(92, (giveMarketTotal / (giveMarketTotal + getMarketTotal || 1)) * 100));
  const selectedIds = new Set([...giveIds, ...getIds]);
  const selectedPlayerIds = [...selectedIds].filter((id) => assetById.get(id)?.position !== "PICK").sort();
  const historyQuery = useQuery({ queryKey: ["fantasycalc-value-history", league.seasonLongFormat.key, selectedPlayerIds], queryFn: () => api.getValueHistory({ formatKey: league.seasonLongFormat.key, playerIds: selectedPlayerIds }), enabled: selectedPlayerIds.length > 0 });
  const historyByPlayerId = useMemo(() => new Map((historyQuery.data?.series ?? []).map((series) => [series.playerId, series])), [historyQuery.data]);
  const hasPickValues = league.seasonLongFormat.isDynasty && assets.some((asset) => asset.position === "PICK");
  const mine = userTeam;
  const theirs = league.tradeTeams.find((team) => team.rosterId === theirRosterId && team.rosterId !== mine?.rosterId) ?? league.tradeTeams.find((team) => team.rosterId !== mine?.rosterId);
  const unrestrictedAssets = assets.filter((asset) => !selectedIds.has(asset.playerId));

  useEffect(() => {
    const nextMine = league.tradeTeams.find((team) => team.isUser) ?? league.tradeTeams[0];
    const nextThem = league.tradeTeams.find((team) => team.rosterId !== nextMine?.rosterId);
    setTheirRosterId(nextThem?.rosterId ?? null);
    setGiveIds([]);
    setGetIds([]);
    setIsResultOpen(false);
  }, [league.id, league.tradeTeams]);

  useEffect(() => {
    setGiveIds((ids) => ids.filter((id) => assetById.has(id)));
    setGetIds((ids) => ids.filter((id) => assetById.has(id)));
  }, [assetById]);

  const addAsset = (id: string, side: "give" | "get") => {
    if (selectedIds.has(id)) return;
    if (side === "give") setGiveIds((ids) => [...ids, id]);
    else setGetIds((ids) => [...ids, id]);
  };
  const balanceCopy = give.length === 0 || get.length === 0 ? "Add at least one asset to each side to compare the deal." : difference === 0 ? "The two sides have the same FantasyCalc market value." : `${giveMarketTotal < getMarketTotal ? "You give" : "You get"} is ${difference.toLocaleString()} market value lower.`;

  return (
    <section className="trade-view">
      <SegmentedControl
        value={tradeView}
        options={[{ value: "analyze", label: "Analyze" }, { value: "history", label: "History" }]}
        onChange={setTradeView}
        label="Trade view"
        className="trade-subnav"
      />
      {tradeView === "history" ? <TradeHistoryView dashboard={dashboard} league={league} onOpenPlayer={onOpenPlayer} /> : <>
      <div className="trade-format-line"><span>{league.seasonLongFormat.label}</span><span>{hasPickValues ? "Players + draft picks" : "Player values"}</span></div>
      <div className="trade-valuation-controls">
        <SegmentedControl value={valuationMode} options={[{ value: "league", label: "League-adjusted" }, { value: "market", label: "Market" }]} onChange={setValuationMode} label="Trade valuation mode" className="trade-valuation-toggle" />
      </div>

      {valuationMode === "league" ? (
        <div className="trade-team-controls">
          <label className="select-control"><span>Trade partner</span><span className="select-control-field"><select aria-label="Select opposing team" value={theirs?.rosterId ?? ""} onChange={(event) => { setTheirRosterId(Number(event.target.value)); setGetIds([]); }}>{league.tradeTeams.filter((team) => team.rosterId !== mine?.rosterId).map((team) => <option key={team.rosterId} value={team.rosterId}>{team.teamName}</option>)}</select><Chevron /></span></label>
        </div>
      ) : null}

      <div className={`trade-columns${valuationMode === "league" ? " league-adjusted" : ""}`}>
        {valuationMode === "league" && mine && theirs ? (
          <>
            <LeagueTradeSide title="You give" team={mine} assets={give} assetById={assetById} selectedIds={selectedIds} marketTotal={giveMarketTotal} onAdd={(id) => addAsset(id, "give")} onRemove={(id) => setGiveIds((ids) => ids.filter((item) => item !== id))} onClear={() => setGiveIds([])} onOpenPlayer={onOpenPlayer} />
            <LeagueTradeSide title="You get" team={theirs} assets={get} assetById={assetById} selectedIds={selectedIds} marketTotal={getMarketTotal} onAdd={(id) => addAsset(id, "get")} onRemove={(id) => setGetIds((ids) => ids.filter((item) => item !== id))} onClear={() => setGetIds([])} onOpenPlayer={onOpenPlayer} />
          </>
        ) : (
          <>
            <TradeSide title="You give" assets={give} availableAssets={unrestrictedAssets} marketTotal={giveMarketTotal} onAdd={(id) => addAsset(id, "give")} onRemove={(id) => setGiveIds((ids) => ids.filter((item) => item !== id))} onClear={() => setGiveIds([])} onOpenPlayer={onOpenPlayer} />
            <TradeSide title="You get" assets={get} availableAssets={unrestrictedAssets} marketTotal={getMarketTotal} onAdd={(id) => addAsset(id, "get")} onRemove={(id) => setGetIds((ids) => ids.filter((item) => item !== id))} onClear={() => setGetIds([])} onOpenPlayer={onOpenPlayer} />
          </>
        )}
      </div>
      {assets.length === 0 ? <div className="empty-inline empty-stack"><strong>No trade values for this format.</strong><span>Choose another league to compare assets.</span></div> : null}
      <div className="trade-calculate-wrap">
        <button type="button" className="trade-calculate-button" disabled={give.length === 0 || get.length === 0} onClick={() => setIsResultOpen(true)}>Calculate trade</button>
        {give.length === 0 || get.length === 0 ? <span>Choose at least one asset on each side</span> : <span>Compare market value{valuationMode === "league" ? " and roster impact" : ""}</span>}
      </div>
      {isResultOpen && give.length > 0 && get.length > 0 ? (
        <TradeResultCard
          give={give}
          get={get}
          mine={mine}
          theirs={theirs}
          league={league}
          valuationMode={valuationMode}
          giveMarketTotal={giveMarketTotal}
          getMarketTotal={getMarketTotal}
          balancePercent={balancePercent}
          balanceCopy={balanceCopy}
          historyByPlayerId={historyByPlayerId}
          historyLoading={historyQuery.isPending}
          onClose={() => setIsResultOpen(false)}
        />
      ) : null}
      </>}
    </section>
  );
}

type TickerItem = {
  key: string;
  source: string;
  label: string;
  quote: string | null;
  move: number | null;
  tone: "up" | "down" | "neutral";
  playerId?: string;
  href?: string;
  newsItem?: PlayerNewsItem;
};

const TICKER_LABEL_LIMIT = 58;

function clipTickerText(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const available = Math.max(1, limit - 1);
  const candidate = clean.slice(0, available);
  const lastSpace = candidate.lastIndexOf(" ");
  const clipped = lastSpace >= Math.floor(available * 0.62) ? candidate.slice(0, lastSpace) : candidate;
  return `${clipped.trimEnd()}…`;
}

function tickerFragment(value: string): string {
  return value
    .replace(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi, (day) => day.slice(0, 3))
    .replace(/\bversus\b/gi, "vs")
    .replace(/\bagainst\b/gi, "vs")
    .replace(/\bquestionable\b/gi, "Q")
    .replace(/\bdoubtful\b/gi, "D")
    .replace(/\bwill not play\b/gi, "OUT")
    .replace(/\bhas been ruled out\b/gi, "OUT")
    .replace(/\bruled out\b/gi, "OUT")
    .replace(/\btouchdowns\b/gi, "TDs")
    .replace(/\btouchdown\b/gi, "TD")
    .replace(/\byards\b/gi, "yds")
    .replace(/\breceptions\b/gi, "rec")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[.!?]+$/g, "")
    .trim();
}

function tickerLabel(subject: string, detail: string): string {
  const compactSubject = clipTickerText(subject.replace(/[.!?]+$/g, "").trim().toUpperCase(), 34);
  const prefix = `${compactSubject}:`;
  const room = Math.max(1, TICKER_LABEL_LIMIT - prefix.length - 1);
  return `${prefix} ${clipTickerText(tickerFragment(detail), room)}`;
}

function tickerNewsLabel(item: PlayerNewsItem): string {
  const isLeagueHeadline = item.playerId === "league" || /^league headline$/i.test(item.player);
  const subject = isLeagueHeadline ? (item.team && item.team !== "NFL" ? item.team : "NFL") : item.player;
  const escapedNames = [item.player, item.player.split(/\s+/).at(-1), item.team]
    .filter((value): value is string => Boolean(value) && !/^league headline$|^nfl$/i.test(value ?? ""))
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const subjectPattern = escapedNames.length > 0 ? new RegExp(`^(?:${escapedNames.join("|")})\\s*(?::|[-–—])?\\s*`, "i") : null;
  const detail = subjectPattern ? item.change.replace(subjectPattern, "") : item.change;
  return tickerLabel(subject, detail.replace(/^(?:is|are|has|have)\s+/i, ""));
}

function compactTickerCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value).toUpperCase();
}

function TickerStrip({ data, news, onPlayer, onNews }: {
  data: DraftCenterData | undefined;
  news: PlayerNews | undefined;
  onPlayer: (playerId: string) => void;
  onNews: (item: PlayerNewsItem) => void;
}) {
  const items = useMemo<TickerItem[]>(() => {
    const trendItems: TickerItem[] = (data?.trending ?? []).slice(0, 4).map((trend) => ({
      key: `trend:${trend.playerId}`,
      source: "SLEEPER",
      label: tickerLabel(trend.name, `+${compactTickerCount(trend.count)} adds${trend.position ? ` · ${trend.position}` : ""}`),
      quote: null,
      move: null,
      tone: "up",
      playerId: trend.playerId,
    }));
    const trendDropItems: TickerItem[] = (data?.trendingDrops ?? []).slice(0, 4).map((trend) => ({
      key: `trend-drop:${trend.playerId}`,
      source: "SLEEPER",
      label: tickerLabel(trend.name, `−${compactTickerCount(trend.count)} drops${trend.position ? ` · ${trend.position}` : ""}`),
      quote: null,
      move: null,
      tone: "down",
      playerId: trend.playerId,
    }));

    const seenHeadlines = new Set<string>();
    const headlineItems: TickerItem[] = (news?.runs ?? []).flatMap((run) => run.items).flatMap((item) => {
      // The top strip is league-wide: roster-scoped entries remain available in player detail views.
      if (item.newsType === "roster" || seenHeadlines.has(item.change)) return [];
      seenHeadlines.add(item.change);
      return [{
        key: `news:${item.id}`,
        source: item.newsType === "headline" && item.playerId === "league" ? "BREAKING" : "NEWS",
        label: tickerNewsLabel(item),
        quote: null,
        move: null,
        tone: "neutral" as const,
        newsItem: item,
      }];
    }).slice(0, 5);

    if (trendItems.length > 0 || trendDropItems.length > 0) return [...trendItems, ...trendDropItems, ...headlineItems];

    const adpFallback: TickerItem[] = (data?.adp ?? [])
      .filter((row) => row.pool === "all" && row.mflAdp !== null)
      .map((row) => ({ row, edge: (row.mflAdp ?? row.adp) - row.adp }))
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
      .slice(0, 7)
      .map(({ row, edge }) => ({
        key: `adp:${row.format}:${row.playerId ?? row.name}`,
        source: "ADP",
        label: tickerLabel(row.name, `ADP ${row.adp.toFixed(1)} · ${edge >= 0 ? "+" : ""}${edge.toFixed(1)} vs MFL`),
        quote: null,
        move: edge,
        tone: Math.abs(edge) < 0.05 ? "neutral" : edge > 0 ? "up" : "down",
        ...(row.playerId ? { playerId: row.playerId } : {}),
      }));
    return [...adpFallback, ...headlineItems];
  }, [data, news]);

  const visibleItems = items.length > 0 ? items : [{ key: "waiting", source: "NFL", label: "Awaiting the next update", quote: null, move: null, tone: "neutral" as const }];
  const repeatedItems = visibleItems.length > 1 ? [...visibleItems, ...visibleItems] : visibleItems;
  const isStatic = visibleItems.length === 1;

  const content = (item: TickerItem) => (
    <>
      <span className={`ticker-source ${item.source === "BREAKING" ? "breaking" : ""}`}>{item.source}</span>
      <span className="ticker-label">{item.label}</span>
      {item.quote ? <strong>{item.quote}</strong> : null}
      {item.move !== null && Math.abs(item.move) >= 0.05 ? <span className={`ticker-move ${item.tone}`}>{item.move > 0 ? "▲" : "▼"}{Math.abs(item.move).toFixed(1)}</span> : null}
    </>
  );

  return (
    <section className="ticker-strip" aria-label="Live fantasy and NFL ticker">
      <div className="ticker-viewport">
        <div className={`ticker-track${isStatic ? " is-static" : ""}`}>
          {repeatedItems.map((item, index) => {
            const isCopy = index >= visibleItems.length;
            return item.newsItem ? (
              <button
                type="button"
                className={`ticker-item${isCopy ? " ticker-copy" : ""}`}
                key={`${item.key}:${index}`}
                onClick={() => item.newsItem ? onNews(item.newsItem) : undefined}
                aria-label={isCopy ? undefined : `${item.source}: ${item.label}`}
                aria-hidden={isCopy || undefined}
                tabIndex={isCopy ? -1 : undefined}
              >{content(item)}</button>
            ) : item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer" className={`ticker-item${isCopy ? " ticker-copy" : ""}`} key={`${item.key}:${index}`} aria-label={isCopy ? undefined : `${item.source}: ${item.label}`} aria-hidden={isCopy || undefined} tabIndex={isCopy ? -1 : undefined}>{content(item)}</a>
            ) : (
              <button
                type="button"
                className={`ticker-item${isCopy ? " ticker-copy" : ""}`}
                key={`${item.key}:${index}`}
                onClick={() => item.playerId ? onPlayer(item.playerId) : undefined}
                aria-label={isCopy ? undefined : `${item.source}: ${item.label}`}
                aria-hidden={isCopy || undefined}
                tabIndex={isCopy ? -1 : undefined}
              >{content(item)}</button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

type DraftRow = DraftCenterData["adp"][number] & {
  adpSource: "ffc" | "fantasycalc" | "projection";
  marketValue: number | null;
  marketRank: number | null;
  rookie: boolean;
  tier: number;
  gap: number | null;
  injuryStatus: string | null;
  weeklyRank: number | null;
  weeklyProjection: number | null;
  opponent: string | null;
  isAway: boolean | null;
  isBye: boolean;
  projectionSource: PlayerSearchResult["projectionSource"];
  gamePhase?: PlayerSearchResult["gamePhase"];
  defenseComponents?: PlayerSearchResult["defenseComponents"];
  projectionComponents?: PlayerSearchResult["projectionComponents"];
};

type DraftPlayerOpenSource = Pick<DraftRow, "playerId" | "name" | "team" | "position"> & Partial<Omit<DraftRow, "playerId" | "name" | "team" | "position">>;

function dedupePlayerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function readDraftPlayerIds(storageKey: string): string[] {
  try { return dedupePlayerIds(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); }
  catch { return []; }
}

function unfilledDraftStarterSlots(players: Array<{ position: string }>, configuredSlots: string[]): string[] {
  const slots = configuredSlots.filter((slot) => !["BN", "IR", "TAXI"].includes(slot));
  const assignedPlayerBySlot: Array<number | undefined> = Array.from({ length: slots.length });

  const assignPlayer = (playerIndex: number, visitedSlots: Set<number>): boolean => {
    const player = players[playerIndex];
    if (!player) return false;
    const eligibleSlotIndexes = slots
      .map((slot, slotIndex) => ({ slot, slotIndex }))
      .filter(({ slot, slotIndex }) => !visitedSlots.has(slotIndex) && eligibleForSlot(player.position, slot))
      .sort((a, b) => Number(b.slot === player.position) - Number(a.slot === player.position));

    for (const { slotIndex } of eligibleSlotIndexes) {
      visitedSlots.add(slotIndex);
      const assignedPlayer = assignedPlayerBySlot[slotIndex];
      if (assignedPlayer === undefined || assignPlayer(assignedPlayer, visitedSlots)) {
        assignedPlayerBySlot[slotIndex] = playerIndex;
        return true;
      }
    }
    return false;
  };

  players.forEach((_, playerIndex) => assignPlayer(playerIndex, new Set<number>()));
  return slots.filter((_, slotIndex) => assignedPlayerBySlot[slotIndex] === undefined);
}

function summarizeDraftNeeds(slots: string[]): string[] {
  const labels = slots.map((slot) => slot === "DEF" ? "DST" : slot.replaceAll("_", " "));
  const counts = new Map<string, number>();
  labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return [...counts].map(([label, count]) => count > 1 ? `${label} ×${count}` : label);
}

function DraftCenter({ dashboard, league, data, news, newsLoading, newsError, onRetryNews, loading, onRefresh, refreshing, onOpenMatchup }: { dashboard: Dashboard; league: League; data: DraftCenterData | undefined; news: PlayerNews | undefined; newsLoading: boolean; newsError: boolean; onRetryNews: () => void; loading: boolean; onRefresh: () => void; refreshing: boolean; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const leagueDrafts = useMemo(() => data?.drafts.filter((draft) => draft.leagueId === league.id) ?? [], [data?.drafts, league.id]);
  const liveDraft = leagueDrafts.find((draft) => draft.status === "drafting") ?? null;
  const completedDraft = leagueDrafts.find((draft) => draft.status === "complete") ?? null;
  const syncedDraft = liveDraft ?? completedDraft;
  const matchingDraft = liveDraft ?? leagueDrafts.find((draft) => draft.status === "pre_draft") ?? completedDraft ?? leagueDrafts[0] ?? null;
  const syncedBoardMode = data?.boardModes.find((item) => item.leagueId === league.id)?.mode;
  // Only a positively identified new dynasty gets the startup pool. If Sleeper
  // history is temporarily unavailable, defaulting a dynasty to rookies avoids
  // presenting veterans as eligible in an established league.
  const draftBoardMode = league.seasonLongFormat.isDynasty ? (syncedBoardMode === "startup" ? "startup" : "rookie") : "redraft";
  const isRookieBoard = draftBoardMode === "rookie";
  const [mode, setMode] = useState<"board" | "myTeam">("board");
  const playerHistory = usePlayerCardHistory();
  const [position, setPosition] = useState<"ALL" | "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "ROOKIES">("ALL");
  const [query, setQuery] = useState("");
  const [visibleDraftCount, setVisibleDraftCount] = useState(160);
  const [myTeamIds, setMyTeamIds] = useState<string[]>(() => readDraftPlayerIds(`fantasy-draft-my-team:${league.id}`));
  const [manualDraftedIds, setManualDraftedIds] = useState<string[]>(() => readDraftPlayerIds(`fantasy-draft-taken:${league.id}`));
  const [hiddenLiveTeamIds, setHiddenLiveTeamIds] = useState<string[]>(() => readDraftPlayerIds(`fantasy-draft-hidden-live:${league.id}`));
  const addToMyTeamLocked = useRef(false);
  const newsItemsByPlayer = useMemo(() => groupNewsItemsByPlayer(news), [news]);
  const selectedPlayerNews = playerHistory.current ? newsItemsByPlayer.get(playerHistory.current.playerId) ?? [] : [];
  const draftPositionOptions: Array<typeof position> = [
    "ALL",
    "QB",
    "RB",
    "WR",
    "TE",
    ...(league.rankingPositions.includes("K") ? ["K" as const] : []),
    ...(league.rankingPositions.includes("DEF") ? ["DEF" as const] : []),
    ...(league.seasonLongFormat.isDynasty ? ["ROOKIES" as const] : []),
  ];
  const effectiveDraftPosition = draftPositionOptions.includes(position) ? position : "ALL";

  useEffect(() => {
    setVisibleDraftCount(160);
  }, [effectiveDraftPosition, league.id, query]);

  useEffect(() => {
    setMyTeamIds(readDraftPlayerIds(`fantasy-draft-my-team:${league.id}`));
    setManualDraftedIds(readDraftPlayerIds(`fantasy-draft-taken:${league.id}`));
    setHiddenLiveTeamIds(readDraftPlayerIds(`fantasy-draft-hidden-live:${league.id}`));
  }, [league.id]);

  useEffect(() => { localStorage.setItem(`fantasy-draft-my-team:${league.id}`, JSON.stringify(myTeamIds)); }, [league.id, myTeamIds]);
  useEffect(() => { localStorage.setItem(`fantasy-draft-taken:${league.id}`, JSON.stringify(manualDraftedIds)); }, [league.id, manualDraftedIds]);
  useEffect(() => { localStorage.setItem(`fantasy-draft-hidden-live:${league.id}`, JSON.stringify(hiddenLiveTeamIds)); }, [league.id, hiddenLiveTeamIds]);

  const seasonRows = useMemo(
    () => dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key && row.position !== "PICK"),
    [dashboard.seasonLongRankings, league.seasonLongFormat.key],
  );
  const boardSeasonRows = useMemo(
    () => isRookieBoard ? seasonRows.filter((row) => row.isRookie) : seasonRows,
    [isRookieBoard, seasonRows],
  );
  const seasonByPlayer = useMemo(() => new Map(seasonRows.map((row) => [row.playerId, row])), [seasonRows]);
  const injuryByPlayer = useMemo(() => new Map(dashboard.rankings.map((row) => [row.playerId, row.injuryStatus])), [dashboard.rankings]);
  const injuryByName = useMemo(() => new Map(dashboard.rankings.map((row) => [comparablePlayerName(row.name), row.injuryStatus])), [dashboard.rankings]);
  const sortedByValue = useMemo(() => [...boardSeasonRows].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)), [boardSeasonRows]);
  const valueRank = useMemo(() => new Map(sortedByValue.map((row, index) => [row.playerId, index + 1])), [sortedByValue]);
  const rows = useMemo<DraftRow[]>(() => {
    const seenAdpPlayerIds = new Set<string>();
    const seenUnmatchedAdpNames = new Set<string>();
  const uniqueAdpRows = (data?.adp ?? []).filter((row) => {
    if (row.format !== league.seasonLongFormat.key || row.pool !== (isRookieBoard ? "rookie" : "all") || !["QB", "RB", "WR", "TE"].includes(row.position)) return false;
    const season = row.playerId ? seasonByPlayer.get(row.playerId) : undefined;
    if (isRookieBoard && !season?.isRookie) return false;
    if (!row.playerId) {
      if (isRookieBoard) return false;
      const normalizedName = comparablePlayerName(row.name);
      if (seenUnmatchedAdpNames.has(normalizedName)) return false;
      seenUnmatchedAdpNames.add(normalizedName);
      return true;
    }
    if (seenAdpPlayerIds.has(row.playerId)) return false;
    seenAdpPlayerIds.add(row.playerId);
    return true;
  }).sort((a, b) => a.adp - b.adp);
  const positionCounts = new Map<string, number>();
  const adpRows: DraftRow[] = uniqueAdpRows.map((row) => {
    const season = row.playerId ? seasonByPlayer.get(row.playerId) : undefined;
    const count = (positionCounts.get(row.position) ?? 0) + 1;
    positionCounts.set(row.position, count);
    const marketRank = row.playerId ? valueRank.get(row.playerId) ?? null : null;
    const injuryStatus = (row.playerId ? injuryByPlayer.get(row.playerId) : undefined) ?? injuryByName.get(comparablePlayerName(row.name)) ?? null;
    return {
      ...row,
      adpSource: "ffc",
      marketValue: season?.value ?? null,
      marketRank,
      rookie: season?.isRookie ?? false,
      tier: Math.ceil(count / 10),
      gap: marketRank === null ? null : row.adp - marketRank,
      injuryStatus,
      weeklyRank: null,
      weeklyProjection: null,
      opponent: null,
      isAway: null,
      isBye: false,
      projectionSource: null,
      projectionComponents: null,
    };
  });
  // Rookie ADP drives established dynasty boards. If FFC omits a rookie,
  // append that player by descending FantasyCalc rookie value rather than
  // dropping them from the same rookie set used by the ROOKIES filter.
  const fantasyCalcFallbackRows: DraftRow[] = isRookieBoard
    ? sortedByValue.filter((row) => !seenAdpPlayerIds.has(row.playerId)).map((row) => {
      const count = (positionCounts.get(row.position) ?? 0) + 1;
      positionCounts.set(row.position, count);
      const marketRank = valueRank.get(row.playerId) ?? null;
      return {
        format: league.seasonLongFormat.key,
        pool: "rookie",
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        adp: marketRank ?? Number.MAX_SAFE_INTEGER,
        high: null,
        low: null,
        timesDrafted: null,
        mflAdp: null,
        adpSource: "fantasycalc",
        marketValue: row.value,
        marketRank,
        rookie: true,
        tier: Math.ceil(count / 10),
        gap: null,
        injuryStatus: injuryByPlayer.get(row.playerId) ?? injuryByName.get(comparablePlayerName(row.name)) ?? null,
        weeklyRank: null,
        weeklyProjection: null,
        opponent: null,
        isAway: null,
        isBye: false,
        projectionSource: null,
        projectionComponents: null,
      };
    })
    : [];
  const kickerRows: DraftRow[] = !isRookieBoard && league.rankingPositions.includes("K")
    ? dashboard.rankings
      .filter((row) => row.leagueId === league.id && row.position === "K")
      .sort((a, b) => a.leagueRank - b.leagueRank)
      .map((row) => ({
        format: league.seasonLongFormat.key,
        pool: "all" as const,
        playerId: row.playerId,
        name: row.name,
        team: row.team || null,
        position: "K",
        adp: Number.MAX_SAFE_INTEGER,
        high: null,
        low: null,
        timesDrafted: null,
        mflAdp: null,
        adpSource: "projection" as const,
        marketValue: null,
        marketRank: null,
        rookie: false,
        tier: Math.ceil(row.leagueRank / 10),
        gap: null,
        injuryStatus: row.injuryStatus,
        weeklyRank: row.leagueRank,
        weeklyProjection: row.leagueProjection,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: row.isBye,
        projectionSource: row.projectionSource,
        projectionComponents: row.projectionComponents,
      }))
    : [];
  const defenseRows: DraftRow[] = !isRookieBoard && league.rankingPositions.includes("DEF")
    ? dashboard.defenses
      .filter((row) => row.leagueId === league.id)
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.team.localeCompare(b.team))
      .map((row) => ({
        format: league.seasonLongFormat.key,
        pool: "all" as const,
        playerId: row.team,
        name: `${row.team} Defense`,
        team: row.team,
        position: "DEF",
        adp: Number.MAX_SAFE_INTEGER,
        high: null,
        low: null,
        timesDrafted: null,
        mflAdp: null,
        adpSource: "projection" as const,
        marketValue: null,
        marketRank: null,
        rookie: false,
        tier: Math.ceil((row.rank ?? 1) / 10),
        gap: null,
        injuryStatus: null,
        weeklyRank: row.rank,
        weeklyProjection: row.displayProjection,
        opponent: row.opponent,
        isAway: row.isAway,
        isBye: false,
        projectionSource: row.projectionSource,
        gamePhase: row.gamePhase,
        defenseComponents: row.components ?? undefined,
        projectionComponents: null,
      }))
    : [];
    return [...adpRows, ...fantasyCalcFallbackRows, ...kickerRows, ...defenseRows];
  }, [boardSeasonRows, dashboard.defenses, dashboard.rankings, data?.adp, injuryByName, injuryByPlayer, isRookieBoard, league.id, league.rankingPositions, league.seasonLongFormat.key, sortedByValue, valueRank]);
  const syncedLeagueDrafts = useMemo(
    () => leagueDrafts.filter((draft) => draft.status === "drafting" || draft.status === "complete"),
    [leagueDrafts],
  );
  const sleeperDraftedIds = useMemo(
    () => new Set(syncedLeagueDrafts.flatMap((draft) => draft.picks.map((pick) => pick.playerId))),
    [syncedLeagueDrafts],
  );
  // Manual board decisions remain additive to Sleeper's read-only draft history.
  // A Restore only removes the manual mark; it can never restore a Sleeper pick.
  const draftedIds = useMemo(() => new Set([...sleeperDraftedIds, ...manualDraftedIds]), [manualDraftedIds, sleeperDraftedIds]);
  const myTeamIdSet = useMemo(() => new Set(myTeamIds), [myTeamIds]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return rows
      .filter((row) => !draftedIds.has(row.playerId ?? "") && !myTeamIdSet.has(row.playerId ?? ""))
      .filter((row) => (effectiveDraftPosition === "ALL" || (effectiveDraftPosition === "ROOKIES" ? row.rookie : row.position === effectiveDraftPosition)) && row.name.toLowerCase().includes(normalizedQuery));
  }, [draftedIds, effectiveDraftPosition, myTeamIdSet, query, rows]);
  const draftPositionIsEligible = (value: string) => value !== "K" && value !== "DEF" || league.rankingPositions.includes(value as "K" | "DEF");
  const seenOwnPickIds = new Set<string>();
  const ownPicks = syncedLeagueDrafts.flatMap((draft) => draft.ownRosterId === null ? [] : draft.picks.filter((pick) => pick.rosterId === draft.ownRosterId)).filter((pick) => {
    if (!draftPositionIsEligible(pick.position) || seenOwnPickIds.has(pick.playerId)) return false;
    seenOwnPickIds.add(pick.playerId);
    return true;
  });
  const localMyTeamRows = rows.filter((row) => row.playerId && myTeamIdSet.has(row.playerId) && !sleeperDraftedIds.has(row.playerId));
  const myTeamPlayers = [
    ...ownPicks.filter((pick) => !hiddenLiveTeamIds.includes(pick.playerId)).map((pick) => ({ playerId: pick.playerId, name: pick.playerName, position: pick.position, team: pick.team, livePick: true })),
    ...localMyTeamRows.map((row) => ({ playerId: row.playerId ?? row.name, name: row.name, position: row.position, team: row.team, livePick: false })),
  ];
  const myTeamPlayerIds = new Set(myTeamPlayers.map((player) => player.playerId));
  const buildPositions = ["QB", "RB", "WR", "TE", ...(league.rankingPositions.includes("K") ? ["K"] : []), ...(league.rankingPositions.includes("DEF") ? ["DEF"] : [])];
  const buildCounts = buildPositions.map((pos) => ({ pos, count: myTeamPlayers.filter((player) => player.position === pos).length }));
  const buildNeeds = summarizeDraftNeeds(unfilledDraftStarterSlots(myTeamPlayers, league.tradeStarterSlots));
  const manualDraftedRows = rows.filter((row) => row.playerId && manualDraftedIds.includes(row.playerId) && !sleeperDraftedIds.has(row.playerId) && !myTeamPlayerIds.has(row.playerId));

  function addToMyTeam(playerId: string) {
    if (addToMyTeamLocked.current) return;
    addToMyTeamLocked.current = true;
    window.setTimeout(() => { addToMyTeamLocked.current = false; }, 350);
    setMyTeamIds((current) => dedupePlayerIds([...current, playerId]));
    setManualDraftedIds((current) => current.filter((id) => id !== playerId));
  }

  function markTaken(playerId: string) {
    setManualDraftedIds((current) => dedupePlayerIds([...current, playerId]));
    setMyTeamIds((current) => current.filter((id) => id !== playerId));
  }

  function removeFromMyTeam(playerId: string, livePick: boolean) {
    if (livePick) setHiddenLiveTeamIds((current) => dedupePlayerIds([...current, playerId]));
    else setMyTeamIds((current) => current.filter((id) => id !== playerId));
  }

  const rosterBuild = (
    <section className="roster-build" aria-label="Team build and needs">
      <div className="section-heading"><h2>Team build</h2><span>{buildNeeds.length > 0 ? `Needs ${buildNeeds.join(" · ")}` : "Core spots covered"}</span></div>
      <div className="draft-plain-row"><span>{buildCounts.map((item) => `${item.pos} ${item.count}`).join(" · ")}</span></div>
    </section>
  );

  const myTeamSection = (
    <section className="draft-my-team">
      <div className="section-heading"><h2>My Team</h2><span>{myTeamPlayers.length} players</span></div>
      {myTeamPlayers.length > 0 ? <div className="draft-my-team-list">{myTeamPlayers.map((player) => (
        <div key={player.playerId}><button type="button" className="draft-my-team-player-open" onClick={() => openDraftPlayer(player)} aria-label={`View ${player.name} details and news`}><strong>{player.name}</strong><small>{player.position}{player.team ? ` · ${player.team}` : ""}{player.livePick ? " · Sleeper pick" : ""}</small></button><button type="button" onClick={() => removeFromMyTeam(player.playerId, player.livePick)} aria-label={`Remove ${player.name} from My Team`}>Remove</button></div>
      ))}</div> : <div className="empty-inline compact">{syncedDraft ? "Your Sleeper picks will appear here automatically." : "Use + in the Mock column to add a player."}</div>}
      {rosterBuild}
      {manualDraftedRows.length > 0 ? <details className="drafted-elsewhere"><summary>Drafted elsewhere · {manualDraftedRows.length}</summary><div>{manualDraftedRows.map((player) => <button type="button" key={player.playerId ?? player.name} onClick={() => player.playerId && setManualDraftedIds((current) => current.filter((id) => id !== player.playerId))}><span><strong>{player.name}</strong><small>{player.position}{player.team ? ` · ${player.team}` : ""}</small></span><b>Restore</b></button>)}</div></details> : null}
    </section>
  );

  const draftFilters = (
    <div className="draft-controls">
      <label><span className="sr-only">Search draft players</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players" aria-label="Search draft players" /></label>
      <div className="position-pills" role="group" aria-label="Draft position filter">
        {draftPositionOptions.map((item) => <button type="button" className={effectiveDraftPosition === item ? "active" : ""} aria-pressed={effectiveDraftPosition === item} onClick={() => setPosition(item)} key={item}>{item === "DEF" ? "DST" : item}</button>)}
      </div>
    </div>
  );

  const draftBoard = loading ? <div className="empty-inline">Loading draft values…</div> : filteredRows.length > 0 ? (
    <div className="draft-board" role="list" aria-label="Draft player board">
      <div className="draft-row draft-table-head" aria-hidden="true"><span>Player</span><span>Pos</span><span>Tier</span><span>{isRookieBoard ? "ADP / rank" : "ADP"}</span><span>Val</span><span>{liveDraft ? "Add" : "Mock"}</span></div>
      {filteredRows.slice(0, visibleDraftCount).map((row) => {
        const isSpecialist = row.position === "K" || row.position === "DEF";
        return (
          <div className="draft-row" role="listitem" key={`${row.format}-${row.playerId ?? row.name}`}>
            <button type="button" className="draft-player-open" onClick={() => openDraftPlayer(row)} disabled={!row.playerId} aria-label={`View ${row.name} details and news`}>
              <span className="draft-player-name-line"><strong>{row.name}</strong></span>
              <small className="draft-player-meta"><MatchupTag team={row.team} opponent={row.opponent} isAway={row.isAway} isBye={row.isBye} position={row.position} entry={sosEntry} onClick={row.team && row.opponent && onOpenMatchup ? (event) => { event.stopPropagation(); onOpenMatchup({ team: row.team ?? "", opponent: row.opponent ?? "", isAway: row.isAway, gamePhase: row.gamePhase ?? null }); } : undefined} />{row.mflAdp === null ? null : <span>MFL {row.mflAdp.toFixed(1)}</span>}</small>
            </button>
            <span>{row.position === "DEF" ? "DST" : row.position}</span>
            <span><span className="sr-only">Tier </span><span aria-hidden="true">T</span>{row.tier}</span>
            <span>{isSpecialist ? <><span className="sr-only">Average draft position not listed</span><span aria-hidden="true">—</span></> : row.adpSource === "fantasycalc" ? <><span className="sr-only">FantasyCalc rank </span><span aria-hidden="true">FC </span>{row.marketRank ?? <><span className="sr-only">not listed</span><span aria-hidden="true">—</span></>}</> : <><span className="sr-only">Average draft position </span>{row.adp.toFixed(1)}</>}</span>
            <span><strong>{isSpecialist ? <><span className="sr-only">Weekly projection </span>{formatProjectionPoints(row.weeklyProjection, row.projectionSource)}</> : row.marketValue === null ? <><span className="sr-only">Market value not listed</span><span aria-hidden="true">—</span></> : <><span className="sr-only">Market value </span>{row.marketValue.toLocaleString()}</>}</strong></span>
            <span className="draft-row-actions"><button type="button" className="row-toggle-state" disabled={!row.playerId} onClick={() => row.playerId && addToMyTeam(row.playerId)} aria-label={`Add ${row.name} to My Team`}>+</button>{liveDraft ? null : <button type="button" className="draft-taken-link" disabled={!row.playerId} onClick={() => row.playerId && markTaken(row.playerId)} aria-label={`Mark ${row.name} drafted by another team`}>Taken</button>}</span>
          </div>
        );
      })}
      <div className="list-pagination-row draft-list-pagination">
        <span aria-live="polite">showing {Math.min(visibleDraftCount, filteredRows.length)} of {filteredRows.length}</span>
        {visibleDraftCount < filteredRows.length ? <button type="button" onClick={() => setVisibleDraftCount((count) => count + 160)}>Show more</button> : null}
      </div>
    </div>
  ) : <div className="empty-inline">No available players match these filters.</div>;

  function openDraftPlayer(player: DraftPlayerOpenSource) {
    if (!player.playerId) return;
    const row = rows.find((candidate) => candidate.playerId === player.playerId) ?? player;
    playerHistory.open({
      key: `draft:${player.playerId}`,
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      position: player.position,
      opponent: row.opponent ?? null,
      isAway: row.isAway ?? null,
      isBye: row.isBye ?? false,
      injuryStatus: row.injuryStatus ?? injuryByPlayer.get(player.playerId) ?? null,
      weeklyRank: row.weeklyRank ?? null,
      weeklyProjection: row.weeklyProjection ?? null,
      projectionSource: row.projectionSource ?? null,
      seasonRank: row.marketRank ?? null,
      seasonValue: row.marketValue ?? null,
      movement30Day: seasonByPlayer.get(player.playerId)?.trend30Day ?? null,
      isRostered: league.rosteredPlayerIds.includes(player.playerId),
      gamePhase: row.gamePhase,
      defenseComponents: row.defenseComponents,
      projectionComponents: row.projectionComponents,
    });
  }

  return (
    <section className="draft-center">
      <div className="draft-heading">
        <div><h2>Draft Room</h2><p>{league.seasonLongFormat.label} · {league.seasonLongFormat.numTeams} teams{league.seasonLongFormat.isDynasty ? ` · ${isRookieBoard ? "Rookie board" : "Startup board"}` : ""}</p></div>
        <button className="refresh-button" type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh draft data"><RefreshIcon spinning={refreshing} /></button>
      </div>
      <SegmentedControl
        value={mode}
        onChange={setMode}
        label="Draft room view"
        options={[
          { value: "board", label: liveDraft ? "Draft Board · Live" : "Draft Board" },
          { value: "myTeam", label: "My Team" },
        ]}
      />
      {mode === "board" ? (
        <div className="draft-board-view">
          <div className="live-draft-status"><span className={liveDraft ? "live-dot" : ""} />{league.seasonLongFormat.isDynasty ? `${isRookieBoard ? "Rookie board" : "Startup board"} · ` : ""}{liveDraft ? `Live Sleeper sync · ${liveDraft.picks.length} picks recorded` : syncedDraft?.status === "complete" ? `Completed Sleeper sync · ${sleeperDraftedIds.size} picks recorded` : matchingDraft?.startTime ? `Manual board · draft starts ${new Date(matchingDraft.startTime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Manual board · no Sleeper draft"}</div>
          {rosterBuild}
          {draftFilters}
          {draftBoard}
        </div>
      ) : myTeamSection}
      {playerHistory.current ? <PlayerDetailSheet player={playerHistory.current} week={dashboard.week} leagueId={league.id} formatKey={league.seasonLongFormat.key} mode="details" analytics={dashboard.analytics} sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id)} newsItems={selectedPlayerNews} newsLoading={newsLoading} newsError={newsError} onRetryNews={onRetryNews} onOpenMatchup={onOpenMatchup} onBack={playerHistory.back} canGoBack={playerHistory.canGoBack} onClose={playerHistory.close} /> : null}
    </section>
  );
}

const BROWSER_DASHBOARD_MAX_AGE_MS = 2 * 60 * 1000;
// Stay under the 60s Hobby function cap. The server build deadline is 55s.
const DASHBOARD_DEADLINE_MS = 58_000;
// While a section answers `data: null` (signed-in user's first dashboard is
// still building in the background), poll until the build lands.
const SECTION_BUILD_POLL_MS = 4_000;
function pollWhileSectionBuilding(query: { state: { data?: unknown } }): number | false {
  const data = query.state.data as { data?: unknown } | undefined;
  return data !== undefined && data.data == null ? SECTION_BUILD_POLL_MS : false;
}

function dashboardTimestamp(dashboard: Dashboard | undefined): number {
  if (!dashboard) return 0;
  const timestamp = new Date(dashboard.asOf).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function readBrowserDashboard(): Dashboard | undefined {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BROWSER_DASHBOARD_CACHE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || !("leagues" in parsed) || !Array.isArray(parsed.leagues) || !("asOf" in parsed) || typeof parsed.asOf !== "string") return undefined;
    if (!parsed.leagues.every((league) => league && typeof league === "object" && "tradeValuation" in league)) {
      localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
      return undefined;
    }
    const dashboard = parsed as Dashboard;
    const age = Date.now() - dashboardTimestamp(dashboard);
    if (age < 0 || age > BROWSER_DASHBOARD_MAX_AGE_MS) {
      localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
      return undefined;
    }
    return dashboard;
  } catch {
    return undefined;
  }
}

function saveBrowserDashboard(dashboard: Dashboard): void {
  try {
    localStorage.setItem(BROWSER_DASHBOARD_CACHE_KEY, JSON.stringify(dashboard));
  } catch {
    // A full storage bucket must never block rendering fresh data.
  }
}

function freshestDashboard(...candidates: Array<Dashboard | undefined>): Dashboard | undefined {
  return candidates.reduce<Dashboard | undefined>((freshest, candidate) => {
    if (!candidate) return freshest;
    return !freshest || dashboardTimestamp(candidate) > dashboardTimestamp(freshest) ? candidate : freshest;
  }, undefined);
}

function assembleStreamedDashboard(
  meta: MetaSection["data"],
  team: TeamSection["data"],
  players: PlayersSection["data"],
  power: LeagueSection["data"],
  analytics: AnalyticsSection["data"],
): Dashboard | undefined {
  if (!meta) return undefined;
  const teamByLeague = new Map((team?.leagues ?? []).map((league) => [league.id, league]));
  const powerByLeague = new Map((power?.leagues ?? []).map((league) => [league.id, league]));
  const leagues: Dashboard["leagues"] = meta.leagues.map((identity) => {
    const teamData = teamByLeague.get(identity.id);
    const powerData = powerByLeague.get(identity.id);
    return {
      ...identity,
      record: teamData?.record ?? { wins: 0, losses: 0, ties: 0 },
      teamActual: teamData?.teamActual ?? null,
      teamProjection: teamData?.teamProjection ?? null,
      starters: teamData?.starters ?? [],
      bench: teamData?.bench ?? [],
      opponentTeam: teamData?.opponentTeam ?? null,
      suggestion: teamData?.suggestion ?? null,
      tradeTeams: teamData?.tradeTeams ?? [],
      tradeWaiverPool: teamData?.tradeWaiverPool ?? [],
      tradeStarterSlots: teamData?.tradeStarterSlots ?? [],
      powerRankingsWeek: powerData?.powerRankingsWeek ?? [],
      powerRankingsSeasonLong: powerData?.powerRankingsSeasonLong ?? [],
      powerRankingsDynasty: powerData?.powerRankingsDynasty ?? [],
    };
  });
  return {
    ...meta,
    leagues,
    rankings: players?.rankings ?? [],
    weeklyChartRankings: players?.weeklyChartRankings ?? [],
    seasonLongRankings: players?.seasonLongRankings ?? [],
    defenses: players?.defenses ?? [],
    strengthOfSchedule: players?.strengthOfSchedule ?? [],
    analytics: analytics?.analytics ?? { asOf: null, throughWeek: null, sourceUrl: "", entities: [], teamUsage: [], teamRecords: [] },
  };
}

async function withClientDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Section request timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function SectionLoading({ label }: { label: string }) {
  return (
    <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span>{label}</span>
      <div className="loading-section loading-shimmer" />
      <div className="loading-line wide loading-shimmer" />
      <div className="loading-line loading-shimmer" />
      <div className="loading-line loading-shimmer" />
    </section>
  );
}

function ProgressiveShell({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const primaryPage = primaryPageForTab(tab);
  const pageTabs: Array<[PrimaryPage, string, Tab]> = [
    ["team", "Matchup", "team"],
    ["players", "Players", "rankings"],
    ["league", "League", "power"],
    ["draft", "Draft", "draft"],
    ["tools", "Tools", "trade"],
  ];
  return (
    <div className="app-shell progressive-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="league-sticky progressive-sticky">
        <div className="week-line"><div><span className="live-dot" /> Loading latest saved week</div><button className="refresh-button" disabled aria-label="Fantasy data is loading"><RefreshIcon spinning /></button></div>
        <label className="league-picker"><span className="sr-only">League list is loading</span><select disabled><option>Loading leagues…</option></select><Chevron /></label>
      </div>
      <header className="control-deck">
        <nav className="primary-tabs" aria-label="Fantasy sections">
          {pageTabs.map(([page, label, nextTab]) => <button key={page} className={primaryPage === page ? "active" : ""} onClick={() => onTab(nextTab)} aria-current={primaryPage === page ? "page" : undefined}><NavigationIcon page={page} /><span>{label}</span></button>)}
        </nav>
      </header>
      <main><h1 className="sr-only">Fantasy {pageTabs.find(([page]) => page === primaryPage)?.[1] ?? "dashboard"}</h1><SectionLoading label={`Loading ${primaryPage}…`} /></main>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("team");
  const playerHistory = usePlayerCardHistory();
  const [tickerNews, setTickerNews] = useState<PlayerNewsItem | null>(null);
  const [selectedMatchup, setSelectedMatchup] = useState<MatchupSelection | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState(() => localStorage.getItem("fantasy-rankings-league") ?? "");
  const [browserDashboard] = useState<Dashboard | undefined>(readBrowserDashboard);
  const metaQuery = useQuery({
    queryKey: ["dashboard-section", "meta"],
    queryFn: () => withClientDeadline(api.getDashboardSection({ section: "meta" }), 8_000),
    staleTime: 90_000,
    retry: false,
    refetchInterval: pollWhileSectionBuilding,
  });
  const teamQuery = useQuery({
    queryKey: ["dashboard-section", "team"],
    queryFn: () => withClientDeadline(api.getDashboardSection({ section: "team" }), 8_000),
    staleTime: 90_000,
    retry: false,
    refetchInterval: pollWhileSectionBuilding,
  });
  const playerSectionActive = tab === "rankings" || tab === "waivers" || tab === "draft" || tab === "trade" || tab === "power" || tab === "charts" || tab === "comparison" || tab === "strengthOfSchedule";
  const playersQuery = useQuery({
    queryKey: ["dashboard-section", "players"],
    queryFn: () => withClientDeadline(api.getDashboardSection({ section: "players" }), 8_000),
    staleTime: 90_000,
    retry: false,
    enabled: playerSectionActive,
    refetchInterval: pollWhileSectionBuilding,
  });
  const leagueQuery = useQuery({
    queryKey: ["dashboard-section", "league"],
    queryFn: () => withClientDeadline(api.getDashboardSection({ section: "league" }), 8_000),
    staleTime: 90_000,
    retry: false,
    enabled: tab === "power",
    refetchInterval: pollWhileSectionBuilding,
  });
  const analyticsQuery = useQuery({
    queryKey: ["dashboard-section", "analytics"],
    queryFn: () => withClientDeadline(api.getDashboardSection({ section: "analytics" }), 8_000),
    staleTime: 90_000,
    retry: false,
    enabled: tab === "rankings" || tab === "waivers" || tab === "charts" || tab === "comparison",
    refetchInterval: pollWhileSectionBuilding,
  });
  const dashboardQuery = useQuery({
    queryKey: ["fantasy-dashboard"],
    queryFn: () => withClientDeadline(api.getDashboard({ force: false }), DASHBOARD_DEADLINE_MS),
    staleTime: 90_000,
    initialData: browserDashboard,
    initialDataUpdatedAt: 0,
    retry: false,
    enabled: false,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("Sign in required.");
      }
      return withClientDeadline(api.getDashboard({ force: true }), DASHBOARD_DEADLINE_MS);
    },
    onSuccess: (data) => {
      saveBrowserDashboard(data);
      queryClient.setQueryData(["fantasy-dashboard"], data);
      queryClient.invalidateQueries({ queryKey: ["dashboard-section"] });
    },
    onError: (error: unknown) => {
      signOutForPersonalData(error);
    },
  });
  const newsQuery = useQuery({
    queryKey: ["player-news"],
    queryFn: async () => {
      try {
        return await withClientDeadline(api.getPlayerNews({}), 8_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const draftQuery = useQuery({
    queryKey: ["draft-center"],
    queryFn: async () => {
      try {
        return await withClientDeadline(api.getDraftCenter({ force: false }), 24_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: 15_000,
    refetchInterval: tab === "draft" ? 15_000 : false,
    retry: false,
  });
  const draftRefresh = useMutation({
    mutationFn: async () => {
      try {
        return await withClientDeadline(api.getDraftCenter({ force: true }), 24_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    onSuccess: (data) => queryClient.setQueryData(["draft-center"], data),
  });
  const newsItemsByPlayer = useMemo(() => groupNewsItemsByPlayer(newsQuery.data), [newsQuery.data]);
  const tickerPlayerNews = playerHistory.current ? newsItemsByPlayer.get(playerHistory.current.playerId) ?? [] : [];

  const streamedDashboard = useMemo(() => assembleStreamedDashboard(
    metaQuery.data?.section === "meta" ? metaQuery.data.data : null,
    teamQuery.data?.section === "team" ? teamQuery.data.data : null,
    playersQuery.data?.section === "players" ? playersQuery.data.data : null,
    leagueQuery.data?.section === "league" ? leagueQuery.data.data : null,
    analyticsQuery.data?.section === "analytics" ? analyticsQuery.data.data : null,
  ), [analyticsQuery.data, leagueQuery.data, metaQuery.data, playersQuery.data, teamQuery.data]);
  // Every section is projected from the same saved dashboard snapshot; no
  // render-time source refresh or projection merge occurs.
  const dashboard = freshestDashboard(dashboardQuery.data, streamedDashboard, browserDashboard);

  const league = dashboard?.leagues.find((item) => item.id === selectedLeagueId) ?? dashboard?.leagues[0];
  const leagueDashboard = useMemo<Dashboard | undefined>(() => {
    if (!dashboard || !league) return dashboard;
    return {
      ...dashboard,
      rankings: dashboard.rankings.filter((row) => row.leagueId === league.id),
      weeklyChartRankings: dashboard.weeklyChartRankings.filter((row) => row.leagueId === league.id),
      defenses: dashboard.defenses.filter((row) => row.leagueId === league.id),
      strengthOfSchedule: dashboard.strengthOfSchedule.filter((row) => row.leagueId === league.id),
    };
  }, [dashboard, league]);

  useEffect(() => {
    if (!dashboard) return;
    saveBrowserDashboard(dashboard);
    if (document.documentElement.dataset.fantasyFirstContentMs) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const elapsed = Math.round(performance.now());
      document.documentElement.dataset.fantasyFirstContentMs = String(elapsed);
      performance.mark("fantasy-first-content");
    }));
  }, [dashboard]);

  useEffect(() => {
    if (league && league.id !== selectedLeagueId) setSelectedLeagueId(league.id);
  }, [league, selectedLeagueId]);

  function chooseLeague(id: string) {
    setSelectedLeagueId(id);
    localStorage.setItem("fantasy-rankings-league", id);
  }

  const primaryPage = primaryPageForTab(tab);
  function choosePrimaryPage(page: PrimaryPage) {
    const defaultTabs: Record<PrimaryPage, Tab> = {
      team: "team",
      players: "rankings",
      league: "power",
      draft: "draft",
      tools: "trade",
    };
    setTab(defaultTabs[page]);
  }

  function dashboardPlayerDetail(playerId: string): PlayerSearchResult | null {
    const currentDashboard = leagueDashboard ?? dashboard;
    if (!currentDashboard || !league) return null;
    const weekly = currentDashboard.rankings.find((row) => row.playerId === playerId);
    const season = currentDashboard.seasonLongRankings.find((row) => row.playerId === playerId && row.formatKey === league.seasonLongFormat.key);
    const rosterPlayer = league.tradeTeams.flatMap((team) => team.players).find((row) => row.playerId === playerId)
      ?? [...league.starters, ...league.bench, ...(league.opponentTeam?.starters ?? []), ...(league.opponentTeam?.bench ?? [])].find((row) => row.playerId === playerId);
    const defense = currentDashboard.defenses.find((row) => row.team === playerId);
    const name = weekly?.name ?? season?.name ?? rosterPlayer?.name ?? (defense ? `${defense.team} Defense` : null);
    const position = weekly?.position ?? season?.position ?? rosterPlayer?.position ?? (defense ? "DEF" : null);
    if (!name || !position) return null;
    return {
      key: `dashboard:${playerId}`,
      playerId,
      name,
      team: weekly?.team ?? season?.team ?? rosterPlayer?.team ?? defense?.team ?? null,
      position,
      opponent: weekly?.opponent ?? rosterPlayer?.opponent ?? defense?.opponent ?? null,
      isAway: weekly?.isAway ?? rosterPlayer?.isAway ?? defense?.isAway ?? null,
      isBye: weekly?.isBye ?? rosterPlayer?.isBye ?? false,
      injuryStatus: weekly?.injuryStatus ?? rosterPlayer?.injuryStatus ?? null,
      weeklyRank: weekly ? (weekly.leagueProjection === null ? null : league.rankingField === "ppr" ? weekly.pprRank : weekly.halfPprRank) : defense?.rank ?? rosterPlayer?.rank ?? null,
      weeklyProjection: weekly
        ? (league.rankingField === "ppr" ? weekly.ppr : weekly.halfPpr)
        : defense?.displayProjection ?? (rosterPlayer?.gamePhase === "final" ? rosterPlayer.actual : rosterPlayer?.projection) ?? null,
      projectionSource: weekly?.projectionSource ?? defense?.projectionSource ?? rosterPlayer?.projectionSource ?? null,
      seasonRank: season?.positionRank ?? null,
      seasonValue: season?.value ?? null,
      movement30Day: season ? movementPercent(season.value, season.trend30Day) : null,
      isRostered: league.rosteredPlayerIds.includes(playerId),
      gamePhase: defense?.gamePhase ?? rosterPlayer?.gamePhase,
      defenseComponents: defense?.components ?? rosterPlayer?.defenseComponents,
      projectionComponents: weekly?.projectionComponents ?? rosterPlayer?.projectionComponents ?? null,
    };
  }

  function prefetchDashboardPlayer(playerId: string) {
    const player = dashboardPlayerDetail(playerId);
    if (!player || !league) return;
    const boomBustPosition = isBoomBustPosition(player.position) ? player.position : null;
    if (boomBustPosition) {
      void queryClient.prefetchQuery({
        queryKey: ["boom-bust-history", league.id, player.playerId, "season"],
        queryFn: () => api.getBoomBustHistory({ leagueId: league.id, playerId: player.playerId, position: boomBustPosition, view: "season" }),
        staleTime: 30 * 60 * 1000,
      });
    }
    if (player.position !== "PICK" && player.seasonValue !== null) {
      void queryClient.prefetchQuery({
        queryKey: ["fantasycalc-value-history", league.seasonLongFormat.key, [player.playerId]],
        queryFn: () => api.getValueHistory({ formatKey: league.seasonLongFormat.key, playerIds: [player.playerId] }),
        staleTime: 30 * 60 * 1000,
      });
    }
  }

  function openDashboardPlayer(playerId: string): boolean {
    const player = dashboardPlayerDetail(playerId);
    if (!player) return false;
    playerHistory.open(player);
    return true;
  }

  function openTickerPlayer(playerId: string) {
    if (!openDashboardPlayer(playerId)) setTab("rankings");
  }

  const isRefreshing = tab === "draft" ? draftRefresh.isPending : refresh.isPending;
  const refreshCurrentView = () => {
    if (tab === "draft") draftRefresh.mutate();
    else {
      refresh.mutate();
      queryClient.invalidateQueries({ queryKey: ["player-news"] });
    }
  };

  const hasCompleteDashboard = Boolean(dashboardQuery.data || browserDashboard);
  const hasPlayerSectionData = hasCompleteDashboard || playersQuery.data?.section === "players";
  const playerSectionError = !hasPlayerSectionData && playersQuery.isError;
  const draftSectionError = draftQuery.isError && !draftQuery.data;
  const newsLoading = newsQuery.isPending && !newsQuery.data;
  const newsError = newsQuery.isError && !newsQuery.data;
  const retryNews = () => { void newsQuery.refetch(); };
  const currentSectionLoading = !hasCompleteDashboard && (
    (tab === "team" && teamQuery.isPending)
    || ((tab === "rankings" || tab === "waivers" || tab === "draft") && playersQuery.isPending)
    || (tab === "trade" && (playersQuery.isPending || teamQuery.isPending))
    || (tab === "power" && (leagueQuery.isPending || teamQuery.isPending || playersQuery.isPending))
    || ((tab === "charts" || tab === "comparison") && (analyticsQuery.isPending || playersQuery.isPending))
    || (tab === "strengthOfSchedule" && playersQuery.isPending)
  );

  // A signed-in user's first-ever dashboard builds in the background
  // (~30s) while sections answer `data: null`. Hold the loading shell and
  // let the section queries poll until it lands; only surface the error
  // state if nothing arrives after a generous wait.
  const waitingForFirstBuild =
    metaQuery.isSuccess
    && metaQuery.data?.section === "meta"
    && metaQuery.data.data == null;
  const [firstBuildTimedOut, setFirstBuildTimedOut] = useState(false);
  useEffect(() => {
    if (!waitingForFirstBuild || dashboard) {
      setFirstBuildTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setFirstBuildTimedOut(true), 150_000);
    return () => clearTimeout(timer);
  }, [waitingForFirstBuild, dashboard]);

  if (!dashboard && (metaQuery.isPending || teamQuery.isPending || (waitingForFirstBuild && !firstBuildTimedOut))) {
    return <ProgressiveShell tab={tab} onTab={setTab} />;
  }

  if (!dashboard || !league) {
    return (
      <main className="empty-state">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <div className="empty-mark">4TH</div>
        <h1>Data didn’t make it through.</h1>
        <p>Fantasy data didn’t load. Try again.</p>
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshIcon spinning={refresh.isPending} /> Try again</button>
      </main>
    );
  }

  const activeDashboard = leagueDashboard ?? dashboard;

  return (
    <div className={`app-shell${primaryPage === "team" ? " matchup-page" : ""}`}>
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="league-sticky">
          <TickerStrip data={draftQuery.data} news={newsQuery.data} onPlayer={openTickerPlayer} onNews={setTickerNews} />
          <div className="week-line">
            <div><span className="live-dot" /> NFL {dashboard.season} · WEEK {dashboard.week}</div>
            <button className="refresh-button" onClick={refreshCurrentView} disabled={isRefreshing} aria-label={tab === "draft" ? "Refresh draft data" : "Refresh scores and rankings"}><RefreshIcon spinning={isRefreshing} /></button>
          </div>
          <label className="league-picker">
            <span className="sr-only">Choose league</span>
            <select value={league.id} onChange={(event) => chooseLeague(event.target.value)}>
              {dashboard.leagues.map((item) => <option key={item.id} value={item.id}>{shortLeagueName(item.name)}</option>)}
            </select>
            <Chevron />
          </label>
      </div>
      <header className="control-deck">
        <nav className="primary-tabs" aria-label="Fantasy sections">
          {([
            ["team", "Matchup"],
            ["players", "Players"],
            ["league", "League"],
            ["draft", "Draft"],
            ["tools", "Tools"],
          ] as const).map(([page, label]) => (
            <button
              key={page}
              className={primaryPage === page ? "active" : ""}
              onClick={() => choosePrimaryPage(page)}
              aria-current={primaryPage === page ? "page" : undefined}
            >
              <NavigationIcon page={page} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {primaryPage === "players" ? (
          <nav className="subview-tabs" aria-label="Player views">
            <button className={tab === "rankings" ? "active" : ""} onClick={() => setTab("rankings")} aria-pressed={tab === "rankings"}>Rankings</button>
            <button className={tab === "waivers" ? "active" : ""} onClick={() => setTab("waivers")} aria-pressed={tab === "waivers"}>Waiver Wire</button>
          </nav>
        ) : null}
        {primaryPage === "tools" ? (
          <nav className="subview-tabs tools-subview-tabs" aria-label="Fantasy tools">
            <button className={tab === "trade" ? "active" : ""} onClick={() => setTab("trade")} aria-pressed={tab === "trade"}>Trade Values</button>
            <button className={tab === "charts" ? "active" : ""} onClick={() => setTab("charts")} aria-pressed={tab === "charts"}>Charts</button>
            <button className={tab === "comparison" ? "active" : ""} onClick={() => setTab("comparison")} aria-pressed={tab === "comparison"}>Comparison</button>
            <button className={tab === "strengthOfSchedule" ? "active" : ""} onClick={() => setTab("strengthOfSchedule")} aria-pressed={tab === "strengthOfSchedule"} aria-label="Strength of Schedule table">Tables</button>
          </nav>
        ) : null}
      </header>

      <main>
        <h1 className="sr-only">{({
          team: "Fantasy matchup",
          rankings: "Player rankings",
          waivers: "Waiver wire",
          power: "League power rankings",
          draft: "Draft room",
          trade: "Trade values",
          charts: "Fantasy charts",
          comparison: "Player comparison",
          strengthOfSchedule: "Strength of schedule",
        } satisfies Record<Tab, string>)[tab]}</h1>
        {currentSectionLoading ? <SectionLoading label={`Loading ${primaryPage}…`} />
          : (tab === "rankings" || tab === "waivers") && playerSectionError ? <SectionError title={tab === "rankings" ? "Rankings didn’t load." : "Waiver wire didn’t load."} onRetry={() => { void playersQuery.refetch(); }} retrying={playersQuery.isFetching} />
          : tab === "draft" && draftSectionError ? <SectionError title="Draft data didn’t load." onRetry={() => { void draftQuery.refetch(); }} retrying={draftQuery.isFetching} />
          : tab === "team" ? <Lineup league={league} dashboard={activeDashboard} news={newsQuery.data} newsLoading={newsLoading} newsError={newsError} onRetryNews={retryNews} onOpenMatchup={setSelectedMatchup} />
          : tab === "power" ? <Suspense fallback={<SectionLoading label="Loading power rankings…" />}><LazyPowerRankings league={league} dashboard={activeDashboard} onPlayerIntent={prefetchDashboardPlayer} onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }} playerCardOpen={playerHistory.isOpen} /></Suspense>
          : tab === "draft" ? <DraftCenter dashboard={activeDashboard} league={league} data={draftQuery.data} news={newsQuery.data} newsLoading={newsLoading} newsError={newsError} onRetryNews={retryNews} loading={draftQuery.isPending} onRefresh={() => draftRefresh.mutate()} refreshing={draftRefresh.isPending} onOpenMatchup={setSelectedMatchup} />
          : tab === "trade" ? <TradeCalculator dashboard={activeDashboard} league={league} onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }} />
          : tab === "charts" ? <Suspense fallback={<SectionLoading label="Loading charts…" />}><LazyChartsTool dashboard={activeDashboard} league={league} onOpenMatchup={setSelectedMatchup} /></Suspense>
          : tab === "comparison" ? <Suspense fallback={<SectionLoading label="Loading comparison…" />}><LazyComparisonTool dashboard={activeDashboard} league={league} initialPlayer={null} initialKey={0} onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }} onOpenMatchup={setSelectedMatchup} /></Suspense>
          : tab === "strengthOfSchedule" ? <Suspense fallback={<SectionLoading label="Loading tables…" />}><LazyTablesTool dashboard={activeDashboard} league={league} sosLoadFailed={playersQuery.isError} onRetrySos={() => { void playersQuery.refetch(); }} sosRetrying={playersQuery.isFetching} /></Suspense>
          : <PlayerPool dashboard={activeDashboard} league={league} availableOnly={tab === "waivers"} news={newsQuery.data} newsLoading={newsLoading} newsError={newsError} onRetryNews={retryNews} draftData={draftQuery.data} onOpenMatchup={setSelectedMatchup} />}
      </main>
      {playerHistory.current ? <PlayerDetailSheet player={playerHistory.current} week={dashboard.week} leagueId={league.id} formatKey={league.seasonLongFormat.key} mode="details" analytics={dashboard.analytics} sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id)} newsItems={tickerPlayerNews} newsLoading={newsLoading} newsError={newsError} onRetryNews={retryNews} onOpenMatchup={setSelectedMatchup} onBack={playerHistory.back} canGoBack={playerHistory.canGoBack} onClose={playerHistory.close} /> : null}
      {tickerNews ? <NewsCardModal item={tickerNews} onClose={() => setTickerNews(null)} /> : null}
      {selectedMatchup ? <MatchupDataModal matchup={selectedMatchup} season={dashboard.season} week={dashboard.week} onClose={() => setSelectedMatchup(null)} /> : null}
    </div>
  );
}
