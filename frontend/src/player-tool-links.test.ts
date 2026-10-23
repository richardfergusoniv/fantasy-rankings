import { describe, expect, it } from "vitest";
import { emptyDashboardUrlState, toolLinkSearch } from "./dashboard-url";
import { matchupToolLinks, playerToolLinks, teamTradeLinks } from "./player-tool-links";

const base = { playerId: "4046", position: "WR", team: "KC", isBye: false };

describe("playerToolLinks", () => {
  it("returns no player-card Open-in destinations", () => {
    expect(playerToolLinks(base)).toEqual([]);
    expect(playerToolLinks({ ...base, position: "TE" })).toEqual([]);
    expect(playerToolLinks({ ...base, isBye: true })).toEqual([]);
    expect(playerToolLinks({ ...base, team: null })).toEqual([]);
    expect(playerToolLinks({ playerId: "pick-1", position: "PICK", team: null, isBye: false })).toEqual([]);
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
    expect(toolLinkSearch(from, { tab: "comparison", comparePlayerId: "4046" }))
      .toBe("?tab=comparison&league=league-1&c1=4046");
    expect(toolLinkSearch(from, { tab: "monitor", gameLinesTeam: "KC" }))
      .toBe("?tab=monitor&league=league-1&gt=KC");
  });
});

describe("matchupToolLinks", () => {
  it("returns no matchup Open-in destinations", () => {
    expect(matchupToolLinks({ team: "KC", opponent: "BUF" })).toEqual([]);
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
