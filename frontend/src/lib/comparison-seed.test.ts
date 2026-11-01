import { describe, expect, it } from "vitest";
import { comparisonSeed } from "./comparison-seed";

const sources = {
  rankings: [{ playerId: "6786", name: "CeeDee Lamb", team: "DAL", position: "WR" }],
  seasonLongRankings: [{ playerId: "9999", name: "Rookie Back", team: "NYJ", position: "RB", formatKey: "redraft" }],
  defenses: [{ team: "PIT" }, { team: "ATL" }],
};

describe("comparisonSeed", () => {
  it("resolves a weekly or season-long player", () => {
    expect(comparisonSeed(sources, "redraft", "6786")).toEqual({ playerId: "6786", name: "CeeDee Lamb", team: "DAL", position: "WR" });
    expect(comparisonSeed(sources, "redraft", "9999")?.position).toBe("RB");
  });

  it("resolves a defense by its team code", () => {
    expect(comparisonSeed(sources, "redraft", "PIT")).toEqual({ name: "PIT Defense", team: "PIT", position: "DEF" });
  });

  it("is null for an unknown id", () => {
    expect(comparisonSeed(sources, "redraft", "nope")).toBeNull();
    expect(comparisonSeed(sources, "redraft", null)).toBeNull();
  });
});
