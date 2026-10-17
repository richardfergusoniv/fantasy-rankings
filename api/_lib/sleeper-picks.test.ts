import { describe, expect, it } from "vitest";
import {
  buildSleeperPickMap,
  normalizeSleeperPicksBoard,
  parseStoredSleeperPicks,
  sleeperPicksCacheKey,
} from "./sleeper-picks.js";

function market(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sport: "nfl",
    status: "active",
    subject_id: "4984",
    subject_type: "player",
    wager_type: "passing_yards",
    options: [
      { outcome: "over", outcome_value: 285.5, payout_multiplier: "1.82" },
      { outcome: "under", outcome_value: 285.5, payout_multiplier: "1.79" },
    ],
    ...overrides,
  };
}

describe("normalizeSleeperPicksBoard", () => {
  it("maps wager types to canonical stats and parses string multipliers", () => {
    const lines = normalizeSleeperPicksBoard([market()]);
    expect(lines).toEqual([{
      playerId: "4984",
      stat: "pass_yards",
      line: 285.5,
      overMultiplier: 1.82,
      underMultiplier: 1.79,
    }]);
  });

  it("drops non-NFL, inactive, non-player, and unmapped markets", () => {
    const lines = normalizeSleeperPicksBoard([
      market({ sport: "nba" }),
      market({ status: "suspended" }),
      market({ subject_type: "team" }),
      market({ wager_type: "fantasy_points" }),
      market({ wager_type: "passing_and_rushing_yards" }),
      market(),
    ]);
    expect(lines).toHaveLength(1);
  });

  it("keeps a market with only one side and a null multiplier for the other", () => {
    const lines = normalizeSleeperPicksBoard([
      market({ options: [{ outcome: "over", outcome_value: 0.5, payout_multiplier: "3.10" }] }),
    ]);
    expect(lines[0]).toMatchObject({ line: 0.5, overMultiplier: 3.1, underMultiplier: null });
  });
});

describe("stored board round-trip", () => {
  it("parses a stored board and builds the join map", () => {
    const board = parseStoredSleeperPicks({
      pulledAt: "2026-10-16T10:00:00.000Z",
      lines: [
        { playerId: "4984", stat: "pass_yards", line: 285.5, overMultiplier: 1.82, underMultiplier: 1.79 },
        { playerId: "4984", stat: "not_a_stat", line: 1, overMultiplier: null, underMultiplier: null },
      ],
    });
    expect(board?.lines).toHaveLength(1);
    const map = buildSleeperPickMap(board?.lines ?? []);
    expect(map.get("4984|pass_yards")?.line).toBe(285.5);
    expect(sleeperPicksCacheKey(2026, 7)).toBe("sleeper-picks:2026:7");
  });

  it("rejects malformed stored payloads", () => {
    expect(parseStoredSleeperPicks(null)).toBeNull();
    expect(parseStoredSleeperPicks({ pulledAt: 5, lines: [] })).toBeNull();
  });
});
