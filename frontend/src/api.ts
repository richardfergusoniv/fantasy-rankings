/**
 * Typed fetch client for the Vercel API routes.
 *
 * Return types are the payloads the route handlers validate with zod.
 * `ApiResponse<typeof api, "getDashboard">` is that method's resolved value,
 * which is how the UI names dashboard, news, and chart data.
 *
 *   api.getDashboard({ force: true }) → GET /api/dashboard?force=true
 */

import type { BoomBustHistory, BoomBustRanges } from "../../api/boom-bust/[type]";
import type { MatchupBoxScore } from "../../api/box-score";
import type { SavedChartView, SavedChartViewInput } from "../../api/chart-views";
import type { Dashboard, DashboardSection } from "../../api/_lib/dashboard-schemas";
import type { DraftCenter } from "../../api/draft-center";
import type { PfnTables } from "../../api/pfn-tables";
import type { PlayerNews } from "../../api/player-news";
import type { HistoricalTrades } from "../../api/_lib/trades";
import type { ValueHistory } from "../../api/value-history";
import { getAccessToken } from "./supabase";

type ApiMethod<T> = T extends (...args: never[]) => Promise<infer R> ? R : never;

export type ApiResponse<TApi, K extends keyof TApi> = ApiMethod<TApi[K]>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Attach the signed-in user's Supabase token (when available) so the API
  // can scope data per user. Harmless while a route ignores it.
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(path, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// Call sites still pass `{}` for no-argument reads. The value is ignored.
type EmptyArgs = Record<string, never>;

export const api = {
  getDashboard: async (args: { force?: boolean } = {}): Promise<Dashboard> => {
    const body = await request<{ dashboard: Dashboard }>(`/api/dashboard${buildQuery({ force: args.force })}`);
    return body.dashboard;
  },

  getDashboardSection: (args: {
    section: DashboardSection["section"];
  }): Promise<DashboardSection> => request(`/api/dashboard/section${buildQuery(args)}`),

  getDraftCenter: (args: { force?: boolean } = {}): Promise<DraftCenter> =>
    request(`/api/draft-center${buildQuery({ force: args.force })}`),

  getBoomBustRanges: (args: {
    leagueId: string;
    position: string;
    playerIds: string[];
  }): Promise<BoomBustRanges> =>
    request(`/api/boom-bust/ranges${buildQuery({
      leagueId: args.leagueId,
      position: args.position,
      playerIds: args.playerIds.join(","),
    })}`),

  getBoomBustHistory: (args: {
    leagueId: string;
    playerId: string;
    position: string;
    view: "season" | "last3";
  }): Promise<BoomBustHistory> => request(`/api/boom-bust/history${buildQuery(args)}`),

  getValueHistory: (args: {
    formatKey: string;
    playerIds: string[];
  }): Promise<ValueHistory> =>
    request(`/api/value-history${buildQuery({
      formatKey: args.formatKey,
      playerIds: args.playerIds.join(","),
    })}`),

  getHistoricalTrades: (args: {
    leagueId: string;
    refresh?: boolean;
    season?: number;
  }): Promise<HistoricalTrades> => request(`/api/trades/history${buildQuery(args)}`),

  listSavedChartViews: (_args?: EmptyArgs): Promise<{ views: SavedChartView[] }> => request("/api/chart-views"),

  saveChartView: (args: SavedChartViewInput): Promise<{ view: SavedChartView }> =>
    request("/api/chart-views", { method: "POST", body: JSON.stringify(args) }),

  deleteChartView: (args: { id: string }): Promise<{ ok: true; deleted: boolean }> =>
    request(`/api/chart-views${buildQuery(args)}`, { method: "DELETE" }),

  getPfnTables: (_args?: EmptyArgs): Promise<PfnTables> => request("/api/pfn-tables"),

  getMatchupBoxScore: (args: {
    team: string;
    opponent: string;
    season: number;
    week: number;
  }): Promise<MatchupBoxScore> => request(`/api/box-score${buildQuery(args)}`),

  getPlayerNews: (_args?: EmptyArgs): Promise<PlayerNews> => request("/api/player-news"),
};
