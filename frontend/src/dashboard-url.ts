export const DASHBOARD_TABS = [
  "monitor",
  "team",
  "rankings",
  "waivers",
  "power",
  "draft",
  "trade",
  "charts",
  "comparison",
  "strengthOfSchedule",
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const RANKING_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "ALL", "FLEX", "SUPER", "ROOKIES"] as const;
export type RankingPosition = (typeof RANKING_POSITIONS)[number];

export const RANKING_HORIZONS = ["week", "ros", "dynasty"] as const;
export type RankingHorizon = (typeof RANKING_HORIZONS)[number];

export const DRAFT_POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF", "ROOKIES"] as const;
export type DraftPosition = (typeof DRAFT_POSITIONS)[number];

export const DRAFT_ROOMS = ["board", "myTeam"] as const;
export type DraftRoom = (typeof DRAFT_ROOMS)[number];

export const CHART_DATASETS = ["advanced", "projections"] as const;
export type ChartDataset = (typeof CHART_DATASETS)[number];

export type DashboardUrlState = {
  tab: DashboardTab;
  league: string | null;
  position: RankingPosition | null;
  horizon: RankingHorizon | null;
  query: string | null;
  draftPosition: DraftPosition | null;
  draftQuery: string | null;
  draftRoom: DraftRoom | null;
  chartDataset: ChartDataset | null;
  playerId: string | null;
};

export const DEFAULT_DASHBOARD_TAB: DashboardTab = "monitor";

export function emptyDashboardUrlState(): DashboardUrlState {
  return {
    tab: DEFAULT_DASHBOARD_TAB,
    league: null,
    position: null,
    horizon: null,
    query: null,
    draftPosition: null,
    draftQuery: null,
    draftRoom: null,
    chartDataset: null,
    playerId: null,
  };
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (!value) return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function textParam(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseDashboardSearch(search: string): DashboardUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    tab: oneOf(params.get("tab"), DASHBOARD_TABS) ?? DEFAULT_DASHBOARD_TAB,
    league: textParam(params.get("league")),
    position: oneOf(params.get("pos"), RANKING_POSITIONS),
    horizon: oneOf(params.get("horizon"), RANKING_HORIZONS),
    query: textParam(params.get("q")),
    draftPosition: oneOf(params.get("dpos"), DRAFT_POSITIONS),
    draftQuery: textParam(params.get("dq")),
    draftRoom: oneOf(params.get("room"), DRAFT_ROOMS),
    chartDataset: oneOf(params.get("chart"), CHART_DATASETS),
    playerId: textParam(params.get("player")),
  };
}

export function serializeDashboardSearch(state: DashboardUrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== DEFAULT_DASHBOARD_TAB) params.set("tab", state.tab);
  if (state.league) params.set("league", state.league);
  if (state.position) params.set("pos", state.position);
  if (state.horizon) params.set("horizon", state.horizon);
  if (state.query) params.set("q", state.query);
  if (state.draftPosition) params.set("dpos", state.draftPosition);
  if (state.draftQuery) params.set("dq", state.draftQuery);
  if (state.draftRoom) params.set("room", state.draftRoom);
  if (state.chartDataset) params.set("chart", state.chartDataset);
  if (state.playerId) params.set("player", state.playerId);
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function dashboardUrlHistoryMode(previous: DashboardUrlState, next: DashboardUrlState): "push" | "replace" | "none" {
  if (serializeDashboardSearch(previous) === serializeDashboardSearch(next)) return "none";
  if (previous.tab !== next.tab || previous.playerId !== next.playerId) return "push";
  return "replace";
}
