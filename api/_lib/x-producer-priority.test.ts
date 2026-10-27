import { describe, expect, it } from "vitest";
import type { SleeperPlayer } from "./sleeper.js";
import {
  X_PRODUCER_SEARCH_RANK_MAX,
  buildXProducerPrioritySet,
  collectRosteredPlayerIds,
  collectSearchRankPriorityIds,
} from "./x-producer-priority.js";

function player(
  overrides: Partial<SleeperPlayer> & { full_name: string },
): SleeperPlayer {
  return {
    team: "KC",
    status: "Active",
    position: "WR",
    search_rank: 100,
    ...overrides,
  };
}

describe("collectSearchRankPriorityIds", () => {
  it("keeps active skill+K at or below the search_rank ceiling", () => {
    const players: Record<string, SleeperPlayer> = {
      a: player({ full_name: "A", search_rank: 1 }),
      b: player({ full_name: "B", search_rank: X_PRODUCER_SEARCH_RANK_MAX }),
      c: player({ full_name: "C", search_rank: X_PRODUCER_SEARCH_RANK_MAX + 1 }),
      d: player({ full_name: "D", search_rank: null }),
      e: player({ full_name: "E", team: null, search_rank: 10 }),
      f: player({ full_name: "F", status: "Inactive", search_rank: 5 }),
      g: player({ full_name: "G", position: "DEF", search_rank: 2 }),
      h: player({ full_name: "H", status: "active", search_rank: 50 }),
    };
    expect([...collectSearchRankPriorityIds(players)].sort()).toEqual(["a", "b", "h"]);
  });
});

describe("collectRosteredPlayerIds", () => {
  it("unions every roster slot and skips leagues with null rosters", () => {
    const ids = collectRosteredPlayerIds([
      {
        rosters: [
          { playerIds: ["1", "2"] },
          { playerIds: ["2", "3"] },
        ],
      },
      { rosters: null },
      { rosters: [{ playerIds: ["3", "4"] }] },
    ]);
    expect([...ids].sort()).toEqual(["1", "2", "3", "4"]);
  });
});

describe("buildXProducerPrioritySet", () => {
  it("unions rostered ids with the search_rank cohort and tags reasons", () => {
    const players: Record<string, SleeperPlayer> = {
      "4046": player({ full_name: "Justin Jefferson", team: "MIN", search_rank: 3 }),
      "6794": player({ full_name: "Travis Kelce", team: "KC", position: "TE", search_rank: 25 }),
      "9999": player({ full_name: "Depth Chart", search_rank: 900 }),
      "1111": player({ full_name: "Only Rostered", search_rank: 500 }),
    };
    const result = buildXProducerPrioritySet({
      sleeperUserId: "owner-1",
      players,
      leagues: [
        {
          id: "L1",
          name: "Test",
          rosters: [
            { playerIds: ["1111", "4046"] },
            { playerIds: ["missing-meta"] },
          ],
        },
        { id: "L2", name: "Failed", rosters: null },
      ],
    });

    expect(result.sleeperUserId).toBe("owner-1");
    expect(result.leagueCount).toBe(2);
    expect(result.leaguesLoaded).toBe(1);
    expect(result.rosteredCount).toBe(3);
    expect(result.searchRankCount).toBe(2);
    expect(result.searchRankMax).toBe(X_PRODUCER_SEARCH_RANK_MAX);
    expect(result.playerIds).toEqual(["4046", "6794", "1111", "missing-meta"]);

    const byId = Object.fromEntries(result.players.map((row) => [row.playerId, row]));
    expect(byId["4046"]?.reasons).toEqual(["rostered", "search_rank"]);
    expect(byId["6794"]?.reasons).toEqual(["search_rank"]);
    expect(byId["1111"]?.reasons).toEqual(["rostered"]);
    expect(byId["missing-meta"]).toMatchObject({
      fullName: "missing-meta",
      team: null,
      searchRank: null,
      reasons: ["rostered"],
    });
  });
});
