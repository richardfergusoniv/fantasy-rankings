import type { DashboardUrlState } from "./dashboard-url";

export type PlayerToolLinkKey = "pricing" | "comparison" | "advanced-stats" | "team-stats" | "game-lines" | "trade";

export type PlayerToolLink = {
  key: PlayerToolLinkKey;
  label: string;
  /** Destination tab and selection; pass to `toolLinkSearch`. */
  patch: Partial<DashboardUrlState>;
};

/** Team stats opens on the player's own position group; kickers and defenses have none. */
const TEAM_STATS_GROUP_BY_POSITION: Readonly<Record<string, string>> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
};

/** Advanced stats (nflverse usage and efficiency) exist for these positions only. */
const ADVANCED_STATS_POSITIONS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE"]);

/** Comparison pairs players within one of these positions. */
const COMPARISON_POSITIONS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

type ToolLinkPlayer = {
  playerId: string;
  position: string;
  team: string | null;
  seasonValue: number | null;
  isBye: boolean;
};

/**
 * Tools a player can be opened in. A destination is listed only when it can show
 * something for this player: Pricing needs a market value, Compare a position it can pair within, Advanced stats a QB/RB/WR/TE, Team stats a team and
 * a QB/RB/WR/TE position, Game lines a team that plays this week.
 */
export function playerToolLinks(player: ToolLinkPlayer): PlayerToolLink[] {
  const links: PlayerToolLink[] = [];
  if (player.position !== "PICK" && player.seasonValue !== null) {
    links.push({ key: "pricing", label: "Pricing", patch: { tab: "pricing", pricingPlayerId: player.playerId } });
  }
  if (COMPARISON_POSITIONS.has(player.position)) {
    links.push({ key: "comparison", label: "Compare", patch: { tab: "comparison", comparePlayerId: player.playerId } });
  }
  if (ADVANCED_STATS_POSITIONS.has(player.position)) {
    links.push({
      key: "advanced-stats",
      label: "Advanced stats",
      patch: { tab: "analytics", chartDataset: "advanced", analyticsPlayerId: player.playerId },
    });
  }
  const group = TEAM_STATS_GROUP_BY_POSITION[player.position];
  if (player.team && group) {
    links.push({
      key: "team-stats",
      label: "Team stats",
      patch: { tab: "team-stats", teamStatsTeam: player.team, teamStatsGroup: group },
    });
  }
  if (player.team && !player.isBye) {
    links.push({ key: "game-lines", label: "Game lines", patch: { tab: "monitor", gameLinesTeam: player.team } });
  }
  return links;
}

/**
 * Tools a matchup (one NFL game) opens in: that game's lines, and each side's
 * team stats. Keys are unique per side so both teams can be listed.
 */
export function matchupToolLinks(matchup: { team: string; opponent: string }): (PlayerToolLink & { id: string })[] {
  return [
    { id: "game-lines", key: "game-lines", label: "Game lines", patch: { tab: "monitor", gameLinesTeam: matchup.team } },
    { id: `team-stats-${matchup.team}`, key: "team-stats", label: `${matchup.team} stats`, patch: { tab: "team-stats", teamStatsTeam: matchup.team } },
    { id: `team-stats-${matchup.opponent}`, key: "team-stats", label: `${matchup.opponent} stats`, patch: { tab: "team-stats", teamStatsTeam: matchup.opponent } },
  ];
}

/** Trade link from another fantasy team's card; always opens league-adjusted trade. The user's own team has none. */
export function teamTradeLinks(team: { rosterId: number; teamName: string; isUser: boolean }): PlayerToolLink[] {
  if (team.isUser) return [];
  return [{ key: "trade", label: `Trade with ${team.teamName}`, patch: { tab: "trade", tradeMode: null, tradePartner: String(team.rosterId) } }];
}
