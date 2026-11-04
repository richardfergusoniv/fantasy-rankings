import { describe, expect, it } from "vitest";
import { waiverBidsFor, waiverCacheFor } from "./waiver-suggestions.js";
import { BUILTIN_SCORING_WEIGHTS } from "./scoring/weights.js";
import { leagueSchema } from "./dashboard-schemas.js";
import { baseDashboard } from "./test-fixtures.js";

function gradedLeague() {
  const dashboard = baseDashboard();
  // A free agent who would start and outscore the lineup, so he grades above Pass.
  for (const row of dashboard.rankings) if (row.playerId === "fa1") row.leagueProjection = 40;
  const league = dashboard.leagues.find((row) => row.id === "lg1")!;
  for (const row of league.tradeWaiverPool) if (row.playerId === "fa1") row.projection = 40;
  return { dashboard, league };
}

describe("waiverCacheFor", () => {
  it("returns priority-note grades for a rolling league and no dollar bids", () => {
    const { dashboard, league } = gradedLeague();
    const rolling = { ...league, waivers: { type: "rolling" as const, budget: null, remaining: null, position: 2, teams: 14 } };
    const { bids, grades } = waiverCacheFor(dashboard, rolling, BUILTIN_SCORING_WEIGHTS);
    expect(bids).toEqual([]);
    const fa = grades.find((row) => row.playerId === "fa1");
    expect(fa).toBeDefined();
    expect(["Must add", "Add", "Watch"]).toContain(fa!.label);
    expect(typeof fa!.score).toBe("number");
    expect(fa!.bid?.kind).toBe("priority");
    expect(fa!.bid?.note).toContain("waiver priority 2 of 14");
    expect(fa!.bid?.low).toBeUndefined();
    expect(fa!.bid?.high).toBeUndefined();
  });

  it("returns dollar-bid grades for a FAAB league and unchanged waiverBids", () => {
    const { dashboard, league } = gradedLeague();
    const faab = { ...league, waivers: { type: "faab" as const, budget: 100, remaining: 90, position: null, teams: 12 } };
    const { bids, grades } = waiverCacheFor(dashboard, faab, BUILTIN_SCORING_WEIGHTS);
    expect(bids).toEqual(waiverBidsFor(dashboard, faab, BUILTIN_SCORING_WEIGHTS));
    expect(bids.length).toBeGreaterThan(0);
    const fa = grades.find((row) => row.playerId === "fa1");
    expect(fa?.bid?.kind).toBe("faab");
    expect(fa?.bid?.low).toBeGreaterThanOrEqual(1);
    expect(fa?.bid?.high).toBeLessThanOrEqual(90);
    for (const grade of grades) {
      expect(grade.dropCandidate === null || typeof grade.dropCandidate.value === "number").toBe(true);
    }
  });

  it("excludes Pass rows from grades", () => {
    const dashboard = baseDashboard();
    const league = dashboard.leagues.find((row) => row.id === "lg1")!;
    const { grades } = waiverCacheFor(dashboard, league, BUILTIN_SCORING_WEIGHTS);
    expect(grades.every((row) => row.label !== "Pass" as string)).toBe(true);
  });

  it("returns empty grades for an empty pool", () => {
    const dashboard = baseDashboard();
    const league = dashboard.leagues.find((row) => row.id === "lg1")!;
    // Pool falls back to unrostered rankings rows; empty both sources.
    dashboard.rankings = dashboard.rankings.filter((row) => row.playerId === "p1");
    const { grades, bids } = waiverCacheFor(dashboard, { ...league, tradeWaiverPool: [] }, BUILTIN_SCORING_WEIGHTS);
    expect(grades).toEqual([]);
    expect(bids).toEqual([]);
  });
});

describe("leagueSchema compatibility", () => {
  it("still validates a cached league payload without waiverGrades", () => {
    const league = baseDashboard().leagues.find((row) => row.id === "lg1")!;
    const { waiverGrades: _unused, ...oldPayload } = league as typeof league & { waiverGrades?: unknown };
    expect(() => leagueSchema.parse(oldPayload)).not.toThrow();
  });
});
