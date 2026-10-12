import { describe, expect, it } from "vitest";
import { SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT } from "../../api/_lib/player-news-filters";
import type { PlayerNews, PlayerNewsItem } from "./dashboard-types";
import { newsForTicker, TICKER_NEWS_LIMIT } from "./ticker-news";

function item(partial: {
  id: string;
  playerId: string;
  change: string;
  score?: number | null;
  sourcePublishedAt?: string | null;
  roleContext?: string;
}): PlayerNewsItem {
  return {
    id: partial.id,
    playerId: partial.playerId,
    player: "Player",
    team: "MIN",
    change: partial.change,
    leagueIds: [],
    newsType: "roster",
    leagues: [],
    availability: [],
    roleContext: partial.roleContext ?? "",
    sourceLabel: "Sleeper",
    sourceUrl: "https://sleeper.app",
    sourcePublishedAt: partial.sourcePublishedAt ?? "2026-10-10T12:00:00.000Z",
    author: null,
    source: "sleeper",
    signal: null,
    score: partial.score ?? null,
  };
}

function feed(items: PlayerNewsItem[]): PlayerNews {
  return {
    lastCheckedAt: null,
    emptyReason: null,
    runs: [{ id: "shared", checkedAt: "2026-10-10T00:00:00.000Z", items }],
  };
}

describe("newsForTicker", () => {
  it("orders roster, then opponent, then prominent; dedupes by text; caps length", () => {
    const news = feed([
      item({ id: "p1", playerId: "prom-a", change: "Prom A note", score: 90, sourcePublishedAt: "2026-10-10T18:00:00.000Z" }),
      item({ id: "o1", playerId: "opp-a", change: "Opp A note", score: 40, sourcePublishedAt: "2026-10-10T17:00:00.000Z" }),
      item({ id: "r1", playerId: "roster-a", change: "Roster A note", score: 20, sourcePublishedAt: "2026-10-10T16:00:00.000Z" }),
      item({ id: "p2", playerId: "prom-b", change: "Prom B note", score: 80, sourcePublishedAt: "2026-10-10T15:00:00.000Z" }),
      item({ id: "o2", playerId: "opp-b", change: "Opp B note", score: 50, sourcePublishedAt: "2026-10-10T14:00:00.000Z" }),
      item({ id: "r2", playerId: "roster-b", change: "Roster B note", score: 10, sourcePublishedAt: "2026-10-10T13:00:00.000Z" }),
      // Duplicate text of roster item — must not reappear in a later tier.
      item({ id: "dup", playerId: "prom-a", change: "Roster A note", score: 99, sourcePublishedAt: "2026-10-10T19:00:00.000Z" }),
      // Outside prominent set and below high-score threshold — excluded.
      item({ id: "noise", playerId: "benchwarmer", change: "Noise", score: 10 }),
      // High score qualifies without being in the prominent-id set.
      item({ id: "hot", playerId: "hot-waive", change: "Hot waive", score: 75 }),
      item({ id: "r3", playerId: "roster-c", change: "Roster C", score: 5 }),
      item({ id: "o3", playerId: "opp-c", change: "Opp C", score: 5 }),
      item({ id: "p3", playerId: "prom-c", change: "Prom C", score: 60 }),
    ]);

    const items = newsForTicker(
      news,
      new Set(["roster-a", "roster-b", "roster-c"]),
      new Set(["opp-a", "opp-b", "opp-c"]),
      new Set(["prom-a", "prom-b", "prom-c"]),
      { limit: 8 },
    );

    // Opponent tier sorts by score (o2 before o1); prominent fills remaining slots.
    expect(items.map((row) => row.id)).toEqual([
      "r1",
      "r2",
      "r3",
      "o2",
      "o1",
      "o3",
      "p1",
      "p2",
    ]);
    expect(items).toHaveLength(8);
    expect(items.length).toBeLessThanOrEqual(TICKER_NEWS_LIMIT);
    expect(items.some((row) => row.id === "dup" || row.id === "noise" || row.id === "hot")).toBe(false);
  });

  it("prefers higher score then newer publishedAt within a tier", () => {
    const news = feed([
      item({ id: "old-high", playerId: "a", change: "Old high", score: 90, sourcePublishedAt: "2026-10-09T00:00:00.000Z" }),
      item({ id: "new-low", playerId: "a", change: "New low", score: 10, sourcePublishedAt: "2026-10-11T00:00:00.000Z" }),
      item({ id: "mid", playerId: "a", change: "Mid", score: 90, sourcePublishedAt: "2026-10-10T00:00:00.000Z" }),
    ]);
    const items = newsForTicker(news, new Set(["a"]), new Set(), new Set());
    expect(items.map((row) => row.id)).toEqual(["mid", "old-high", "new-low"]);
  });

  it("treats high-score items as prominent when the player is not ranked", () => {
    const news = feed([
      item({ id: "hot", playerId: "waive", change: "Hot", score: 70 }),
      item({ id: "cold", playerId: "waive-2", change: "Cold", score: 69 }),
    ]);
    const items = newsForTicker(news, new Set(), new Set(), new Set());
    expect(items.map((row) => row.id)).toEqual(["hot"]);
  });

  it("drops legacy Sleeper timestamp-only news rows", () => {
    const news = feed([
      item({
        id: "ping",
        playerId: "a",
        change: "Player has a Sleeper news update.",
        roleContext: SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
      }),
      item({
        id: "real",
        playerId: "a",
        change: "Ankle sprain, day-to-day",
        roleContext: "New Sleeper injury notes.",
      }),
    ]);
    const items = newsForTicker(news, new Set(["a"]), new Set(), new Set());
    expect(items.map((row) => row.id)).toEqual(["real"]);
  });
});
