import { describe, expect, it } from "vitest";
import { currentExpertRanks, leagueExpertRanks, scaleExpertsToScoring } from "./expert-ranks";

const experts = { "9493": { ecr: 1, best: 1, worst: 1, positionRank: 1, projection: 24.4 } };
const insights = (expertsLastKickoff: string | null, ranks: Record<string, (typeof experts)["9493"]> = experts) => ({
  depth: {},
  depthAsOf: null,
  depthPrevious: {},
  experts: ranks,
  expertsAsOf: "2026-10-22",
  expertsLastKickoff,
});
const week7 = [{ gameTime: "2026-10-23T00:15Z" }, { gameTime: "2026-10-27T00:15Z" }, { gameTime: null }];

describe("currentExpertRanks", () => {
  it("keeps ranks for the dashboard's week", () => {
    expect(currentExpertRanks({ playerInsights: insights("2026-10-27T00:15:00.000Z"), rankings: week7 })).toBe(experts);
  });

  it("hides ranks from another week", () => {
    expect(currentExpertRanks({ playerInsights: insights("2026-10-20T00:15:00.000Z"), rankings: week7 })).toBeNull();
    expect(currentExpertRanks({ playerInsights: insights("2026-11-03T01:15:00.000Z"), rankings: week7 })).toBeNull();
  });

  it("hides undated or missing ranks", () => {
    expect(currentExpertRanks({ playerInsights: insights(null), rankings: week7 })).toBeNull();
    expect(currentExpertRanks({ playerInsights: undefined, rankings: week7 })).toBeNull();
    expect(currentExpertRanks({ playerInsights: insights("2026-10-27T00:15:00.000Z", {}), rankings: week7 })).toBeNull();
    expect(currentExpertRanks({ playerInsights: insights("2026-10-27T00:15:00.000Z"), rankings: [] })).toBeNull();
  });
});

const expert = (projection: number | null) => ({ ecr: 1, best: 1, worst: 1, positionRank: 1, projection });
const row = (playerId: string, position: string, vegasProjection: number | null, rec: number | null) => ({
  playerId,
  position,
  vegasProjection,
  projectionComponents: rec === null ? null : { rec },
});

describe("scaleExpertsToScoring", () => {
  // a: 20 PPR points with 6 catches -> 17 half-PPR; b: 10 with 2 -> 9; c: no Vegas line; d: QB, no catches.
  const rows = [row("a", "RB", 20, 6), row("b", "RB", 10, 2), row("c", "RB", null, null), row("d", "QB", 20, 0)];
  const experts = { a: expert(25), b: expert(12), c: expert(8), d: expert(22), e: expert(5), f: expert(null) };

  it("leaves PPR leagues untouched", () => {
    expect(scaleExpertsToScoring(experts, rows, "ppr")).toBe(experts);
  });

  it("takes half a point per projected reception off each projection", () => {
    const scaled = scaleExpertsToScoring(experts, rows, "halfPpr");
    expect(scaled.a?.projection).toBe(21.25);
    expect(scaled.b?.projection).toBe(10.8);
    expect(scaled.d?.projection).toBe(22);
  });

  it("uses the position median when a player has no Vegas line, and skips unknown players", () => {
    const scaled = scaleExpertsToScoring(experts, rows, "halfPpr");
    expect(scaled.c?.projection).toBe(7);
    expect(scaled.e?.projection).toBe(5);
    expect(scaled.f?.projection).toBeNull();
  });

  it("keeps ranks as they are", () => {
    expect(scaleExpertsToScoring(experts, rows, "halfPpr").a).toMatchObject({ ecr: 1, positionRank: 1 });
  });
});

describe("leagueExpertRanks", () => {
  const dashboard = {
    playerInsights: insights("2026-10-27T00:15:00.000Z", { "9493": { ...experts["9493"], projection: 20 } }),
    rankings: [{ ...row("9493", "RB", 20, 8), leagueId: "L1", gameTime: "2026-10-27T00:15Z" }, { ...row("9493", "RB", 20, 0), leagueId: "L2", gameTime: null }],
  };

  it("scales with the rows of the requested league only", () => {
    expect(leagueExpertRanks(dashboard, { id: "L1", rankingField: "halfPpr" })?.["9493"]?.projection).toBe(16);
    expect(leagueExpertRanks(dashboard, { id: "L1", rankingField: "ppr" })?.["9493"]?.projection).toBe(20);
  });

  it("returns null when the ranks are not this week's", () => {
    expect(leagueExpertRanks({ ...dashboard, rankings: [] }, { id: "L1", rankingField: "halfPpr" })).toBeNull();
  });
});
