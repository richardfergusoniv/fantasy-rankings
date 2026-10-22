import { describe, expect, it } from "vitest";
import { currentExpertRanks } from "./expert-ranks";

const experts = { "9493": { ecr: 1, best: 1, worst: 1, positionRank: 1, projection: 24.4 } };
const insights = (expertsAsOf: string | null) => ({ depth: {}, depthAsOf: null, experts, expertsAsOf });

describe("currentExpertRanks", () => {
  it("keeps ranks scraped within a week of the dashboard", () => {
    expect(currentExpertRanks(insights("2026-10-22"), "2026-10-22T18:00:00.000Z")).toBe(experts);
    expect(currentExpertRanks(insights("2026-10-16"), "2026-10-22T18:00:00.000Z")).toBe(experts);
  });

  it("hides stale, undated or missing ranks", () => {
    expect(currentExpertRanks(insights("2026-10-14"), "2026-10-22T18:00:00.000Z")).toBeNull();
    expect(currentExpertRanks(insights(null), "2026-10-22T18:00:00.000Z")).toBeNull();
    expect(currentExpertRanks(undefined, "2026-10-22T18:00:00.000Z")).toBeNull();
    expect(currentExpertRanks({ depth: {}, depthAsOf: null, experts: {}, expertsAsOf: "2026-10-22" }, "2026-10-22T18:00:00.000Z")).toBeNull();
  });
});
