import { describe, expect, it } from "vitest";
import { buildEcrPowerRankings } from "./ecr-power-rankings";
import type { Dashboard } from "../dashboard-types";

type League = Dashboard["leagues"][number];

const zero = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
const player = (playerId: string, position: string) => ({ playerId, position }) as League["tradeTeams"][number]["players"][number];
const expert = (projection: number | null) => ({ ecr: 1, best: 1, worst: 1, positionRank: 1, projection });

function league(): League {
  return {
    tradeStarterSlots: ["QB", "RB", "FLEX"],
    powerRankingsWeek: [
      { rosterId: 1, teamName: "A", record: { wins: 0, losses: 0, ties: 0 }, rank: 1, totalValue: 99, futurePickValue: 0, positionValues: zero, isUser: true },
      { rosterId: 2, teamName: "B", record: { wins: 0, losses: 0, ties: 0 }, rank: 2, totalValue: 1, futurePickValue: 0, positionValues: zero, isUser: false },
    ],
    tradeTeams: [
      { rosterId: 1, players: [player("q1", "QB"), player("r1", "RB"), player("r2", "RB"), player("w1", "WR")] },
      { rosterId: 2, players: [player("q2", "QB"), player("r3", "RB"), player("w2", "WR")] },
    ],
  } as unknown as League;
}

describe("buildEcrPowerRankings", () => {
  it("fills the flex with the best player left and ranks teams by projected points", () => {
    const result = buildEcrPowerRankings(league(), {
      q1: expert(20), r1: expert(15), r2: expert(8), w1: expert(12),
      q2: expert(25), r3: expert(10), w2: expert(5),
    });
    expect(result.map((entry) => entry.team.rosterId)).toEqual([1, 2]);
    const a = result.find((entry) => entry.team.rosterId === 1)!;
    expect(a.team.positionValues).toMatchObject({ QB: 20, RB: 15, FLEX: 12 });
    expect(a.team.totalValue).toBe(47);
    expect(a.starterIds).toEqual(new Set(["q1", "r1", "w1"]));
    expect(result.map((entry) => entry.team.rank)).toEqual([1, 2]);
  });

  it("counts unprojected players as zero and keeps ties stable by name", () => {
    const result = buildEcrPowerRankings(league(), { q1: expert(null) });
    expect(result.map((entry) => entry.team.teamName)).toEqual(["A", "B"]);
    expect(result[0]?.team.totalValue).toBe(0);
  });

  it("picks the best lineup across overlapping flex slots", () => {
    const base = league();
    const flexLeague = {
      ...base,
      tradeStarterSlots: ["REC_FLEX", "WRRB_FLEX"],
      tradeTeams: [{ rosterId: 1, players: [player("w", "WR"), player("t", "TE"), player("r", "RB")] }, base.tradeTeams[1]],
    } as unknown as League;
    const result = buildEcrPowerRankings(flexLeague, { w: expert(20), t: expert(19), r: expert(18) });
    const a = result.find((entry) => entry.team.rosterId === 1)!;
    expect(a.team.totalValue).toBe(39);
    expect(a.slotByPlayerId.get("t")).toBe("REC_FLEX");
    expect(a.slotByPlayerId.get("w")).toBe("WRRB_FLEX");
  });

  it("starts unprojected players at zero when slots are left over", () => {
    const result = buildEcrPowerRankings(league(), { q1: expert(20) });
    const a = result.find((entry) => entry.team.rosterId === 1)!;
    expect(a.starterIds).toEqual(new Set(["q1", "r1", "r2"]));
    expect(a.team.totalValue).toBe(20);
  });
});
