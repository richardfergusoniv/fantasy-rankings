import { describe, expect, it } from "vitest";
import {
  buildLeagueRosterRows,
  compactPlayerName,
  formatTeamRecord,
  isFantasyCalcPickId,
  marketPickTemplate,
  resolveHistoricalPickAsset,
  resolveValueHistoryPlayerId,
  tradeValueVerdict,
} from "./league-trade";

describe("compactPlayerName", () => {
  it("abbreviates a first name and keeps suffixes", () => {
    expect(compactPlayerName("Trevor Lawrence")).toBe("T. Lawrence");
    expect(compactPlayerName("Michael Pittman Jr.")).toBe("M. Pittman Jr.");
    expect(compactPlayerName("Chiefs")).toBe("Chiefs");
  });
});

describe("buildLeagueRosterRows", () => {
  it("lists every player and owned pick, highest value first", () => {
    const assets = new Map([
      ["wr", { playerId: "wr", name: "Justin Jefferson", team: "MIN", position: "WR", value: 9400, isRookie: false }],
      ["qb", { playerId: "qb", name: "Trevor Lawrence", team: "JAX", position: "QB", value: 7200, isRookie: false }],
    ]);
    const rows = buildLeagueRosterRows(
      [
        { playerId: "qb", name: "Trevor Lawrence", team: "JAX", position: "QB", injuryStatus: null },
        { playerId: "k", name: "Cam Little", team: "JAX", position: "K", injuryStatus: "Questionable" },
        { playerId: "wr", name: "Justin Jefferson", team: "MIN", position: "WR", injuryStatus: null },
      ],
      [{ playerId: "pick:2027:1", name: "2027 1st · Alpha", value: 4500 }],
      assets,
    );
    expect(rows.map((row) => row.id)).toEqual(["wr", "qb", "pick:2027:1", "k"]);
    expect(rows[0]?.shortName).toBe("J. Jefferson");
    expect(rows[2]).toMatchObject({ position: "PICK", shortName: "2027 1st" });
    expect(rows[3]).toMatchObject({ value: null, selectable: false, injuryStatus: "Questionable" });
  });
});

describe("formatTeamRecord", () => {
  it("appends ties only when the roster has any", () => {
    expect(formatTeamRecord({ wins: 4, losses: 1, ties: 0 })).toBe("4-1");
    expect(formatTeamRecord({ wins: 4, losses: 1, ties: 1 })).toBe("4-1-1");
  });
});

describe("tradeValueVerdict", () => {
  it("names the side that receives more league value", () => {
    expect(tradeValueVerdict(7200, 9400, "Tyler Warren Squad")).toBe("You win by 2,200.");
    expect(tradeValueVerdict(9400, 7200, "Tyler Warren Squad")).toBe("Tyler Warren Squad wins by 2,200.");
    expect(tradeValueVerdict(1000, 1000, "Tyler Warren Squad")).toBe("This trade is even.");
  });
});

describe("resolveValueHistoryPlayerId", () => {
  const market = [
    { playerId: "FP_2027_mid_0", position: "PICK", value: 3041, overallRank: 40 },
    { playerId: "FP_2027_early_0", position: "PICK", value: 4618, overallRank: 25 },
    { playerId: "9221", position: "RB", value: 11000, overallRank: 1 },
  ];

  it("passes players and FantasyCalc pick ids through", () => {
    expect(isFantasyCalcPickId("FP_2027_mid_0")).toBe(true);
    expect(isFantasyCalcPickId("pick:lg:2027:1:3")).toBe(false);
    expect(resolveValueHistoryPlayerId({ playerId: "9221", position: "RB", value: 11000, overallRank: 1 }, market)).toBe("9221");
    expect(resolveValueHistoryPlayerId({ playerId: "FP_2027_mid_0", position: "PICK", value: 3041, overallRank: 40 }, market)).toBe("FP_2027_mid_0");
  });

  it("maps owned and historical pick ids onto FantasyCalc FP_* rows", () => {
    expect(resolveValueHistoryPlayerId({
      playerId: "pick:1306:2027:1:3",
      position: "PICK",
      value: 3041,
      overallRank: 40,
    }, market)).toBe("FP_2027_mid_0");
    expect(resolveValueHistoryPlayerId({
      playerId: "historical:tx:1:FP_2027_early_0",
      position: "PICK",
      value: 4618,
      overallRank: 25,
    }, market)).toBe("FP_2027_early_0");
  });
});

describe("resolveHistoricalPickAsset", () => {
  const market = [
    { playerId: "FP_2027_early_0", name: "2027 Early 1st", position: "PICK", value: 4618 },
    { playerId: "FP_2027_mid_0", name: "2027 Mid 1st", position: "PICK", value: 3041 },
    { playerId: "FP_2027_late_0", name: "2027 Late 1st", position: "PICK", value: 1820 },
  ];
  // Same rows the current calculator builds in dashboard-build: tiered templates
  // keyed by original slot owner (`pick:league:season:round:originalRosterId`).
  const ownedPicks = [
    { playerId: "pick:lg:2027:1:6", name: "2027 1st · Cellar Dweller", position: "PICK", value: 4618 },
    { playerId: "pick:lg:2027:1:3", name: "2027 1st · Contender", position: "PICK", value: 1820 },
    { playerId: "pick:lg:2027:1:1", name: "2027 1st · Mid Pack", position: "PICK", value: 3041 },
  ];

  it("uses the early-tier owned pick for an early original owner", () => {
    const asset = resolveHistoricalPickAsset(market, ownedPicks, 2027, 1, 6);
    expect(asset?.playerId).toBe("pick:lg:2027:1:6");
    expect(asset?.value).toBe(4618);
    expect(marketPickTemplate(market, 2027, 1, "early")?.playerId).toBe("FP_2027_early_0");
  });

  it("uses the late-tier owned pick for a late original owner", () => {
    const asset = resolveHistoricalPickAsset(market, ownedPicks, 2027, 1, 3);
    expect(asset?.playerId).toBe("pick:lg:2027:1:3");
    expect(asset?.value).toBe(1820);
    expect(marketPickTemplate(market, 2027, 1, "late")?.playerId).toBe("FP_2027_late_0");
  });

  it("falls back to the Mid FantasyCalc row when the original owner is unknown", () => {
    expect(resolveHistoricalPickAsset(market, ownedPicks, 2027, 1, null)?.playerId).toBe("FP_2027_mid_0");
    expect(resolveHistoricalPickAsset(market, ownedPicks, 2027, 1, undefined)?.playerId).toBe("FP_2027_mid_0");
    expect(resolveHistoricalPickAsset(market, ownedPicks, 2027, 1, 99)?.playerId).toBe("FP_2027_mid_0");
  });
});
