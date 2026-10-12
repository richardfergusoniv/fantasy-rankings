import { describe, expect, it } from "vitest";
import { isSectionWaiting, shouldShowProgressiveShell } from "./dashboard-loading";

describe("shouldShowProgressiveShell", () => {
  const base = {
    hasDashboard: false,
    metaPending: false,
    teamPending: false,
    waitingForFirstBuild: false,
    firstBuildTimedOut: false,
    tradeSectionWaiting: false,
    tradeWaiverWaiting: false,
  };

  it("shows the loading shell when trade is still waiting after meta/team resolved", () => {
    // Measured regression: trade (~0.93 MB) lands after team (~0.12 MB); without
    // this wait the UI fell through to "Data didn’t make it through."
    expect(
      shouldShowProgressiveShell({
        ...base,
        tradeSectionWaiting: true,
      }),
    ).toBe(true);
  });

  it("shows the loading shell while trade-waiver waits on league-adjusted trade", () => {
    expect(
      shouldShowProgressiveShell({
        ...base,
        tradeWaiverWaiting: true,
      }),
    ).toBe(true);
  });

  it("does not show the shell when a dashboard is already available", () => {
    expect(
      shouldShowProgressiveShell({
        ...base,
        hasDashboard: true,
        tradeSectionWaiting: true,
      }),
    ).toBe(false);
  });

  it("shows the shell for meta/team pending or first-build wait", () => {
    expect(shouldShowProgressiveShell({ ...base, metaPending: true })).toBe(true);
    expect(shouldShowProgressiveShell({ ...base, teamPending: true })).toBe(true);
    expect(
      shouldShowProgressiveShell({
        ...base,
        waitingForFirstBuild: true,
        firstBuildTimedOut: false,
      }),
    ).toBe(true);
    expect(
      shouldShowProgressiveShell({
        ...base,
        waitingForFirstBuild: true,
        firstBuildTimedOut: true,
      }),
    ).toBe(false);
  });

  it("does not show the shell when nothing is pending (error screen may follow)", () => {
    expect(shouldShowProgressiveShell(base)).toBe(false);
  });
});

describe("isSectionWaiting", () => {
  it("treats trade slower than team (pending / no data yet) as waiting", () => {
    expect(
      isSectionWaiting({
        active: true,
        isError: false,
        isPending: true,
        isFetching: true,
        hasPayload: false,
        dataUndefined: true,
      }),
    ).toBe(true);
    expect(
      isSectionWaiting({
        active: true,
        isError: false,
        isPending: false,
        isFetching: true,
        hasPayload: false,
        dataUndefined: false,
      }),
    ).toBe(true);
  });

  it("stops waiting after a hard failure so empty UI can show (retry on remount)", () => {
    expect(
      isSectionWaiting({
        active: true,
        isError: true,
        isPending: false,
        isFetching: false,
        hasPayload: false,
        dataUndefined: true,
      }),
    ).toBe(false);
  });

  it("is not waiting when inactive or when a payload has landed", () => {
    expect(
      isSectionWaiting({
        active: false,
        isError: false,
        isPending: true,
        isFetching: true,
        hasPayload: false,
        dataUndefined: true,
      }),
    ).toBe(false);
    expect(
      isSectionWaiting({
        active: true,
        isError: false,
        isPending: false,
        isFetching: false,
        hasPayload: true,
        dataUndefined: false,
      }),
    ).toBe(false);
  });
});
