import { describe, expect, it } from "vitest";
import { tradeIdeaDetails } from "./trade-idea-details";
import type { TradeIdea } from "../../../api/_lib/trade-ideas";

const idea = (over: Partial<TradeIdea> = {}): TradeIdea => ({
  partnerRosterId: 7, partner: "Taco Tuesday",
  give: [{ playerId: "g", name: "D. Mercer", position: "RB", value: 5200 }],
  get: [{ playerId: "t", name: "A. Whitfield", position: "WR", value: 5600 }],
  verdict: "Good for you", verdictScore: 71, giveTotal: 5200, getTotal: 5600,
  week: { lineupBefore: 120, lineupAfter: 123.2 },
  seasonLong: { starterValueBefore: 9000, starterValueAfter: 9400, powerRankBefore: 4, powerRankAfter: 2, fillsHole: true },
  restOfSeason: { pointsDelta: 21.5, coveredWeeks: [12, 13, 14], partial: false },
  partnerWeekDelta: -1.1, partnerRestOfSeason: { pointsDelta: -8 },
  injuryExposure: { designatedPlayers: ["A. Whitfield"], absentPlayers: [] },
  ...over,
});

describe("tradeIdeaDetails", () => {
  it("lays out both sides, marking the higher market value as the edge", () => {
    const { compare } = tradeIdeaDetails(idea());
    expect(compare[0]!.values).toEqual(["D. Mercer", "A. Whitfield"]);
    expect(compare.find((r) => r.label === "Market value")).toMatchObject({ values: ["5,200", "5,600"], edge: 1 });
  });

  it("describes what the trade does to your team and theirs", () => {
    const { yours, theirs } = tradeIdeaDetails(idea());
    expect(yours.find((r) => r.label === "Lineup this week")?.value).toBe("120.0 → 123.2 (+3.2)");
    expect(yours.find((r) => r.label === "Power rank")?.value).toBe("#4 → #2");
    expect(yours.find((r) => r.label === "Fills your weakest spot")?.value).toBe("Yes");
    expect(yours.find((r) => r.label === "Rest-of-season points")?.value).toBe("+21.5 over weeks 12–14");
    expect(yours.find((r) => r.label === "Injury designations")?.value).toBe("A. Whitfield");
    expect(theirs).toEqual([{ label: "Lineup this week", value: "−1.1" }, { label: "Rest-of-season points", value: "−8.0" }]);
  });

  it("leaves out rest-of-season and injury rows when there is no data", () => {
    const { yours, theirs } = tradeIdeaDetails(idea({ restOfSeason: null, injuryExposure: null, partnerRestOfSeason: null }));
    expect(yours.some((r) => r.label === "Rest-of-season points" || r.label === "Injury designations")).toBe(false);
    expect(theirs).toHaveLength(1);
  });
});
