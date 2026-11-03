import { describe, expect, it } from "vitest";
import {
  parseStoredPlayoffOdds,
  playoffOddsCacheKey,
  PLAYOFF_ODDS_STORE_TTL_MS,
  type StoredPlayoffOdds,
} from "./playoff-odds-store.js";
import type { ProjectedPlayoffOdds } from "./projected-playoff-odds.js";
import type { ProjectedStandings } from "./projected-standings.js";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");

function entry(overrides: Partial<StoredPlayoffOdds> = {}): StoredPlayoffOdds {
  return {
    season: 2026,
    week: 9,
    computedAt: new Date(NOW - 60_000).toISOString(),
    projected: { leagueId: "L1" } as unknown as ProjectedStandings,
    odds: { trials: 20_000 } as unknown as ProjectedPlayoffOdds,
    ...overrides,
  };
}

describe("playoffOddsCacheKey", () => {
  it("is namespaced per user and league", () => {
    expect(playoffOddsCacheKey("user-1", "league-9")).toBe("playoff-odds-v1:user-1:league-9");
  });
});

describe("parseStoredPlayoffOdds", () => {
  it("accepts a fresh row for the same season and week", () => {
    const stored = entry();
    expect(parseStoredPlayoffOdds(stored, 2026, 9, NOW)).toEqual(stored);
  });

  it("rejects another season or week", () => {
    expect(parseStoredPlayoffOdds(entry(), 2025, 9, NOW)).toBeNull();
    expect(parseStoredPlayoffOdds(entry(), 2026, 10, NOW)).toBeNull();
    expect(parseStoredPlayoffOdds(entry({ season: 2025 }), 2026, 9, NOW)).toBeNull();
  });

  it("rejects a row older than the TTL and one dated in the future", () => {
    const stale = entry({ computedAt: new Date(NOW - PLAYOFF_ODDS_STORE_TTL_MS - 1).toISOString() });
    expect(parseStoredPlayoffOdds(stale, 2026, 9, NOW)).toBeNull();
    const future = entry({ computedAt: new Date(NOW + 60_000).toISOString() });
    expect(parseStoredPlayoffOdds(future, 2026, 9, NOW)).toBeNull();
    const boundary = entry({ computedAt: new Date(NOW - PLAYOFF_ODDS_STORE_TTL_MS).toISOString() });
    expect(parseStoredPlayoffOdds(boundary, 2026, 9, NOW)).not.toBeNull();
  });

  it("rejects non-objects and rows missing either half", () => {
    expect(parseStoredPlayoffOdds(null, 2026, 9, NOW)).toBeNull();
    expect(parseStoredPlayoffOdds("row", 2026, 9, NOW)).toBeNull();
    expect(parseStoredPlayoffOdds(entry({ projected: undefined }), 2026, 9, NOW)).toBeNull();
    expect(parseStoredPlayoffOdds(entry({ odds: undefined }), 2026, 9, NOW)).toBeNull();
    expect(parseStoredPlayoffOdds(entry({ computedAt: "not a date" }), 2026, 9, NOW)).toBeNull();
  });
});
