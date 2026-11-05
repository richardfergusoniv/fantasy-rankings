import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

const {
  csvObjects,
  depthFromRows,
  previousDepthFromRows,
  mergeNgsSources,
  parseNgs,
  epComponentStats,
  parseOpportunity,
  playerInsightsNeedsComponentsMigration,
  parsePlayerIds,
  playerInsightsNeedsAnalyticsMigration,
  playerInsightsNeedsSleeperIdMigration,
  playerInsightsSnapshotSchema,
  retainSleeperByGsisFromPrevious,
  applyInsightsRetentionFallbacks,
} = await import("./player-insights");

describe("csvObjects", () => {
  it("keys cells by header and keeps quoted commas", () => {
    expect(csvObjects('a,b\n1,"x, y"\n\n2,z\n')).toEqual([
      { a: "1", b: "x, y" },
      { a: "2", b: "z" },
    ]);
  });
});

describe("parseOpportunity", () => {
  const csv = [
    "season,week,player_id,total_fantasy_points,total_fantasy_points_exp",
    "2026,2,00-1,18.64,21.04",
    "2026,1,00-1,29.1,26.3",
    "2026,3,NA,10,10",
    "2025,1,00-2,5,5",
    "2026,19,00-1,40,40",
  ].join("\n");

  it("sums one season's regular-season games per player, weeks in order", () => {
    expect(parseOpportunity(csv)).toEqual({
      "00-1": { games: 2, expected: 47.3, actual: 47.7, weeks: [[1, 26.3, 29.1], [2, 21, 18.6]], componentWeeks: [] },
    });
  });
});

describe("ep components", () => {
  const csv = [
    "season,week,player_id,total_fantasy_points,total_fantasy_points_exp,receptions_exp,rec_yards_gained_exp,rec_touchdown_exp,rush_yards_gained_exp,pass_yards_gained_exp,pass_touchdown_exp,pass_interception_exp,rec_first_down_exp,pass_two_point_conv_exp,rec_two_point_conv_exp",
    "2026,1,00-9,20,22,6,80,0.4,10,0,0,0,3,0,1",
    "2026,2,00-9,10,12,4,50,0.1,30,0,0,0,2,0,0",
  ].join("\n");

  it("maps ep_weekly component columns onto Sleeper scoring keys", () => {
    expect(epComponentStats({
      receptions_exp: "6", rec_yards_gained_exp: "80", rec_touchdown_exp: "0.4",
      rush_yards_gained_exp: "10", pass_interception_exp: "0.2",
      pass_two_point_conv_exp: "0.1", rec_two_point_conv_exp: "0.2", rush_two_point_conv_exp: "0",
    })).toEqual({ rec: 6, rec_yd: 80, rec_td: 0.4, rush_yd: 10, pass_int: 0.2, pass_2pt: 0.1, rec_2pt: 0.2 });
  });

  it("keeps per-week components alongside the totals, in week order", () => {
    const parsed = parseOpportunity(csv);
    expect(parsed["00-9"]?.componentWeeks).toEqual([
      { week: 1, stats: { rec: 6, rec_yd: 80, rec_td: 0.4, rush_yd: 10, rec_fd: 3, rec_2pt: 1 } },
      { week: 2, stats: { rec: 4, rec_yd: 50, rec_td: 0.1, rush_yd: 30, rec_fd: 2 } },
    ]);
  });

  it("flags snapshots whose opportunity rows carry no components as stale", () => {
    const base = {
      fetchedAt: new Date().toISOString(),
      season: 2026 as const,
      ngs: {},
      depth: {},
      depthAsOf: null,
      depthPrevious: {},
      sleeperByGsis: { "00-9": "123" },
    };
    expect(playerInsightsNeedsComponentsMigration({
      ...base,
      opportunity: { "00-9": { games: 1, expected: 10, actual: 9, weeks: [[1, 10, 9]], componentWeeks: [] } },
    })).toBe(true);
    expect(playerInsightsNeedsComponentsMigration({
      ...base,
      opportunity: { "00-9": { games: 1, expected: 10, actual: 9, weeks: [[1, 10, 9]], componentWeeks: [{ week: 1, stats: { rec: 5 } }] } },
    })).toBe(false);
    expect(playerInsightsNeedsComponentsMigration({ ...base, opportunity: {} })).toBe(false);
  });
});

describe("parseNgs", () => {
  it("keeps only season rows (week 0) and merges files by gsis id", () => {
    const receiving = [
      "season,season_type,week,player_gsis_id,avg_separation,avg_cushion,avg_yac_above_expectation,percent_share_of_intended_air_yards",
      "2026,REG,0,00-1,2.7006,6.457,2.011,24.72",
      "2026,REG,6,00-1,9,9,9,9",
      "2025,REG,0,00-1,1,1,1,1",
    ].join("\n");
    const rushing = [
      "season,season_type,week,player_gsis_id,rush_yards_over_expected_per_att,percent_attempts_gte_eight_defenders,efficiency",
      "2026,REG,0,00-1,0.456,NA,3.9",
    ].join("\n");
    const merged = parseNgs(rushing, "rushing", parseNgs(receiving, "receiving"));
    expect(merged).toEqual({
      "00-1": {
        separation: 2.7,
        cushion: 6.46,
        yac_over_expected: 2.01,
        intended_air_share: 24.72,
        rush_yards_over_expected: 0.46,
        rush_efficiency: 3.9,
      },
    });
  });
});

