import { describe, expect, it } from "vitest";
import { buildLeagueRosterRows, compactPlayerName, formatLineupImpact, formatTeamRecord, tradeValueVerdict } from "./league-trade";

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

describe("formatLineupImpact", () => {
  it("formats the existing before, after, and delta scores", () => {
    expect(formatLineupImpact(66, 59, -7)).toBe("Starting lineup: 66 → 59, -7 pts");
    expect(formatLineupImpact(66.24, 59.46, -6.78)).toBe("Starting lineup: 66.2 → 59.5, -6.8 pts");
  });
});
