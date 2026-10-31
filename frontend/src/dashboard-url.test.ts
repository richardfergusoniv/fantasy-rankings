import { describe, expect, it } from "vitest";
import {
  CLEARED_TOOL_SELECTIONS,
  dashboardUrlHistoryMode,
  effectiveTradeMode,
  emptyDashboardUrlState,
  parseDashboardSearch,
  resolveDashboardTab,
  serializeDashboardSearch,
  toolLinkSearch,
  waiversSearchPreservingContext,
  type DashboardUrlState,
} from "./dashboard-url";

function state(patch: Partial<DashboardUrlState> = {}): DashboardUrlState {
  return { ...emptyDashboardUrlState(), ...patch };
}

describe("dashboard URL state", () => {
  it("round-trips the tab, filters, trade mode, and open player", () => {
    const original = state({
      tab: "waivers",
      league: "league-1",
      position: "WR",
      horizon: "ros",
      query: "Chase",
      draftPosition: "RB",
      draftQuery: "Bijan",
      draftRoom: "myTeam",
      chartDataset: "projections",
      tradeMode: "history",
      playerId: "player-9",
    });
    expect(parseDashboardSearch(serializeDashboardSearch(original))).toEqual(original);
  });

  it("round-trips the Alt picks room", () => {
    const original = state({ tab: "draft", draftRoom: "altPicks" });
    expect(serializeDashboardSearch(original)).toBe("?tab=draft&room=altPicks");
    expect(parseDashboardSearch(serializeDashboardSearch(original))).toEqual(original);
  });

  it("omits defaults so the matchup view stays a clean URL", () => {
    expect(serializeDashboardSearch(emptyDashboardUrlState())).toBe("");
    expect(parseDashboardSearch("")).toEqual(emptyDashboardUrlState());
    expect(emptyDashboardUrlState().tab).toBe("team");
    expect(serializeDashboardSearch(state({ tab: "trade", tradeMode: "league" }))).toBe("?tab=trade");
    expect(serializeDashboardSearch(state({ tab: "trade", tradeMode: "market" }))).toBe("?tab=trade&tmode=market");
  });

  it("round-trips older tab values including matchup", () => {
    for (const tab of ["team", "rankings", "waivers", "power", "draft", "trade", "comparison", "monitor", "team-stats", "analytics"] as const) {
      const original = state({ tab });
      expect(parseDashboardSearch(serializeDashboardSearch(original))).toEqual(original);
    }
    expect(parseDashboardSearch("?tab=team").tab).toBe("team");
    expect(serializeDashboardSearch(state({ tab: "team" }))).toBe("");
  });

  it("redirects legacy analyze and history tab aliases onto trade modes", () => {
    expect(resolveDashboardTab("analyze")).toEqual({ tab: "trade", legacyTradeMode: "league" });
    expect(resolveDashboardTab("history")).toEqual({ tab: "trade", legacyTradeMode: "history" });
    expect(parseDashboardSearch("?tab=analyze")).toEqual(state({ tab: "trade" }));
    expect(parseDashboardSearch("?tab=history")).toEqual(state({ tab: "trade", tradeMode: "history" }));
    expect(parseDashboardSearch("?tab=trade&view=history")).toEqual(state({ tab: "trade", tradeMode: "history" }));
    expect(parseDashboardSearch("?tab=trade&tradeView=analyze")).toEqual(state({ tab: "trade" }));
    expect(parseDashboardSearch("?tab=trade&view=market")).toEqual(state({ tab: "trade", tradeMode: "market" }));
    expect(parseDashboardSearch("?tab=draft").tab).toBe("draft");
  });

  it("redirects removed Explorer Tables URLs onto Rankings", () => {
    expect(resolveDashboardTab("strengthOfSchedule")).toEqual({ tab: "rankings", legacyTradeMode: null });
    expect(resolveDashboardTab("tables")).toEqual({ tab: "rankings", legacyTradeMode: null });
    expect(parseDashboardSearch("?tab=strengthOfSchedule")).toEqual(state({ tab: "rankings" }));
    expect(parseDashboardSearch("?tab=tables")).toEqual(state({ tab: "rankings" }));
    expect(parseDashboardSearch("?tab=strengthOfSchedule&table=offense")).toEqual(state({ tab: "rankings" }));
    expect(parseDashboardSearch("?table=sos")).toEqual(state({ tab: "rankings" }));
    expect(parseDashboardSearch("?dataset=team-overall")).toEqual(state({ tab: "rankings" }));
    expect(parseDashboardSearch("?tab=charts&table=defense").tab).toBe("analytics");
  });

  it("redirects removed Players Charts URLs onto Analytics in Tools", () => {
    expect(resolveDashboardTab("charts")).toEqual({ tab: "analytics", legacyTradeMode: null });
    expect(parseDashboardSearch("?tab=charts")).toEqual(state({ tab: "analytics" }));
    expect(parseDashboardSearch("?tab=charts&chart=projections")).toEqual(state({ tab: "analytics", chartDataset: "projections" }));
  });

  it("exposes effectiveTradeMode defaults for the analyzer", () => {
    expect(effectiveTradeMode(emptyDashboardUrlState())).toBe("league");
    expect(effectiveTradeMode(state({ tradeMode: "market" }))).toBe("market");
  });

  it("falls back when a param is not a known value", () => {
    expect(parseDashboardSearch("?tab=nope&pos=ZZ&horizon=year&dpos=coach&room=lounge&chart=pie&tmode=future&player=%20%20")).toEqual(emptyDashboardUrlState());
  });

  it("ignores a legacy rankings density query param", () => {
    expect(parseDashboardSearch("?tab=rankings&density=comfortable")).toEqual(state({ tab: "rankings" }));
    expect(parseDashboardSearch("?tab=waivers&density=compact")).toEqual(state({ tab: "waivers" }));
  });

  it("opens Waivers without dropping the position filter or the open player", () => {
    expect(waiversSearchPreservingContext(state({
      tab: "rankings",
      league: "league-1",
      position: "WR",
      horizon: "ros",
      query: "Chase",
      playerId: "player-9",
    }))).toBe("?tab=waivers&league=league-1&pos=WR&horizon=ros&q=Chase&player=player-9");
    expect(waiversSearchPreservingContext(emptyDashboardUrlState())).toBe("?tab=waivers");
  });

  it("pushes history for tab changes and the player sheet, and replaces filter edits", () => {
    const rankings = state({ tab: "rankings" });
    expect(dashboardUrlHistoryMode(emptyDashboardUrlState(), rankings)).toBe("push");
    expect(dashboardUrlHistoryMode(rankings, state({ tab: "rankings", playerId: "p1" }))).toBe("push");
    expect(dashboardUrlHistoryMode(state({ tab: "rankings", playerId: "p1" }), rankings)).toBe("push");
    expect(dashboardUrlHistoryMode(rankings, state({ tab: "rankings", position: "QB", query: "A" }))).toBe("replace");
    expect(dashboardUrlHistoryMode(state({ tab: "trade" }), state({ tab: "trade", tradeMode: "history" }))).toBe("replace");
    expect(dashboardUrlHistoryMode(rankings, rankings)).toBe("none");
    expect(dashboardUrlHistoryMode(emptyDashboardUrlState(), state({ tab: "power" }))).toBe("push");
  });
  it("round-trips tool selections on their own tab", () => {
    const teamStats = state({ tab: "team-stats", teamStatsTeam: "KC", teamStatsGroup: "wr", teamStatsStat: "targets" });
    expect(serializeDashboardSearch(teamStats)).toBe("?tab=team-stats&ts=KC&tg=wr&tst=targets");
    expect(parseDashboardSearch(serializeDashboardSearch(teamStats))).toEqual(teamStats);

    const gameLines = state({ tab: "monitor", gameLinesTeam: "KC" });
    expect(serializeDashboardSearch(gameLines)).toBe("?tab=monitor&gt=KC");
    expect(parseDashboardSearch("?tab=monitor&gt=KC")).toEqual(gameLines);
  });

  it("drops a tool's parameters when the URL is for another tab", () => {
    expect(serializeDashboardSearch(state({ tab: "rankings", teamStatsTeam: "KC", gameLinesTeam: "KC" }))).toBe("?tab=rankings");
    expect(serializeDashboardSearch(state({ tab: "team-stats", gameLinesTeam: "KC" }))).toBe("?tab=team-stats");
  });

  it("ignores blank tool parameters and keeps a card link's open player separate", () => {
    expect(parseDashboardSearch("?tab=team-stats&ts=%20&tg=")).toEqual(state({ tab: "team-stats" }));
    expect(serializeDashboardSearch(state({ tab: "team-stats", teamStatsTeam: "KC", playerId: "4046" }))).toBe("?tab=team-stats&player=4046&ts=KC");
  });

  it("replaces history for tool selection edits and pushes when entering a tool", () => {
    const teamStats = state({ tab: "team-stats", teamStatsTeam: "KC" });
    expect(dashboardUrlHistoryMode(teamStats, state({ tab: "team-stats", teamStatsTeam: "BUF" }))).toBe("replace");
    expect(dashboardUrlHistoryMode(state({ tab: "rankings", playerId: "1" }), teamStats)).toBe("push");
  });

  it("opens a retired Pricing link as that player's card on Rankings", () => {
    expect(parseDashboardSearch("?tab=pricing&pp=4046&pc=6794")).toEqual(state({ tab: "rankings", playerId: "4046" }));
    expect(parseDashboardSearch("?tab=pricing&player=1&pp=2")).toEqual(state({ tab: "rankings", playerId: "1" }));
    expect(parseDashboardSearch("?tab=pricing")).toEqual(state({ tab: "rankings" }));
  });

  it("carries the comparison player only on the comparison tab", () => {
    const comparison = state({ tab: "comparison", comparePlayerId: "4046" });
    expect(serializeDashboardSearch(comparison)).toBe("?tab=comparison&c1=4046");
    expect(parseDashboardSearch("?tab=comparison&c1=4046")).toEqual(comparison);
    expect(serializeDashboardSearch(state({ tab: "waivers", comparePlayerId: "4046" }))).toBe("?tab=waivers");
  });

  it("carries the analytics player only on the analytics tab", () => {
    const analytics = state({ tab: "analytics", chartDataset: "advanced", analyticsPlayerId: "4046" });
    expect(serializeDashboardSearch(analytics)).toBe("?tab=analytics&chart=advanced&ap=4046");
    expect(parseDashboardSearch("?tab=analytics&chart=advanced&ap=4046")).toEqual(analytics);
    expect(serializeDashboardSearch(state({ tab: "team-stats", analyticsPlayerId: "4046" }))).toBe("?tab=team-stats");
  });

  it("carries the trade partner only on the trade tab", () => {
    const trade = state({ tab: "trade", tradePartner: "7" });
    expect(serializeDashboardSearch(trade)).toBe("?tab=trade&tp=7");
    expect(parseDashboardSearch("?tab=trade&tp=7")).toEqual(trade);
    expect(serializeDashboardSearch(state({ tab: "trade", tradeMode: "market", tradePartner: "7" }))).toBe("?tab=trade&tmode=market&tp=7");
    expect(serializeDashboardSearch(state({ tab: "power", tradePartner: "7" }))).toBe("?tab=power");
  });

  describe("matchup dialog", () => {
    const final = { team: "CAR", opponent: "TB", isAway: false, gamePhase: "final" } as const;

    it("round-trips through mu, with - for an unknown side or phase", () => {
      expect(serializeDashboardSearch(state({ matchup: final }))).toBe("?mu=CAR.TB.vs.final");
      expect(parseDashboardSearch("?mu=CAR.TB.vs.final").matchup).toEqual(final);
      const unknown = { team: "NE", opponent: "CHI", isAway: null, gamePhase: null } as const;
      expect(serializeDashboardSearch(state({ matchup: unknown }))).toBe("?mu=NE.CHI.-.-");
      expect(parseDashboardSearch("?mu=NE.CHI.-.-").matchup).toEqual(unknown);
      const away = { team: "NE", opponent: "CHI", isAway: true, gamePhase: "live" } as const;
      expect(parseDashboardSearch(serializeDashboardSearch(state({ matchup: away }))).matchup).toEqual(away);
    });

    it("stays on any tab and beside an open player", () => {
      expect(serializeDashboardSearch(state({ tab: "rankings", playerId: "p1", matchup: final }))).toBe("?tab=rankings&player=p1&mu=CAR.TB.vs.final");
      expect(parseDashboardSearch("?tab=draft&mu=CAR.TB.at.pregame").matchup).toMatchObject({ team: "CAR", isAway: true, gamePhase: "pregame" });
    });

    it("ignores malformed values instead of opening a half-formed dialog", () => {
      for (const bad of ["CAR", "CAR.TB", "CAR.TB.vs", "car.tb.vs.final", "CAR.CAR.vs.final", "CAR.TB.home.final", "CAR.TB.toString.final", "CAR.TB.constructor.final", "CAR.TB.__proto__.final", "CAR.TB.vs.done", "CAR.TB.vs.final.x", ""]) {
        expect(parseDashboardSearch(`?mu=${bad}`).matchup, bad).toBeNull();
      }
    });

    it("pushes history when it opens and edits in place otherwise, so Back closes it", () => {
      const team = state({ tab: "team" });
      expect(dashboardUrlHistoryMode(team, state({ tab: "team", matchup: final }))).toBe("push");
      expect(dashboardUrlHistoryMode(state({ tab: "team", matchup: final }), state({ tab: "team", matchup: { ...final, opponent: "GB" } }))).toBe("replace");
      expect(dashboardUrlHistoryMode(state({ tab: "team", matchup: final }), team)).toBe("replace");
      expect(dashboardUrlHistoryMode(state({ tab: "team", matchup: final }), state({ tab: "monitor", gameLinesTeam: "CAR" }))).toBe("push");
    });

    it("is dropped by a link into a tool, so the dialog closes and Back restores it", () => {
      expect(toolLinkSearch(state({ matchup: final }), { tab: "monitor", gameLinesTeam: "CAR" })).toBe("?tab=monitor&gt=CAR");
      expect(CLEARED_TOOL_SELECTIONS.matchup).toBeNull();
    });
  });
});
