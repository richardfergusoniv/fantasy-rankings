import { beforeEach, describe, expect, it, vi } from "vitest";

const readUserLeaguesMock = vi.fn();

vi.mock("./user-leagues.js", () => ({
  readUserLeagues: (...args: unknown[]) => readUserLeaguesMock(...args),
}));

import {
  viewerBelongsToLeague,
  viewerUsesValueHistoryFormat,
} from "./viewer-league-access.js";

beforeEach(() => {
  readUserLeaguesMock.mockReset();
});

describe("viewerBelongsToLeague", () => {
  it("returns true only for leagues in the viewer's Sleeper account", async () => {
    readUserLeaguesMock.mockResolvedValue({
      season: 2026,
      week: 1,
      seasonType: "regular",
      leagues: [
        { league_id: "lg-mine", name: "Mine", total_rosters: 12, roster_positions: ["QB"], scoring_settings: { rec: 0.5 }, settings: { type: 0 } },
      ],
    });
    expect(await viewerBelongsToLeague("user-1", "lg-mine")).toBe(true);
    expect(await viewerBelongsToLeague("user-1", "lg-other")).toBe(false);
    expect(readUserLeaguesMock).toHaveBeenCalledWith("user-1", false, { allowStaleOnError: false });
  });

  it("propagates refresh failures when membership cannot be confirmed", async () => {
    readUserLeaguesMock.mockRejectedValue(new Error("Sleeper leagues are unavailable"));
    await expect(viewerBelongsToLeague("user-1", "lg-mine")).rejects.toThrow(/unavailable/);
  });
});

describe("viewerUsesValueHistoryFormat", () => {
  it("allows the league format and dynasty redraft twin, rejects foreign formats", async () => {
    readUserLeaguesMock.mockResolvedValue({
      season: 2026,
      week: 1,
      seasonType: "regular",
      leagues: [
        {
          league_id: "lg-dyn",
          name: "Dynasty",
          total_rosters: 12,
          roster_positions: ["QB", "SUPER_FLEX"],
          scoring_settings: { rec: 1 },
          settings: { type: 2 },
        },
      ],
    });
    // Dynasty 2QB 12-team PPR → maps to dynasty-2qb-12t-1ppr preset.
    expect(await viewerUsesValueHistoryFormat("user-1", "dynasty-2qb-12t-1ppr")).toBe(true);
    // Redraft twin used by trade / ROS charts.
    expect(await viewerUsesValueHistoryFormat("user-1", "redraft-2qb-12t-1ppr")).toBe(true);
    expect(await viewerUsesValueHistoryFormat("user-1", "redraft-1qb-10t-0.5ppr")).toBe(false);
    expect(readUserLeaguesMock).toHaveBeenCalledWith("user-1", false, { allowStaleOnError: false });
  });
});
