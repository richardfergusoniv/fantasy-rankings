import { describe, expect, it } from "vitest";
import { DYNASTY_NEWS_TAG, SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT } from "../../api/_lib/player-news-filters";
import type { PlayerNews, PlayerNewsItem } from "./dashboard-types";
import { newsForTicker, TICKER_NEWS_LIMIT } from "./ticker-news";

function item(partial: {
  id: string;
  playerId: string | null;
  change: string;
  score?: number | null;
  sourcePublishedAt?: string | null;
  roleContext?: string;
  sourceUrl?: string;
  externalId?: string | null;
  source?: "sleeper" | "x" | "nflverse";
  tags?: string[];
  scope?: "player" | "team" | "league";
  player?: string;
  team?: string | null;
}): PlayerNewsItem {
  const scope = partial.scope ?? "player";
  return {
    id: partial.id,
    playerId: partial.playerId,
    player: partial.player ?? (scope === "league" ? "NFL" : scope === "team" ? (partial.team ?? "DET") : "Player"),
    team: partial.team === undefined ? (scope === "league" ? null : "MIN") : partial.team,
    change: partial.change,
    leagueIds: [],
    newsType: "roster",
    leagues: [],
    availability: [],
    roleContext: partial.roleContext ?? "",
    sourceLabel: "Sleeper",
    // Default URL/externalId are unique per item so post-level grouping does
    // not collapse unrelated Sleeper rows that share a placeholder URL.
    sourceUrl: partial.sourceUrl ?? `https://sleeper.app/news/${partial.id}`,
    sourcePublishedAt: partial.sourcePublishedAt ?? "2026-10-10T12:00:00.000Z",
    author: null,
    externalId: partial.externalId === undefined
      ? `fixture:${partial.id}`
      : partial.externalId,
    source: partial.source ?? "sleeper",
    signal: null,
    score: partial.score ?? null,
    tags: partial.tags ?? [],
    scope,
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

  it("collapses a multi-player X roundup to one ticker item by post_id", () => {
    const roundup = "Wednesday practice: Amon-Ra DNP, Gibbs limited, LaPorta full.";
    const postId = "2115569505300811921";
    const sourceUrl = `https://x.com/r/status/${postId}`;
    const news = feed([
      item({
        id: "x-a",
        playerId: "roster-a",
        change: roundup,
        source: "x",
        externalId: postId,
        sourceUrl,
        score: 80,
      }),
      item({
        id: "x-b",
        playerId: "roster-b",
        change: `${roundup} (Gibbs)`,
        source: "x",
        externalId: postId,
        sourceUrl,
        score: 70,
      }),
      item({
        id: "x-c",
        playerId: "opp-a",
        change: `${roundup} (LaPorta)`,
        source: "x",
        externalId: postId,
        sourceUrl,
        score: 60,
      }),
      item({
        id: "other",
        playerId: "roster-c",
        change: "Separate injury note",
        score: 50,
        sourceUrl: "https://sleeper.app/other",
        externalId: "injury-notes:roster-c:abc",
      }),
    ]);

    const items = newsForTicker(
      news,
      new Set(["roster-a", "roster-b", "roster-c"]),
      new Set(["opp-a"]),
      new Set(),
    );
    expect(items.map((row) => row.id)).toEqual(["x-a", "other"]);
  });

  it("hides dynasty-tagged rows in redraft and shows them in dynasty; untagged always show", () => {
    const news = feed([
      item({
        id: "dynasty",
        playerId: "a",
        change: "Dynasty-only note",
        tags: [DYNASTY_NEWS_TAG],
        score: 90,
      }),
      item({
        id: "plain",
        playerId: "a",
        change: "Untagged note",
        score: 80,
      }),
    ]);
    expect(
      newsForTicker(news, new Set(["a"]), new Set(), new Set()).map((row) => row.id),
    ).toEqual(["plain"]);
    expect(
      newsForTicker(news, new Set(["a"]), new Set(), new Set(), { isDynastyContext: true })
        .map((row) => row.id),
    ).toEqual(["dynasty", "plain"]);
  });

  it("includes team and league scoped X items after roster/opponent tiers", () => {
    const news = feed([
      item({ id: "r1", playerId: "roster-a", change: "Roster note", score: 20 }),
      item({ id: "o1", playerId: "opp-a", change: "Opponent note", score: 30 }),
      item({
        id: "team-1",
        playerId: null,
        scope: "team",
        team: "DET",
        change: "Lions defense vs WR pace",
        score: 40,
        source: "x",
        externalId: "team-post",
        sourceUrl: "https://x.com/r/status/team-post",
      }),
      item({
        id: "league-1",
        playerId: null,
        scope: "league",
        team: null,
        change: "League-wide route tree note",
        score: 55,
        source: "x",
        externalId: "league-post",
        sourceUrl: "https://x.com/r/status/league-post",
      }),
      item({ id: "prom", playerId: "prom-a", change: "Prom note", score: 90 }),
      // Low-score non-roster player news stays out unless prominent.
      item({ id: "noise", playerId: "bench", change: "Noise", score: 10 }),
    ]);

    const items = newsForTicker(
      news,
      new Set(["roster-a"]),
      new Set(["opp-a"]),
      new Set(["prom-a"]),
      { limit: 10 },
    );
    expect(items.map((row) => row.id)).toEqual(["r1", "o1", "league-1", "team-1", "prom"]);
  });
});
