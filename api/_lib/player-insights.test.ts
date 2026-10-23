import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

const {
  csvObjects,
  depthFromRows,
  mergeNgsSources,
  parseExperts,
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

describe("ids, depth and experts", () => {
  const ids = parsePlayerIds([
    "fantasypros_id,gsis_id,sleeper_id,name",
    "23046,00-1,12526,Puka Nacua",
    "999,00-2,NA,No Sleeper",
    "777,00-3,4034,Davante Adams",
  ].join("\n"));

  it("maps gsis and FantasyPros ids to Sleeper ids", () => {
    expect(ids.sleeperByGsis.get("00-1")).toBe("12526");
    expect(ids.sleeperByGsis.has("00-2")).toBe(false);
    expect(ids.sleeperByFantasyPros.get("777")).toBe("4034");
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

  it("reads expert ranks for skill players, kickers and defenses", () => {
    const csv = [
      "scrape_date,fantasypros_id,player_name,pos,team,ecr,best,worst,pos_rank,r2p_pts,player_game_kickoff_ts",
      '2026-10-22,"23046","Puka Nacua","WR","LAR",1,1,1,"WR1","24.4",1792947600',
      '2026-10-22,"8170","Minnesota Vikings","DST","MIN",3.2,1,6,"DST3",NA,1793060100',
      '2026-10-22,"555","Some Linebacker","LB","MIN",2,1,3,"LB2","9"',
      '2026-10-22,"999","No Sleeper","WR","DAL",40,30,50,"WR40","5"',
      '2026-10-22,"777","Davante Adams","WR","LAR",bad,1,1,"WR9","1"',
    ].join("\n");
    expect(parseExperts(csv, ids.sleeperByFantasyPros)).toEqual({
      experts: {
        "12526": { ecr: 1, best: 1, worst: 1, positionRank: 1, projection: 24.4 },
        MIN: { ecr: 3.2, best: 1, worst: 6, positionRank: 3, projection: null },
      },
      asOf: "2026-10-22",
      lastKickoff: "2026-10-27T00:15:00.000Z",
    });
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
      experts: {},
      expertsAsOf: null,
    }).success).toBe(true);
  });
});
