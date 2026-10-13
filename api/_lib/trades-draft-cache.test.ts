import { describe, expect, it } from "vitest";
import {
  HISTORICAL_DRAFT_PICK_MAP_CACHE_MS,
  isDraftPickMapCacheFresh,
  nflSeasonYearAt,
} from "./trades.js";

describe("nflSeasonYearAt", () => {
  it("treats January and February as the prior NFL season", () => {
    expect(nflSeasonYearAt(Date.UTC(2026, 0, 15))).toBe(2025);
    expect(nflSeasonYearAt(Date.UTC(2026, 1, 28))).toBe(2025);
  });

  it("uses the calendar year from March onward", () => {
    expect(nflSeasonYearAt(Date.UTC(2026, 2, 1))).toBe(2026);
    expect(nflSeasonYearAt(Date.UTC(2026, 9, 13))).toBe(2026);
  });
});

describe("isDraftPickMapCacheFresh", () => {
  const now = Date.UTC(2026, 9, 13, 12); // Oct 13 2026 → season 2026
  const ttl = HISTORICAL_DRAFT_PICK_MAP_CACHE_MS;

  it("never expires past-season-only maps", () => {
    const fetchedAt = new Date(now - ttl * 10);
    expect(isDraftPickMapCacheFresh(fetchedAt, [2024, 2025], now, ttl)).toBe(true);
  });

  it("expires a current-season map after the TTL", () => {
    const stale = new Date(now - ttl - 1);
    const fresh = new Date(now - ttl + 1_000);
    expect(isDraftPickMapCacheFresh(stale, [2025, 2026], now, ttl)).toBe(false);
    expect(isDraftPickMapCacheFresh(fresh, [2026], now, ttl)).toBe(true);
  });

  it("keeps a current-season map within the TTL", () => {
    const fetchedAt = new Date(now - 60_000);
    expect(isDraftPickMapCacheFresh(fetchedAt, [2026], now, ttl)).toBe(true);
  });
});
