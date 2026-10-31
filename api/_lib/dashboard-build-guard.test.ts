import { describe, expect, it } from "vitest";
import { assertDashboardBuildPublishable, IncompleteDashboardBuildError } from "./dashboard-build-guard.js";

describe("assertDashboardBuildPublishable", () => {
  it("allows a complete build when a snapshot is being protected", () => {
    expect(() => assertDashboardBuildPublishable({
      requireComplete: true,
      rosterFetchFailedLeagueIds: [],
    })).not.toThrow();
  });

  it("allows an incomplete build on a cold start (no snapshot to protect)", () => {
    expect(() => assertDashboardBuildPublishable({
      requireComplete: false,
      rosterFetchFailedLeagueIds: ["league-1"],
    })).not.toThrow();
  });

  it("refuses to publish an incomplete build over an existing snapshot", () => {
    let caught: unknown;
    try {
      assertDashboardBuildPublishable({
        requireComplete: true,
        rosterFetchFailedLeagueIds: ["league-1", "league-2"],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompleteDashboardBuildError);
    const incomplete = caught as IncompleteDashboardBuildError;
    expect(incomplete.rosterFetchFailedLeagueIds).toEqual(["league-1", "league-2"]);
    expect(incomplete.message).toContain("league-1");
  });
});
