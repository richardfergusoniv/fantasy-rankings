import { describe, expect, it } from "vitest";
import {
  DRAFT_MARKET_CACHE_KEY,
  draftMarketCacheKey,
  ffcFormatForLeague,
  type SleeperLeague,
} from "./sleeper.js";

function league(overrides: Partial<SleeperLeague> & Pick<SleeperLeague, "league_id" | "name">): SleeperLeague {
  return {
    total_rosters: 12,
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "WR", "TE"],
    settings: { type: 0 },
    ...overrides,
  };
}

describe("draftMarketCacheKey", () => {
  it("includes season and sorted unique format:team pairs", () => {
    const leagues = [
      league({ league_id: "1", name: "PPR 12", total_rosters: 12, scoring_settings: { rec: 1 } }),
      league({ league_id: "2", name: "Half 10", total_rosters: 10, scoring_settings: { rec: 0.5 } }),
      league({ league_id: "3", name: "PPR 12 dup", total_rosters: 12, scoring_settings: { rec: 1 } }),
    ];
    expect(draftMarketCacheKey(2026, leagues)).toBe(
      `${DRAFT_MARKET_CACHE_KEY}:2026:half-ppr:10,ppr:12`,
    );
  });

  it("differs across seasons and format sets so callers do not share ADP", () => {
    const ppr = [league({ league_id: "1", name: "PPR", total_rosters: 12, scoring_settings: { rec: 1 } })];
    const half = [league({ league_id: "2", name: "Half", total_rosters: 12, scoring_settings: { rec: 0.5 } })];
    expect(draftMarketCacheKey(2026, ppr)).not.toBe(draftMarketCacheKey(2026, half));
    expect(draftMarketCacheKey(2026, ppr)).not.toBe(draftMarketCacheKey(2025, ppr));
  });

  it("adds a rookie pool entry for dynasty leagues", () => {
    const dynasty = [
      league({
        league_id: "d1",
        name: "Dynasty SF",
        total_rosters: 12,
        scoring_settings: { rec: 1 },
        roster_positions: ["QB", "QB", "RB", "WR", "TE", "SUPER_FLEX"],
        settings: { type: 2 },
      }),
    ];
    expect(ffcFormatForLeague(dynasty[0]!)).toBe("2qb");
    expect(draftMarketCacheKey(2026, dynasty)).toBe(
      `${DRAFT_MARKET_CACHE_KEY}:2026:2qb:12,rookie:12`,
    );
  });

  it("uses a stable empty-league suffix", () => {
    expect(draftMarketCacheKey(2026, [])).toBe(`${DRAFT_MARKET_CACHE_KEY}:2026:none`);
  });
});
