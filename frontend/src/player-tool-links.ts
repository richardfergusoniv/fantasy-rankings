import type { DashboardUrlState } from "./dashboard-url";

export type PlayerToolLinkKey = "comparison" | "advanced-stats" | "team-stats" | "game-lines" | "trade";

export type PlayerToolLink = {
  key: PlayerToolLinkKey;
  label: string;
  /** Destination tab and selection; pass to `toolLinkSearch`. */
  patch: Partial<DashboardUrlState>;
};

type ToolLinkPlayer = {
  playerId: string;
  position: string;
  team: string | null;
  isBye: boolean;
};

/**
 * Player-card Open-in destinations are retired; keep the helper for callers that
 * still type against it. Destinations remain available via their own tabs.
 */
export function playerToolLinks(_player: ToolLinkPlayer): PlayerToolLink[] {
  return [];
}

/** Matchup-card Open-in destinations are retired. */
export function matchupToolLinks(_matchup: { team: string; opponent: string }): (PlayerToolLink & { id: string })[] {
  return [];
}

/** Trade link from another fantasy team's card; always opens league-adjusted trade. The user's own team has none. */
export function teamTradeLinks(team: { rosterId: number; teamName: string; isUser: boolean }): PlayerToolLink[] {
  if (team.isUser) return [];
  return [{ key: "trade", label: `Trade with ${team.teamName}`, patch: { tab: "trade", tradeMode: null, tradePartner: String(team.rosterId) } }];
}
