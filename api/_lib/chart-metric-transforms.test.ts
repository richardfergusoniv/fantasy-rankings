import { describe, expect, it } from "vitest";
import {
  accumulatePbpRow,
  applySnapSharesToRows,
  averageProe,
  buildRedZoneShares,
  deriveMetricsFromPbpCsv,
  emptyPbpDerivedMetrics,
  enrichOpportunityMetrics,
  normalizeChartPlayerName,
  parseSnapCountsCsv,
  redZoneShare,
  teamProeFromAccumulators,
  weeklySnapsByPlayerId,
  type ChartStatRow,
} from "./chart-metric-transforms.js";

function row(partial: Partial<ChartStatRow> & Pick<ChartStatRow, "id" | "values">): ChartStatRow {
  return {
    name: partial.name ?? "Player",
    team: partial.team ?? "KC",
    position: partial.position ?? "RB",
    season: partial.season ?? 2026,
    week: partial.week ?? 1,
    gameId: partial.gameId ?? "2026_01_KC_BUF",
    id: partial.id,
    values: partial.values,
  };
}

describe("enrichOpportunityMetrics", () => {
  it("computes opportunity, opportunity share, carry share, and RB target share", () => {
    const rows = [
      row({ id: "rb1", name: "Lead Back", position: "RB", values: { carries: 15, targets: 5 } }),
      row({ id: "rb2", name: "Change", position: "RB", values: { carries: 5, targets: 5 } }),
      row({ id: "wr1", name: "Wide", position: "WR", values: { carries: 0, targets: 10 } }),
    ];
    enrichOpportunityMetrics(rows);
    expect(rows[0]?.values.opportunity).toBe(20);
    expect(rows[0]?.values.opportunity_share).toBeCloseTo(50);
    expect(rows[0]?.values.carry_share).toBeCloseTo(75);
    expect(rows[0]?.values.rb_target_share).toBeCloseTo(50);
    expect(rows[1]?.values.carry_share).toBeCloseTo(25);
    expect(rows[1]?.values.rb_target_share).toBeCloseTo(50);
    expect(rows[2]?.values.opportunity_share).toBeCloseTo(25);
    expect(rows[2]?.values.rb_target_share).toBeUndefined();
  });

  it("uses pass attempts plus carries for QB opportunity volume", () => {
    const rows = [
      row({ id: "qb1", name: "Starter", position: "QB", values: { pass_attempts: 30, carries: 4 } }),
      row({ id: "rb1", name: "Back", position: "RB", values: { carries: 12, targets: 4 } }),
    ];
    enrichOpportunityMetrics(rows);
    expect(rows[0]?.values.opportunity).toBe(34);
    // Share still uses touch opportunity so team targets+carries are not double-counted.
    expect(rows[0]?.values.opportunity_share).toBeCloseTo((4 / 20) * 100);
    expect(rows[1]?.values.opportunity_share).toBeCloseTo((16 / 20) * 100);
  });
});

describe("snap transforms", () => {
  it("parses snap_counts CSV and applies offense pct as percent", () => {
    const csv = [
      "game_id,season,game_type,week,player,position,team,offense_snaps,offense_pct",
      "g1,2026,REG,1,Lead Back,RB,KC,50,0.8",
      "g1,2026,REG,1,Wide Out,WR,KC,40,0.65",
      "g1,2026,PRE,1,Ignore Me,RB,KC,10,0.1",
      "g1,2026,REG,1,Guard,G,KC,55,1",
    ].join("\n");
    const snaps = parseSnapCountsCsv(csv);
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({ player: "Lead Back", offensePct: 0.8, week: 1 });

    const rows = [
      row({ id: "rb1", name: "Lead Back", week: 1, values: { carries: 10 } }),
      row({ id: "wr1", name: "Wide Out", position: "WR", week: 1, values: { targets: 8 } }),
    ];
    applySnapSharesToRows(rows, snaps);
    expect(rows[0]?.values.snap_share).toBeCloseTo(80);
    expect(rows[1]?.values.snap_share).toBeCloseTo(65);
  });

  it("builds weekly snap series sorted by week", () => {
    const rows = [
      row({ id: "rb1", week: 2, season: 2026, values: { snap_share: 70 } }),
      row({ id: "rb1", week: 1, season: 2026, values: { snap_share: 60 } }),
      row({ id: "rb1", week: 1, season: 2025, values: { snap_share: 99 } }),
    ];
    const series = weeklySnapsByPlayerId(rows, 2026);
    expect(series.get("rb1")).toEqual([
      { week: 1, snapShare: 60 },
      { week: 2, snapShare: 70 },
    ]);
  });

  it("normalizes player names for snap lookup", () => {
    expect(normalizeChartPlayerName("Ja'Marr Chase Jr.")).toBe("jamarrchase");
  });
});

describe("red-zone and PROE transforms", () => {
  it("computes red-zone shares from team totals", () => {
    expect(redZoneShare(3, 12)).toBe(25);
    expect(redZoneShare(0, 0)).toBeNull();
    const shares = buildRedZoneShares(
      new Map([["p1", { targets: 4, carries: 2 }]]),
      new Map([["KC", { targets: 8, carries: 10 }]]),
      new Map([["p1", "KC"]]),
    );
    expect(shares.get("p1")).toEqual({ rz_target_share: 50, rz_carry_share: 20 });
  });

  it("averages pass_oe into team PROE", () => {
    expect(averageProe(10, 4)).toBe(2.5);
    const map = teamProeFromAccumulators(new Map([
      ["KC", { sum: -12, count: 4 }],
      ["BUF", { sum: 0, count: 0 }],
    ]));
    expect(map.get("KC")).toBe(-3);
    expect(map.has("BUF")).toBe(false);
  });

  it("derives RZ and PROE from a pbp CSV fixture", () => {
    const csv = [
      "season_type,posteam,pass_oe,yardline_100,pass_attempt,rush_attempt,receiver_player_id,rusher_player_id",
      "REG,KC,4,35,1,0,r1,",
      "REG,KC,-2,10,1,0,r1,",
      "REG,KC,0,5,0,1,,u1",
      "REG,BUF,6,8,1,0,r2,",
      "POST,KC,99,5,1,0,r1,",
    ].join("\n");
    const derived = deriveMetricsFromPbpCsv(csv);
    const shares = buildRedZoneShares(derived.playerRedZone, derived.teamRedZone, derived.playerTeam);
    expect(shares.get("r1")?.rz_target_share).toBe(100);
    expect(shares.get("u1")?.rz_carry_share).toBe(100);
    expect(teamProeFromAccumulators(derived.teamProe).get("KC")).toBeCloseTo((4 - 2 + 0) / 3);
  });

  it("accumulates one pbp row into empty state", () => {
    const state = emptyPbpDerivedMetrics();
    accumulatePbpRow(state, {
      season_type: "REG",
      posteam: "SF",
      pass_oe: "1.5",
      yardline_100: "12",
      pass_attempt: "1",
      rush_attempt: "0",
      receiver_player_id: "x1",
      rusher_player_id: "",
    });
    expect(state.teamProe.get("SF")).toEqual({ sum: 1.5, count: 1 });
    expect(state.playerRedZone.get("x1")?.targets).toBe(1);
  });
});
