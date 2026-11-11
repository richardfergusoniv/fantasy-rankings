import { describe, expect, it } from "vitest";
import { monitorNews } from "./monitor-news";
import type { PlayerNews } from "../dashboard-types";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function item(over: Record<string, unknown>) {
  return {
    id: String(over.id ?? Math.random()), playerId: "p1", player: "Test Player", team: "KC", change: `Change ${over.id ?? ""}`,
    leagueIds: [], newsType: "headline", leagues: [], availability: [], roleContext: "", sourceLabel: "x", sourceUrl: `https://x.com/post/${over.id ?? "n"}`,
    sourcePublishedAt: hoursAgo(1), author: null, externalId: null, source: "x", signal: null, score: 50, tags: [], scope: "player", media: [],
    ...over,
  };
}
const feed = (items: unknown[]): PlayerNews => ({ lastCheckedAt: null, emptyReason: null, runs: [{ id: "r", checkedAt: hoursAgo(1), items }] } as unknown as PlayerNews);
const roster = (id: string, name: string, ids: string[], isDynasty = false) => ({
  id, name, seasonLongFormat: { isDynasty }, starters: ids.map((playerId) => ({ playerId })), bench: [],
}) as never;

describe("monitorNews", () => {
  it("keeps only news about players you roster and tags the leagues", () => {
    const result = monitorNews(feed([item({ id: "a", playerId: "p1" }), item({ id: "b", playerId: "other" })]), [roster("L1", "One", ["p1"]), roster("L2", "Two", ["p1"])], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.leagues.map((l) => l.id)).toEqual(["L1", "L2"]);
  });

  it("orders by score, then newest, and caps the list", () => {
    const items = [
      item({ id: "low", score: 30, playerId: "p1", change: "low" }),
      item({ id: "high", score: 90, playerId: "p2", change: "high", sourcePublishedAt: hoursAgo(20) }),
      item({ id: "newer", score: 90, playerId: "p3", change: "newer", sourcePublishedAt: hoursAgo(2) }),
    ];
    const leagues = [roster("L1", "One", ["p1", "p2", "p3"])];
    expect(monitorNews(feed(items), leagues, NOW).map((e) => e.item.id)).toEqual(["newer", "high", "low"]);
    expect(monitorNews(feed(items), leagues, NOW, 2)).toHaveLength(2);
  });

  it("drops news older than three days", () => {
    const old = item({ id: "old", sourcePublishedAt: hoursAgo(80) });
    expect(monitorNews(feed([old]), [roster("L1", "One", ["p1"])], NOW)).toEqual([]);
  });

  it("shows dynasty-tagged news only for dynasty leagues", () => {
    const dyn = item({ id: "d", tags: ["dynasty"] });
    expect(monitorNews(feed([dyn]), [roster("L1", "Redraft", ["p1"], false)], NOW)).toEqual([]);
    const both = monitorNews(feed([dyn]), [roster("L1", "Redraft", ["p1"], false), roster("L2", "Dynasty", ["p1"], true)], NOW);
    expect(both[0]!.leagues.map((l) => l.id)).toEqual(["L2"]);
  });

  it("lists a post that names several players once", () => {
    const a = item({ id: "a", playerId: "p1", externalId: "post-1" });
    const b = item({ id: "b", playerId: "p2", externalId: "post-1", change: "other text" });
    expect(monitorNews(feed([a, b]), [roster("L1", "One", ["p1", "p2"])], NOW)).toHaveLength(1);
  });

  it("ignores team and league news and returns nothing without a feed", () => {
    expect(monitorNews(feed([item({ id: "t", scope: "team" })]), [roster("L1", "One", ["p1"])], NOW)).toEqual([]);
    expect(monitorNews(undefined, [], NOW)).toEqual([]);
  });
});
