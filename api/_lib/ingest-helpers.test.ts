import { describe, expect, it } from "vitest";
import { CACHE_KEY } from "./dashboard-schemas.js";
import {
  DASHBOARD_USER_CACHE_PREFIX,
  isDashboardCacheKey,
  stagedMatchupGradesSchema,
  stagedPfnTablesSchema,
  vegasProjectionPayloadSchema,
} from "./ingest-helpers.js";

const emptyPfnTable = {
  label: "Offense",
  columns: ["rank", "team"],
  column_labels: { rank: "Rank", team: "Team" },
  rows: [{ rank: 1, team: "KC", team_name: "Chiefs" }],
};

describe("isDashboardCacheKey", () => {
  it("matches the global cache key and every dashboard:user: prefix", () => {
    expect(isDashboardCacheKey(CACHE_KEY)).toBe(true);
    expect(isDashboardCacheKey(`${DASHBOARD_USER_CACHE_PREFIX}abc`)).toBe(true);
    expect(isDashboardCacheKey(`${DASHBOARD_USER_CACHE_PREFIX}abc:meta`)).toBe(true);
    expect(isDashboardCacheKey(`${DASHBOARD_USER_CACHE_PREFIX}abc:trade-waiver`)).toBe(true);
  });

  it("rejects unrelated source_cache keys", () => {
    expect(isDashboardCacheKey("strength-of-schedule-v1:1")).toBe(false);
    expect(isDashboardCacheKey("pfn:offense")).toBe(false);
    expect(isDashboardCacheKey("dashboard-live-projections-v24")).toBe(false);
  });
});

describe("ingest timestamp schemas", () => {
  it("accepts ISO datetimes on matchup-grades built_at and computed_at", () => {
    const parsed = stagedMatchupGradesSchema.safeParse({
      source: "matchup-grades",
      season: 2026,
      through_week: 6,
      built_at: "2026-10-12T10:00:00.000Z",
      leagues: [
        {
          league_id: "L1",
          league_name: "Test",
          through_week: 6,
          completed_weeks: [1, 2, 3, 4, 5, 6],
          computed_at: "2026-10-12T09:59:00.000Z",
          table: {
            KC: {
              QB: { avg: 1, weeks: 6, rank: 1 },
              RB: { avg: 1, weeks: 6, rank: 1 },
              WR: { avg: 1, weeks: 6, rank: 1 },
              TE: { avg: 1, weeks: 6, rank: 1 },
            },
          },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-datetime built_at / computed_at before any write", () => {
    const badBuilt = stagedMatchupGradesSchema.safeParse({
      source: "matchup-grades",
      season: 2026,
      through_week: 6,
      built_at: "not-a-date",
      leagues: [],
    });
    expect(badBuilt.success).toBe(false);

    const badComputed = stagedMatchupGradesSchema.safeParse({
      source: "matchup-grades",
      season: 2026,
      through_week: 6,
      built_at: "2026-10-12T10:00:00.000Z",
      leagues: [
        {
          league_id: "L1",
          league_name: "Test",
          through_week: 6,
          completed_weeks: [],
          computed_at: "yesterday",
          table: {},
        },
      ],
    });
    expect(badComputed.success).toBe(false);
  });

  it("requires datetime fetched_at on pfn-tables", () => {
    const good = stagedPfnTablesSchema.safeParse({
      source: "pfn-nfl-hq",
      fetched_at: "2026-10-12T10:00:00.000Z",
      tables: {
        "offensive-line": emptyPfnTable,
        offense: emptyPfnTable,
        defense: emptyPfnTable,
        "team-overall": emptyPfnTable,
      },
    });
    expect(good.success).toBe(true);

    const bad = stagedPfnTablesSchema.safeParse({
      source: "pfn-nfl-hq",
      fetched_at: "Oct 12",
      tables: {
        "offensive-line": emptyPfnTable,
        offense: emptyPfnTable,
        defense: emptyPfnTable,
        "team-overall": emptyPfnTable,
      },
    });
    expect(bad.success).toBe(false);
  });

  it("keeps projections built_at as datetime (unchanged contract)", () => {
    expect(
      vegasProjectionPayloadSchema.safeParse({
        season: 2026,
        week: 6,
        built_at: "not-iso",
        source: "test",
        leagues: [],
        projections: [],
      }).success,
    ).toBe(false);
    expect(
      vegasProjectionPayloadSchema.safeParse({
        season: 2026,
        week: 6,
        built_at: "2026-10-12T10:00:00.000Z",
        source: "test",
        leagues: [],
        projections: [],
      }).success,
    ).toBe(true);
  });
});
