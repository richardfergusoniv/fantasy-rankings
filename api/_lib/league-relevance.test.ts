import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  classifyPlayer,
  leagueRostersCacheKey,
  relevantNewsForUser,
  userLeaguesCacheKey,
  type LeagueRosters,
} from "./league-relevance.js";

const leagues: LeagueRosters[] = [
  {
    id: "league-a",
    name: "Friends League",
    rosters: [
      { ownerId: "user-1", playerIds: ["111", "222"] },
      { ownerId: "user-2", playerIds: ["333"] },
    ],
  },
  {
    id: "league-b",
    name: "Other League",
    rosters: [
      { ownerId: "user-1", playerIds: ["444"] },
      { ownerId: "user-3", playerIds: ["111"] },
    ],
  },
];

const items = [
  { playerId: "111", newsType: "roster" as const, change: "own" },
  { playerId: "333", newsType: "roster" as const, change: "opponent" },
  { playerId: "999", newsType: "waiver" as const, change: "free agent" },
  { playerId: "league", newsType: "headline" as const, change: "league-wide" },
];

describe("classifyPlayer", () => {
  it("marks the signed-in user's own player", () => {
    assert.equal(classifyPlayer("111", "user-1", leagues[0]!).status, "your_roster");
  });

  it("marks another team in the same league as an opponent", () => {
    assert.equal(classifyPlayer("333", "user-1", leagues[0]!).status, "other_roster");
  });

  it("marks a player on nobody's roster as a free agent", () => {
    assert.equal(classifyPlayer("999", "user-1", leagues[0]!).status, "available");
  });

  it("marks the league unknown when its roster request failed", () => {
    assert.equal(
      classifyPlayer("111", "user-1", { ...leagues[0]!, rosters: null }).status,
      "unknown",
    );
  });

  it("classifies one shared league differently for two friends", () => {
    assert.equal(classifyPlayer("333", "user-2", leagues[0]!).status, "your_roster");
    assert.equal(classifyPlayer("333", "user-1", leagues[0]!).status, "other_roster");
  });
});

describe("relevantNewsForUser", () => {
  it("returns an empty feed when the user has no leagues", () => {
    assert.deepEqual(relevantNewsForUser(items, "user-1", []), []);
  });

  it("keeps own players, opponents, and free agents, and names only leagues that roster them", () => {
    const relevant = relevantNewsForUser(items, "user-1", leagues);
    const byId = new Map(relevant.map((item) => [item.playerId, item]));
    assert.equal(byId.get("111")?.availability.find((row) => row.leagueId === "league-a")?.status, "your_roster");
    assert.equal(byId.get("111")?.availability.find((row) => row.leagueId === "league-b")?.status, "other_roster");
    assert.deepEqual(byId.get("111")?.leagues, ["Friends League", "Other League"]);
    assert.equal(byId.get("333")?.availability[0]?.status, "other_roster");
    assert.equal(byId.get("333")?.leagues[0], "Friends League");
    assert.equal(byId.get("999")?.availability.every((row) => row.status === "available"), true);
    assert.deepEqual(byId.get("999")?.leagueIds, []);
    assert.deepEqual(byId.get("league")?.leagues, []);
    assert.equal(relevant.length, 4);
  });

  it("drops player news when every roster lookup failed, and still keeps a league headline", () => {
    const failed = leagues.map((league) => ({ ...league, rosters: null }));
    const relevant = relevantNewsForUser(items, "user-1", failed);
    assert.deepEqual(relevant.map((item) => item.playerId), ["league"]);
  });

  it("does not treat a player rostered only outside the viewer's leagues as one of their rostered names", () => {
    const outsider = relevantNewsForUser(
      [{ playerId: "555", newsType: "roster" as const }],
      "user-1",
      leagues,
    );
    assert.equal(outsider.length, 1);
    assert.deepEqual(outsider[0]?.leagues, []);
    assert.equal(outsider[0]?.availability.every((row) => row.status === "available"), true);
  });
});

describe("league cache keys", () => {
  it("keeps each user's league list separate and shares roster caches by league id", () => {
    assert.notEqual(userLeaguesCacheKey("user-1", 2026), userLeaguesCacheKey("user-2", 2026));
    assert.notEqual(userLeaguesCacheKey("user-1", 2026), userLeaguesCacheKey("user-1", 2025));
    assert.equal(leagueRostersCacheKey("league-a"), leagueRostersCacheKey("league-a"));
    assert.notEqual(leagueRostersCacheKey("league-a"), leagueRostersCacheKey("league-b"));
  });
});
