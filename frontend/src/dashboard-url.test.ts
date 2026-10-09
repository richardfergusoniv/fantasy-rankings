import { describe, expect, it } from "vitest";
import {
  dashboardUrlHistoryMode,
  emptyDashboardUrlState,
  parseDashboardSearch,
  serializeDashboardSearch,
  type DashboardUrlState,
} from "./dashboard-url";

function state(patch: Partial<DashboardUrlState> = {}): DashboardUrlState {
  return { ...emptyDashboardUrlState(), ...patch };
}

describe("dashboard URL state", () => {
  it("round-trips the tab, filters, and open player", () => {
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
      playerId: "player-9",
    });
    expect(parseDashboardSearch(serializeDashboardSearch(original))).toEqual(original);
  });

  it("omits defaults so the monitor view stays a clean URL", () => {
    expect(serializeDashboardSearch(emptyDashboardUrlState())).toBe("");
    expect(parseDashboardSearch("")).toEqual(emptyDashboardUrlState());
    expect(emptyDashboardUrlState().tab).toBe("monitor");
  });

  it("round-trips older tab values including matchup", () => {
    for (const tab of ["team", "rankings", "waivers", "power", "draft", "trade", "charts", "comparison", "strengthOfSchedule"] as const) {
      const original = state({ tab });
      expect(parseDashboardSearch(serializeDashboardSearch(original))).toEqual(original);
    }
    expect(parseDashboardSearch("?tab=team").tab).toBe("team");
    expect(serializeDashboardSearch(state({ tab: "team" }))).toBe("?tab=team");
  });

  it("falls back when a param is not a known value", () => {
    expect(parseDashboardSearch("?tab=nope&pos=ZZ&horizon=year&dpos=coach&room=lounge&chart=pie&player=%20%20")).toEqual(emptyDashboardUrlState());
  });

  it("pushes history for tab changes and the player sheet, and replaces filter edits", () => {
    const rankings = state({ tab: "rankings" });
    expect(dashboardUrlHistoryMode(emptyDashboardUrlState(), rankings)).toBe("push");
    expect(dashboardUrlHistoryMode(rankings, state({ tab: "rankings", playerId: "p1" }))).toBe("push");
    expect(dashboardUrlHistoryMode(state({ tab: "rankings", playerId: "p1" }), rankings)).toBe("push");
    expect(dashboardUrlHistoryMode(rankings, state({ tab: "rankings", position: "QB", query: "A" }))).toBe("replace");
    expect(dashboardUrlHistoryMode(rankings, rankings)).toBe("none");
    expect(dashboardUrlHistoryMode(emptyDashboardUrlState(), state({ tab: "team" }))).toBe("push");
  });
});