describe("mergeNgsSources", () => {
  it("merges files by gsis id", () => {
    expect(mergeNgsSources([{ "00-1": { separation: 2.7 } }, { "00-1": { rush_efficiency: 3.9 } }, { "00-2": { time_to_throw: 2.8 } }])).toEqual({
      "00-1": { separation: 2.7, rush_efficiency: 3.9 },
      "00-2": { time_to_throw: 2.8 },
    });
  });

  it("is empty when any file had no season rows, so the previous set is kept", () => {
    expect(mergeNgsSources([{ "00-1": { separation: 2.7 } }, {}, { "00-2": { time_to_throw: 2.8 } }])).toEqual({});
  });
});

describe("ids and depth", () => {
  const ids = parsePlayerIds([
    "gsis_id,sleeper_id,name",
    "00-1,12526,Puka Nacua",
    "00-2,NA,No Sleeper",
    "00-3,4034,Davante Adams",
  ].join("\n"));

  it("maps gsis ids to Sleeper ids", () => {
    expect(ids.sleeperByGsis.get("00-1")).toBe("12526");
    expect(ids.sleeperByGsis.has("00-2")).toBe(false);
  });

  it("ranks skill players on the newest chart only, best slot wins", () => {
    const rows = [
      { dt: "2026-10-22T12:59:29Z", gsis_id: "00-1", pos_abb: "WR", pos_rank: "1" },
      { dt: "2026-10-22T12:59:29Z", gsis_id: "00-3", pos_abb: "WR", pos_rank: "7" },
      { dt: "2026-10-22T12:59:29Z", gsis_id: "00-3", pos_abb: "WR", pos_rank: "3" },
      { dt: "2026-10-22T12:59:29Z", gsis_id: "00-1", pos_abb: "LDE", pos_rank: "1" },
      { dt: "2026-10-21T12:59:29Z", gsis_id: "00-1", pos_abb: "WR", pos_rank: "2" },
    ];
    expect(depthFromRows(rows, ids.sleeperByGsis)).toEqual({
      depth: { "12526": { position: "WR", rank: 1 }, "4034": { position: "WR", rank: 3 } },
      asOf: "2026-10-22T12:59:29Z",
    });
  });

  it("reads the oldest earlier chart as the previous ranks", () => {
    const rows = [
      { dt: "2026-10-22T12:59:29Z", gsis_id: "00-1", pos_abb: "WR", pos_rank: "1" },
      { dt: "2026-10-22T12:59:29Z", gsis_id: "00-3", pos_abb: "WR", pos_rank: "3" },
      { dt: "2026-10-18T12:59:29Z", gsis_id: "00-1", pos_abb: "WR", pos_rank: "2" },
      { dt: "2026-10-16T12:59:29Z", gsis_id: "00-1", pos_abb: "WR", pos_rank: "3" },
      { dt: "2026-10-16T12:59:29Z", gsis_id: "00-3", pos_abb: "WR", pos_rank: "1" },
    ];
    expect(previousDepthFromRows(rows, ids.sleeperByGsis)).toEqual({
      "12526": { position: "WR", rank: 3 },
      "4034": { position: "WR", rank: 1 },
    });
  });

  it("has no previous ranks when only one chart was read", () => {
    const rows = [{ dt: "2026-10-22T12:59:29Z", gsis_id: "00-1", pos_abb: "WR", pos_rank: "1" }];
    expect(previousDepthFromRows(rows, ids.sleeperByGsis)).toEqual({});
  });
});

describe("playerInsightsSnapshotSchema", () => {
  it("accepts a snapshot built from the parsers", () => {
    expect(playerInsightsSnapshotSchema.safeParse({
      fetchedAt: "2026-10-22T18:00:00.000Z",
      season: 2026,
      opportunity: { "00-1": { games: 1, expected: 20, actual: 22, weeks: [[1, 20, 22]] } },
      ngs: { "00-1": { separation: 2.7 } },
      depth: { "12526": { position: "WR", rank: 1 } },
      depthAsOf: null,
    }).success).toBe(true);
  });

  it("defaults the previous depth ranks for a snapshot cached before they existed", () => {
    const parsed = playerInsightsSnapshotSchema.parse({
      fetchedAt: "2026-10-22T18:00:00.000Z",
      season: 2026,
      opportunity: {},
      ngs: {},
      depth: {},
      depthAsOf: null,
    });
    expect(parsed.depthPrevious).toEqual({});
    expect(parsed.sleeperByGsis).toBeUndefined();
  });
});

