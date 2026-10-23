import { describe, expect, it } from "vitest";
import { currentExpertRanks } from "./expert-ranks";

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
