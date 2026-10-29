import { describe, expect, it } from "vitest";
import { suggestFaabBid } from "./faab-bid.js";

const faab = { type: "faab" as const, budget: 100, remaining: 80, position: 3, teams: 12 };

describe("suggestFaabBid", () => {
  it("scales the range with the label and caps at the remaining budget", () => {
    const must = suggestFaabBid({ label: "Must add", waivers: faab, weeksLeft: 6, trendingAdds: null });
    const add = suggestFaabBid({ label: "Add", waivers: faab, weeksLeft: 6, trendingAdds: null });
    expect(must?.kind).toBe("faab");
    if (must?.kind !== "faab" || add?.kind !== "faab") throw new Error("expected faab bids");
    expect(must.low).toBeGreaterThan(add.high);
    expect(must.high).toBeLessThanOrEqual(80);
  });

  it("bids more late in the season or on contested players, less early", () => {
    const base = suggestFaabBid({ label: "Add", waivers: faab, weeksLeft: 6, trendingAdds: null });
    const late = suggestFaabBid({ label: "Add", waivers: faab, weeksLeft: 1, trendingAdds: null });
    const early = suggestFaabBid({ label: "Add", waivers: faab, weeksLeft: 12, trendingAdds: null });
    const hot = suggestFaabBid({ label: "Add", waivers: faab, weeksLeft: 6, trendingAdds: 50_000 });
    if (base?.kind !== "faab" || late?.kind !== "faab" || early?.kind !== "faab" || hot?.kind !== "faab") {
      throw new Error("expected faab bids");
    }
    expect(late.high).toBeGreaterThan(base.high);
    expect(early.high).toBeLessThan(base.high);
    expect(hot.high).toBeGreaterThan(base.high);
  });

  it("returns nothing for Pass, an empty budget, or no waiver info", () => {
    expect(suggestFaabBid({ label: "Pass", waivers: faab, weeksLeft: 6, trendingAdds: null })).toBeNull();
    expect(suggestFaabBid({ label: "Add", waivers: { ...faab, remaining: 0 }, weeksLeft: 6, trendingAdds: null })).toBeNull();
    expect(suggestFaabBid({ label: "Add", waivers: null, weeksLeft: 6, trendingAdds: null })).toBeNull();
  });

  it("explains priority leagues instead of bidding", () => {
    const bid = suggestFaabBid({
      label: "Add",
      waivers: { type: "rolling", budget: null, remaining: null, position: 4, teams: 12 },
      weeksLeft: 6,
      trendingAdds: null,
    });
    expect(bid?.kind).toBe("priority");
    expect(bid?.note).toContain("priority 4 of 12");
  });
});
