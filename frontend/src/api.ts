/**
 * Typed fetch client for the Vercel API routes.
 *
 * Phase 1 stub — Phase 2 replaces this with one typed function per route,
 * generated from the zod request/response schemas (see ANALYSIS.md §8).
 *
 * The call-site shape is intentionally close to the old action client:
 *   api.getDashboard({ force: true }) → GET /api/dashboard?force=true
 */

import { getAccessToken } from "./supabase";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Attach the signed-in user's Supabase token (when available) so the API
  // can scope data per user (Phase 2). Harmless while routes ignore it.
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

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Route stubs — signatures mirror the Hatch actions; implementations hit
// the Vercel routes defined in /api. Filled in during Phase 2.
// ---------------------------------------------------------------------------

export const api = {
  getDashboard: (args: { force?: boolean } = {}): Promise<JsonValue> =>
    request(`/api/dashboard${qs({ force: args.force })}`),

  getDashboardSection: (args: {
    section: "meta" | "team" | "players" | "league" | "analytics";
  }): Promise<JsonValue> => request(`/api/dashboard/section${qs(args)}`),

  getDraftCenter: (args: { force?: boolean } = {}): Promise<JsonValue> =>
    request(`/api/draft-center${qs({ force: args.force })}`),

  getBoomBustRanges: (args: {
    leagueId: string;
    position: string;
    playerIds: string[];
  }): Promise<JsonValue> =>
    request(`/api/boom-bust/ranges${qs({
      leagueId: args.leagueId,
      position: args.position,
      playerIds: args.playerIds.join(","),
    })}`),

  getBoomBustHistory: (args: {
    leagueId: string;
    playerId: string;
    position: string;
    view: "season" | "last3";
  }): Promise<JsonValue> => request(`/api/boom-bust/history${qs(args)}`),

  getValueHistory: (args: {
    formatKey: string;
    playerIds: string[];
  }): Promise<JsonValue> =>
    request(`/api/value-history${qs({
      formatKey: args.formatKey,
      playerIds: args.playerIds.join(","),
    })}`),

  getHistoricalTrades: (args: {
    leagueId: string;
    refresh?: boolean;
    season?: number;
  }): Promise<JsonValue> => request(`/api/trades/history${qs(args)}`),

  listSavedChartViews: (): Promise<JsonValue[]> => request("/api/chart-views"),

  saveChartView: (args: JsonValue): Promise<JsonValue> =>
    request("/api/chart-views", { method: "POST", body: JSON.stringify(args) }),

  deleteChartView: (args: { id: string }): Promise<JsonValue> =>
    request(`/api/chart-views${qs(args)}`, { method: "DELETE" }),

  getPfnTables: (): Promise<JsonValue> => request("/api/pfn-tables"),

  getMatchupBoxScore: (args: {
    team: string;
    opponent: string;
    season: number;
    week: number;
  }): Promise<JsonValue> => request(`/api/box-score${qs(args)}`),

  getPlayerNews: (): Promise<JsonValue> => request("/api/player-news"),
};
