import type { DashboardUrlState } from "./dashboard-url";

export type PlayerToolLinkKey = "pricing" | "team-stats" | "game-lines";

export type PlayerToolLink = {
  key: PlayerToolLinkKey;
  label: string;
  /** Destination tab and selection; pass to `toolLinkSearch`. */
  patch: Partial<DashboardUrlState>;
};

/** Team stats groups players as QB / RB / WR+TE; kickers and defenses have none. */
const TEAM_STATS_GROUP_BY_POSITION: Readonly<Record<string, string>> = {
  QB: "QB",
  RB: "RB",
  WR: "WRTE",
  TE: "WRTE",
};

type ToolLinkPlayer = {
  playerId: string;
  position: string;
  team: string | null;
  seasonValue: number | null;
  isBye: boolean;
};

/**
 * Tools a player can be opened in. A destination is listed only when it can show
 * something for this player: Pricing needs a market value, Team stats a team and
 * a QB/RB/WR/TE position, Game lines a team that plays this week.
 */
export function playerToolLinks(player: ToolLinkPlayer): PlayerToolLink[] {
  const links: PlayerToolLink[] = [];
  if (player.position !== "PICK" && player.seasonValue !== null) {
    links.push({ key: "pricing", label: "Pricing", patch: { tab: "pricing", pricingPlayerId: player.playerId } });
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
