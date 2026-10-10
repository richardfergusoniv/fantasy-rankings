import { describe, expect, it } from "vitest";
import { rosterNewsForTicker } from "./dashboard-shared";
import type { PlayerNews } from "./dashboard-types";

function news(items: Array<{ id: string; playerId: string; change: string }>): PlayerNews {
  return {
    lastCheckedAt: null,
    emptyReason: null,
    runs: [{
      id: "shared",
      checkedAt: "2026-10-10T00:00:00.000Z",
      items: items.map((item) => ({
        id: item.id,
        playerId: item.playerId,
        player: "Player",
        team: "MIN",
        change: item.change,
        leagueIds: [],
        newsType: "roster" as const,
        leagues: [],
        availability: [],
        roleContext: "",
        sourceLabel: "Sleeper",
        sourceUrl: "https://sleeper.app",
        sourcePublishedAt: null,
        author: null,
        source: "sleeper" as const,
        signal: null,
        score: null,
      })),
    }],
  };
}

describe("rosterNewsForTicker", () => {
  it("keeps roster news for selected-league roster ids and drops others", () => {
    const feed = news([
      { id: "1", playerId: "a", change: "A out" },
      { id: "2", playerId: "b", change: "B out" },
      { id: "3", playerId: "a", change: "A out" },
    ]);
    const items = rosterNewsForTicker(feed, new Set(["a"]));
    expect(items.map((item) => item.id)).toEqual(["1"]);
  });
});
