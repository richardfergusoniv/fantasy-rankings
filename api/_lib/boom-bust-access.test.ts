import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSleeperUserIdMock = vi.fn();
const viewerBelongsToLeagueMock = vi.fn();

vi.mock("./auth.js", () => ({
  resolveSleeperUserId: (...args: unknown[]) => resolveSleeperUserIdMock(...args),
}));

vi.mock("./viewer-league-access.js", () => ({
  viewerBelongsToLeague: (...args: unknown[]) => viewerBelongsToLeagueMock(...args),
}));

vi.mock("./db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => undefined) })),
    })),
  },
  schema: {
    sourceCache: { cacheKey: "cache_key", payload: "payload", fetchedAt: "fetched_at" },
  },
}));

vi.mock("./sleeper.js", () => ({
  BOOM_BUST_SEASONS: [2024, 2025, 2026],
  SLEEPER_BASE: "https://api.sleeper.app/v1",
  buildBoomBustSeries: () => ({
    status: "unavailable",
    weeklyScores: [],
    floor: null,
    firstQuartile: null,
    median: null,
    mean: null,
    thirdQuartile: null,
    ceiling: null,
  }),
  canonicalTeam: (value: string) => value,
  fetchJson: vi.fn(),
  hasSleeperGameParticipation: () => false,
  loadSleeperPlayerWeeklySeason: vi.fn(async () => []),
  scoreProjectedPlayerStats: () => 0,
  sleeperActualStats: () => ({}),
  sleeperGameLogStats: () => ({}),
}));

import { GET } from "../boom-bust/[type].js";

beforeEach(() => {
  resolveSleeperUserIdMock.mockReset();
  viewerBelongsToLeagueMock.mockReset();
});

describe("boom-bust league membership gate", () => {
  it("requires sign-in", async () => {
    resolveSleeperUserIdMock.mockResolvedValue(null);
    const res = await GET(
      new Request("https://example.com/api/boom-bust/history?leagueId=lg1&playerId=p1&position=WR&view=season"),
    );
    expect(res.status).toBe(401);
    expect(viewerBelongsToLeagueMock).not.toHaveBeenCalled();
  });

  it("forbids leagues outside the viewer's membership before settings writes", async () => {
    resolveSleeperUserIdMock.mockResolvedValue("sleeper-1");
    viewerBelongsToLeagueMock.mockResolvedValue(false);
    const res = await GET(
      new Request("https://example.com/api/boom-bust/history?leagueId=lg-foreign&playerId=p1&position=WR&view=season"),
    );
    expect(res.status).toBe(403);
    expect(viewerBelongsToLeagueMock).toHaveBeenCalledWith("sleeper-1", "lg-foreign");
  });
});
