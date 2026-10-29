import { describe, expect, it } from "vitest";
import { SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT } from "../../api/_lib/player-news-filters";
import { rosterNewsForTicker } from "./roster-news";
import type { PlayerNews } from "./dashboard-types";

function news(items: Array<{
  id: string;
  playerId: string;
  change: string;
  roleContext?: string;
  sourceUrl?: string;
  externalId?: string | null;
  source?: "sleeper" | "x" | "nflverse";
}>): PlayerNews {
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
        roleContext: item.roleContext ?? "",
        sourceLabel: "Sleeper",
        sourceUrl: item.sourceUrl ?? `https://sleeper.app/news/${item.id}`,
        sourcePublishedAt: null,
        author: null,
        externalId: item.externalId === undefined ? `fixture:${item.id}` : item.externalId,
        source: item.source ?? ("sleeper" as const),
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

  it("drops legacy Sleeper timestamp-only news rows", () => {
    const feed = news([
      {
        id: "ping",
        playerId: "a",
        change: "Player has a Sleeper news update.",
        roleContext: SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
      },
      {
        id: "status",
        playerId: "a",
        change: "Injury status changed from Questionable to Out.",
        roleContext: "Sleeper injury-status change detected by the scheduled check.",
      },
    ]);
    const items = rosterNewsForTicker(feed, new Set(["a"]));
    expect(items.map((item) => item.id)).toEqual(["status"]);
  });

  it("collapses the same X post attached to two roster players", () => {
    const postId = "2115569505300811921";
    const sourceUrl = `https://x.com/r/status/${postId}`;
    const feed = news([
      {
        id: "x-a",
        playerId: "a",
        change: "Practice report roundup",
        source: "x",
        externalId: postId,
        sourceUrl,
      },
      {
        id: "x-b",
        playerId: "b",
        change: "Practice report roundup (Gibbs)",
        source: "x",
        externalId: postId,
        sourceUrl,
      },
    ]);
    const items = rosterNewsForTicker(feed, new Set(["a", "b"]));
    expect(items.map((item) => item.id)).toEqual(["x-a"]);
  });
});
