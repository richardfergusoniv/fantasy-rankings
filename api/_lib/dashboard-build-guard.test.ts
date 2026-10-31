import { describe, expect, it } from "vitest";
import {
  assertDashboardBuildPublishable,
  buildRetryBudgetMs,
  IncompleteDashboardBuildError,
  MIN_BUILD_RETRY_BUDGET_MS,
} from "./dashboard-build-guard.js";

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

describe("buildRetryBudgetMs", () => {
  const deadline = 100_000;

  it("gives the first attempt the full remaining budget", () => {
    expect(buildRetryBudgetMs({ requestDeadlineAtMs: deadline, nowMs: 45_000, attempt: 0 })).toBe(55_000);
  });

  it("gives a retry only what is left of the shared deadline", () => {
    expect(buildRetryBudgetMs({ requestDeadlineAtMs: deadline, nowMs: 70_000, attempt: 1 })).toBe(30_000);
  });

  it("refuses a retry with too little budget left to be worth starting", () => {
    expect(buildRetryBudgetMs({
      requestDeadlineAtMs: deadline,
      nowMs: deadline - MIN_BUILD_RETRY_BUDGET_MS + 1,
      attempt: 1,
    })).toBeNull();
  });

  it("allows a retry at exactly the minimum budget", () => {
    expect(buildRetryBudgetMs({
      requestDeadlineAtMs: deadline,
      nowMs: deadline - MIN_BUILD_RETRY_BUDGET_MS,
      attempt: 1,
    })).toBe(MIN_BUILD_RETRY_BUDGET_MS);
  });
});
