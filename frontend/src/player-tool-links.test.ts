import { describe, expect, it } from "vitest";
import { emptyDashboardUrlState, toolLinkSearch } from "./dashboard-url";
import { matchupToolLinks, playerToolLinks, teamTradeLinks } from "./player-tool-links";

const base = { playerId: "4046", position: "WR", team: "KC", seasonValue: 5200, isBye: false };

describe("playerToolLinks", () => {
  it("offers Pricing, Compare, Advanced stats, Team stats and Game lines for a rostered WR", () => {
    const links = playerToolLinks(base);
    expect(links.map((link) => link.key)).toEqual(["pricing", "comparison", "advanced-stats", "team-stats", "game-lines"]);
    expect(links[0]?.patch).toEqual({ tab: "pricing", pricingPlayerId: "4046" });
    expect(links[1]?.patch).toEqual({ tab: "comparison", comparePlayerId: "4046" });
    expect(links[2]?.patch).toEqual({ tab: "analytics", chartDataset: "advanced", analyticsPlayerId: "4046" });
    expect(links[3]?.patch).toEqual({ tab: "team-stats", teamStatsTeam: "KC", teamStatsGroup: "WR" });
    expect(links[4]?.patch).toEqual({ tab: "monitor", gameLinesTeam: "KC" });
  });

  it("maps positions onto Team stats groups and skips kickers and defenses", () => {
    expect(playerToolLinks({ ...base, position: "TE" })[3]?.patch.teamStatsGroup).toBe("TE");
    expect(playerToolLinks({ ...base, position: "QB" })[3]?.patch.teamStatsGroup).toBe("QB");
    expect(playerToolLinks({ ...base, position: "RB" })[3]?.patch.teamStatsGroup).toBe("RB");
    for (const position of ["K", "DEF"]) {
      const keys = playerToolLinks({ ...base, position }).map((link) => link.key);
      expect(keys).not.toContain("team-stats");
      expect(keys).not.toContain("advanced-stats");
    }
  });

  it("omits destinations that would have nothing to show", () => {
    expect(playerToolLinks({ ...base, seasonValue: null }).map((link) => link.key)).toEqual(["comparison", "advanced-stats", "team-stats", "game-lines"]);
    expect(playerToolLinks({ ...base, isBye: true }).map((link) => link.key)).toEqual(["pricing", "comparison", "advanced-stats", "team-stats"]);
    expect(playerToolLinks({ ...base, team: null }).map((link) => link.key)).toEqual(["pricing", "comparison", "advanced-stats"]);
    expect(playerToolLinks({ playerId: "pick-1", position: "PICK", team: null, seasonValue: 900, isBye: false })).toEqual([]);
  });
});

describe("toolLinkSearch", () => {
  it("opens a tool without the player sheet or another tool's selection", () => {
    const from = {
      ...emptyDashboardUrlState(),
      tab: "rankings" as const,
      league: "league-1",
      playerId: "4046",
      teamStatsTeam: "BUF",
    };
    expect(toolLinkSearch(from, { tab: "pricing", pricingPlayerId: "4046" }))
      .toBe("?tab=pricing&league=league-1&pp=4046");
    expect(toolLinkSearch(from, { tab: "monitor", gameLinesTeam: "KC" }))
      .toBe("?tab=monitor&league=league-1&gt=KC");
  });
});

describe("matchupToolLinks", () => {
  it("links a game to its lines and each side's team stats", () => {
    const links = matchupToolLinks({ team: "KC", opponent: "BUF" });
    expect(links.map((link) => link.id)).toEqual(["game-lines", "team-stats-KC", "team-stats-BUF"]);
    expect(links.map((link) => link.label)).toEqual(["Game lines", "KC stats", "BUF stats"]);
    expect(links[0]?.patch).toEqual({ tab: "monitor", gameLinesTeam: "KC" });
    expect(links[2]?.patch).toEqual({ tab: "team-stats", teamStatsTeam: "BUF" });
    expect(new Set(links.map((link) => link.id)).size).toBe(3);
  });
});

describe("teamTradeLinks", () => {
  it("offers a trade with another team but not with the user's own", () => {
    expect(teamTradeLinks({ rosterId: 7, teamName: "Gridiron Ghosts", isUser: false })).toEqual([
      { key: "trade", label: "Trade with Gridiron Ghosts", patch: { tab: "trade", tradeMode: null, tradePartner: "7" } },
    ]);
    expect(teamTradeLinks({ rosterId: 1, teamName: "Mine", isUser: true })).toEqual([]);
  });

  it("builds the trade URL from the patch", () => {
    const from = { ...emptyDashboardUrlState(), tab: "power" as const, league: "league-1", playerId: "9" };
    expect(toolLinkSearch(from, { tab: "trade", tradePartner: "7" })).toBe("?tab=trade&league=league-1&tp=7");
  });

  it("opens league-adjusted trade even after Market or History was chosen", () => {
    const from = { ...emptyDashboardUrlState(), tab: "power" as const, tradeMode: "market" as const };
    const [link] = teamTradeLinks({ rosterId: 7, teamName: "Gridiron Ghosts", isUser: false });
    expect(toolLinkSearch(from, link!.patch)).toBe("?tab=trade&tp=7");
  });
});
