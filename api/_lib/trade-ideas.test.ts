import { describe, expect, it } from "vitest";
import { toTradeIdea } from "./trade-ideas.js";

const suggestion = (over: Record<string, unknown> = {}) => ({
  partner: "Taco Tuesday",
  give: [{ playerId: "g1", name: "D. Mercer", position: "RB", value: 5200, teamName: "Me" }],
  get: [{ playerId: "t1", name: "A. Whitfield", position: "WR", value: 5000, teamName: "Taco Tuesday" }],
  giveTotal: 5200, getTotal: 5000, primaryLabel: "Good for you", primaryScore: 71,
  utility: {
    yourUtilityDelta: { weekLineupPoints: 3.2, starterValue: 400, powerRank: -2, restOfSeason: { pointsDelta: 21.5, coveredWeeks: [12, 13], missingWeeks: [], unknownPlayerWeeks: [], asOf: null, partial: false } },
    partnerUtilityDelta: { teamName: "Taco Tuesday", weekLineupPoints: -1.1, starterValue: -200, restOfSeason: { pointsDelta: -8, coveredWeeks: [12, 13], missingWeeks: [], unknownPlayerWeeks: [], asOf: null, partial: false } },
  },
  injuryExposure: { designatedPlayers: ["A. Whitfield"], designatedProjectedShare: 0.2, absentPlayers: [], partialPlayers: [] },
  rosterImpact: {
    week: { lineupPointsBefore: 120, lineupPointsAfter: 123.2 },
    seasonLong: { starterValueBefore: 9000, starterValueAfter: 9400, powerRankBefore: 4, powerRankAfter: 2, fillsHole: true },
  },
  ...over,
}) as never;

describe("toTradeIdea", () => {
  it("keeps only what the card and sheet show", () => {
    const idea = toTradeIdea(suggestion(), 7);
    expect(idea.partnerRosterId).toBe(7);
    expect(idea.give).toEqual([{ playerId: "g1", name: "D. Mercer", position: "RB", value: 5200 }]);
    expect(idea.verdict).toBe("Good for you");
    expect(idea.week).toEqual({ lineupBefore: 120, lineupAfter: 123.2 });
    expect(idea.seasonLong.powerRankAfter).toBe(2);
    expect(idea.restOfSeason).toEqual({ pointsDelta: 21.5, coveredWeeks: [12, 13], partial: false });
    expect(idea.partnerRestOfSeason).toEqual({ pointsDelta: -8 });
    expect(idea.injuryExposure).toEqual({ designatedPlayers: ["A. Whitfield"], absentPlayers: [] });
  });

  it("handles missing rest-of-season and injury data", () => {
    const base = suggestion() as unknown as { utility: { yourUtilityDelta: Record<string, unknown>; partnerUtilityDelta: Record<string, unknown> } };
    base.utility.yourUtilityDelta.restOfSeason = null;
    base.utility.partnerUtilityDelta.restOfSeason = undefined;
    const idea = toTradeIdea({ ...base, injuryExposure: null } as never, null);
    expect(idea.restOfSeason).toBeNull();
    expect(idea.partnerRestOfSeason).toBeNull();
    expect(idea.injuryExposure).toBeNull();
    expect(idea.partnerRosterId).toBeNull();
  });
});
