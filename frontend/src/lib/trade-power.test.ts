import { describe, expect, it } from "vitest";
import { powerRankingsAfterTrade } from "./trade-power";
import type { PowerRankingRow } from "./trade-power";

function row(rosterId: number, teamName: string, totalValue: number, rank: number, isUser = false): PowerRankingRow {
  return { rosterId, teamName, totalValue, rank, isUser };
}

const rows: PowerRankingRow[] = [
  row(1, "Alpha", 12000, 1),
  row(2, "Mine", 11500, 2, true),
  row(3, "Partner", 11400, 3),
  row(4, "Delta", 10900, 4),
];

describe("powerRankingsAfterTrade", () => {
  it("swaps the parties' player value and re-ranks", () => {
    const after = powerRankingsAfterTrade(rows, {
      myRosterId: 2,
      partnerRosterId: 3,
      give: [{ position: "WR", value: 2800 }],
      get: [{ position: "WR", value: 3100 }, { position: "RB", value: 900 }],
    });
    // Mine: 11500 - 2800 + 4000 = 12700 (rank 1); Partner: 11400 + 2800 - 4000 = 10200 (rank 4).
    expect(after.map((r) => [r.teamName, r.totalValue, r.previousRank, r.rank])).toEqual([
      ["Mine", 12700, 2, 1],
      ["Alpha", 12000, 1, 2],
      ["Delta", 10900, 4, 3],
      ["Partner", 10200, 3, 4],
    ]);
    expect(after.find((r) => r.teamName === "Alpha")?.isParty).toBe(false);
    expect(after.find((r) => r.teamName === "Mine")?.isParty).toBe(true);
  });

  it("ignores K, DEF, and picks, mirroring the server total", () => {
    const after = powerRankingsAfterTrade(rows, {
      myRosterId: 2,
      partnerRosterId: 3,
      give: [{ position: "K", value: 500 }, { position: "PICK", value: 1500 }],
      get: [{ position: "DEF", value: 700 }],
    });
    expect(after.map((r) => r.totalValue)).toEqual([12000, 11500, 11400, 10900]);
    expect(after.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("breaks total ties by team name, like the server builder", () => {
    const after = powerRankingsAfterTrade(rows, {
      myRosterId: 2,
      partnerRosterId: 3,
      give: [{ position: "TE", value: 50 }],
      get: [],
    });
    // Mine drops to 11450 and Partner rises to 11450; "Mine" sorts before "Partner".
    const mine = after.find((r) => r.teamName === "Mine");
    const partner = after.find((r) => r.teamName === "Partner");
    expect(mine?.totalValue).toBe(11450);
    expect(partner?.totalValue).toBe(11450);
    expect(mine?.rank).toBe(2);
    expect(partner?.rank).toBe(3);
  });
});