describe("playerInsightsNeedsAnalyticsMigration", () => {
  const base = {
    fetchedAt: "2026-10-22T18:00:00.000Z",
    season: 2026 as const,
    opportunity: {},
    ngs: {},
    depth: {},
    depthAsOf: null,
    depthPrevious: {},
  };

  it("flags snapshots that omit the analytics precompute", () => {
    expect(playerInsightsNeedsAnalyticsMigration({ ...base })).toBe(true);
    expect(playerInsightsNeedsAnalyticsMigration({
      ...base,
      analytics: { computedAt: "2026-10-22T18:00:00.000Z", throughWeek: 7, entities: [], teamUsage: [] },
    })).toBe(false);
  });

  it("parses snapshots with and without the precompute", () => {
    const without = playerInsightsSnapshotSchema.parse({ ...base });
    expect(without.analytics).toBeUndefined();
    const withPrecompute = playerInsightsSnapshotSchema.parse({
      ...base,
      analytics: { computedAt: "2026-10-22T18:00:00.000Z", throughWeek: null, entities: [], teamUsage: [] },
    });
    expect(withPrecompute.analytics?.throughWeek).toBeNull();
  });
});

describe("playerInsightsNeedsSleeperIdMigration", () => {
  const base = {
    fetchedAt: "2026-10-22T18:00:00.000Z",
    season: 2026 as const,
    opportunity: {},
    ngs: {},
    depth: {},
    depthAsOf: null,
    depthPrevious: {},
  };

  it("flags snapshots that omit sleeperByGsis or carry an empty map", () => {
    expect(playerInsightsNeedsSleeperIdMigration({ ...base })).toBe(true);
    expect(playerInsightsNeedsSleeperIdMigration({ ...base, sleeperByGsis: {} })).toBe(true);
    expect(playerInsightsNeedsSleeperIdMigration({ ...base, sleeperByGsis: { "00-1": "12526" } })).toBe(false);
  });

  it("retains a previous sleeperByGsis map when the new snapshot map is empty", () => {
    const next = { ...base, sleeperByGsis: {} };
    retainSleeperByGsisFromPrevious(next, { ...base, sleeperByGsis: { "00-1": "12526" } });
    expect(next.sleeperByGsis).toEqual({ "00-1": "12526" });

    const populated = { ...base, sleeperByGsis: { "00-2": "4034" } };
    retainSleeperByGsisFromPrevious(populated, { ...base, sleeperByGsis: { "00-1": "12526" } });
    expect(populated.sleeperByGsis).toEqual({ "00-2": "4034" });
  });
});

describe("applyInsightsRetentionFallbacks", () => {
  const base = {
    fetchedAt: "2026-10-22T18:00:00.000Z",
    season: 2026 as const,
    opportunity: {},
    ngs: {},
    depth: {},
    depthAsOf: null,
    depthPrevious: {},
    sleeperByGsis: {},
  };

  it("fills empty NGS, depth, and id map slices from the previous snapshot", () => {
    const next = { ...base };
    applyInsightsRetentionFallbacks(next, {
      ...base,
      ngs: { "00-1": { separation: 2.7 } },
      depth: { "12526": { position: "WR", rank: 1 } },
      depthAsOf: "2026-10-21T00:00:00.000Z",
      depthPrevious: { "12526": { position: "WR", rank: 2 } },
      sleeperByGsis: { "00-1": "12526" },
    });
    expect(next.ngs).toEqual({ "00-1": { separation: 2.7 } });
    expect(next.depth).toEqual({ "12526": { position: "WR", rank: 1 } });
    expect(next.depthAsOf).toBe("2026-10-21T00:00:00.000Z");
    expect(next.depthPrevious).toEqual({ "12526": { position: "WR", rank: 2 } });
    expect(next.sleeperByGsis).toEqual({ "00-1": "12526" });
  });

  it("keeps populated fresh slices and tolerates a missing previous snapshot", () => {
    const next = {
      ...base,
      ngs: { "00-2": { separation: 3.1 } },
      depth: { "4034": { position: "WR", rank: 3 } },
      sleeperByGsis: { "00-2": "4034" },
    };
    applyInsightsRetentionFallbacks(next, {
      ...base,
      ngs: { "00-1": { separation: 2.7 } },
      depth: { "12526": { position: "WR", rank: 1 } },
      sleeperByGsis: { "00-1": "12526" },
    });
    expect(next.ngs).toEqual({ "00-2": { separation: 3.1 } });
    expect(next.depth).toEqual({ "4034": { position: "WR", rank: 3 } });
    expect(next.sleeperByGsis).toEqual({ "00-2": "4034" });

    const untouched = { ...base };
    applyInsightsRetentionFallbacks(untouched, null);
    expect(untouched).toEqual(base);
  });
});
