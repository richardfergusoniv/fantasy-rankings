import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSleeperUserIdMock = vi.fn();
const viewerBelongsToLeagueMock = vi.fn();
const loadHistoricalTradesMock = vi.fn();

vi.mock("./auth.js", () => ({
  resolveSleeperUserId: (...args: unknown[]) => resolveSleeperUserIdMock(...args),
}));

vi.mock("./viewer-league-access.js", () => ({
  viewerBelongsToLeague: (...args: unknown[]) => viewerBelongsToLeagueMock(...args),
}));

vi.mock("./trades.js", () => ({
  historicalTradesResponse: {
    safeParse: (value: unknown) => ({ success: true as const, data: value }),
  },
  loadHistoricalTrades: (...args: unknown[]) => loadHistoricalTradesMock(...args),
}));

import { handleTradesHistory } from "./trades-history.js";

beforeEach(() => {
  resolveSleeperUserIdMock.mockReset();
  viewerBelongsToLeagueMock.mockReset();
  loadHistoricalTradesMock.mockReset();
});

describe("handleTradesHistory", () => {
  it("requires sign-in", async () => {
    resolveSleeperUserIdMock.mockResolvedValue(null);
    const res = await handleTradesHistory(
      new Request("https://example.com/api/trades/history?leagueId=lg1"),
    );
    expect(res.status).toBe(401);
    expect(loadHistoricalTradesMock).not.toHaveBeenCalled();
  });

  it("forbids leagues outside the viewer's membership", async () => {
    resolveSleeperUserIdMock.mockResolvedValue("sleeper-1");
    viewerBelongsToLeagueMock.mockResolvedValue(false);
    const res = await handleTradesHistory(
      new Request("https://example.com/api/trades/history?leagueId=lg-foreign"),
    );
    expect(res.status).toBe(403);
    expect(viewerBelongsToLeagueMock).toHaveBeenCalledWith("sleeper-1", "lg-foreign");
    expect(loadHistoricalTradesMock).not.toHaveBeenCalled();
  });

  it("loads history when the viewer belongs to the league", async () => {
    resolveSleeperUserIdMock.mockResolvedValue("sleeper-1");
    viewerBelongsToLeagueMock.mockResolvedValue(true);
    loadHistoricalTradesMock.mockResolvedValue({
      trades: [],
      seasons: [2026],
      asOf: "2026-10-10T00:00:00.000Z",
      isStale: false,
      sourceErrors: [],
    });
    const res = await handleTradesHistory(
      new Request("https://example.com/api/trades/history?leagueId=lg-mine"),
    );
    expect(res.status).toBe(200);
    expect(loadHistoricalTradesMock).toHaveBeenCalledWith("lg-mine", false, "sleeper-1", undefined);
  });
});
