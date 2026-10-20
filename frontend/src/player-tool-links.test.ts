import { describe, expect, it } from "vitest";
import { emptyDashboardUrlState, toolLinkSearch } from "./dashboard-url";
import { playerToolLinks } from "./player-tool-links";

const base = { playerId: "4046", position: "WR", team: "KC", seasonValue: 5200, isBye: false };

describe("playerToolLinks", () => {
  it("offers Pricing, Team stats and Game lines for a rostered WR", () => {
    const links = playerToolLinks(base);
    expect(links.map((link) => link.key)).toEqual(["pricing", "team-stats", "game-lines"]);
    expect(links[0]?.patch).toEqual({ tab: "pricing", pricingPlayerId: "4046" });
    expect(links[1]?.patch).toEqual({ tab: "team-stats", teamStatsTeam: "KC", teamStatsGroup: "WRTE" });
    expect(links[2]?.patch).toEqual({ tab: "monitor", gameLinesTeam: "KC" });
  });

  it("maps positions onto Team stats groups and skips kickers and defenses", () => {
    expect(playerToolLinks({ ...base, position: "TE" })[1]?.patch.teamStatsGroup).toBe("WRTE");
    expect(playerToolLinks({ ...base, position: "QB" })[1]?.patch.teamStatsGroup).toBe("QB");
    expect(playerToolLinks({ ...base, position: "RB" })[1]?.patch.teamStatsGroup).toBe("RB");
    for (const position of ["K", "DEF"]) {
      expect(playerToolLinks({ ...base, position }).map((link) => link.key)).not.toContain("team-stats");
    }
  });

  it("omits destinations that would have nothing to show", () => {
    expect(playerToolLinks({ ...base, seasonValue: null }).map((link) => link.key)).toEqual(["team-stats", "game-lines"]);
    expect(playerToolLinks({ ...base, isBye: true }).map((link) => link.key)).toEqual(["pricing", "team-stats"]);
    expect(playerToolLinks({ ...base, team: null }).map((link) => link.key)).toEqual(["pricing"]);
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
