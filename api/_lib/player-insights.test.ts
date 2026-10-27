import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

const {
  csvObjects,
  depthFromRows,
  previousDepthFromRows,
  mergeNgsSources,
  parseNgs,
  parseOpportunity,
  parsePlayerIds,
  playerInsightsSnapshotSchema,
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
      "00-1": { games: 2, expected: 47.3, actual: 47.7, weeks: [[1, 26.3, 29.1], [2, 21, 18.6]] },
    });
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
    expect(parsed.sleeperByGsis).toEqual({});
  });
});
