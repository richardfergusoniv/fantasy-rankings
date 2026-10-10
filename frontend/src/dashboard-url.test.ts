import { describe, expect, it } from "vitest";
import {
  dashboardUrlHistoryMode,
  effectiveTradeMode,
  emptyDashboardUrlState,
  parseDashboardSearch,
  resolveDashboardTab,
  serializeDashboardSearch,
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

  it("omits defaults so the monitor view stays a clean URL", () => {
    expect(serializeDashboardSearch(emptyDashboardUrlState())).toBe("");
    expect(parseDashboardSearch("")).toEqual(emptyDashboardUrlState());
    expect(emptyDashboardUrlState().tab).toBe("monitor");
    expect(serializeDashboardSearch(state({ tab: "trade", tradeMode: "league" }))).toBe("?tab=trade");
    expect(serializeDashboardSearch(state({ tab: "trade", tradeMode: "market" }))).toBe("?tab=trade&tmode=market");
  });

  it("round-trips older tab values including matchup", () => {
    for (const tab of ["team", "rankings", "waivers", "power", "draft", "trade", "charts", "comparison"] as const) {
      const original = state({ tab });
      expect(parseDashboardSearch(serializeDashboardSearch(original))).toEqual(original);
    }
    expect(parseDashboardSearch("?tab=team").tab).toBe("team");
    expect(serializeDashboardSearch(state({ tab: "team" }))).toBe("?tab=team");
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
    expect(parseDashboardSearch("?tab=charts&table=defense").tab).toBe("charts");
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

  it("pushes history for tab changes and the player sheet, and replaces filter edits", () => {
    const rankings = state({ tab: "rankings" });
    expect(dashboardUrlHistoryMode(emptyDashboardUrlState(), rankings)).toBe("push");
    expect(dashboardUrlHistoryMode(rankings, state({ tab: "rankings", playerId: "p1" }))).toBe("push");
    expect(dashboardUrlHistoryMode(state({ tab: "rankings", playerId: "p1" }), rankings)).toBe("push");
    expect(dashboardUrlHistoryMode(rankings, state({ tab: "rankings", position: "QB", query: "A" }))).toBe("replace");
    expect(dashboardUrlHistoryMode(state({ tab: "trade" }), state({ tab: "trade", tradeMode: "history" }))).toBe("replace");
    expect(dashboardUrlHistoryMode(rankings, rankings)).toBe("none");
    expect(dashboardUrlHistoryMode(emptyDashboardUrlState(), state({ tab: "team" }))).toBe("push");
  });
});
