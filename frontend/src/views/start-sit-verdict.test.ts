import { describe, expect, it } from "vitest";
import { startSitFactors, startSitVerdict, type FactorInput, type VerdictPlayer } from "./start-sit-verdict";

const NOW = Date.parse("2026-11-15T15:00:00Z");
const player = (name: string, projection: number | null, over: Partial<VerdictPlayer> = {}): VerdictPlayer => ({
  playerId: name, name, position: "WR", projection, actual: null, gamePhase: "pregame", gameTime: "2026-11-15T18:00:00Z",
  injuryStatus: null, isBye: false, ...over,
});

describe("startSitVerdict", () => {
  it("recommends the higher projection with a chance above 50", () => {
    const verdict = startSitVerdict(player("A", 10), player("B", 14), NOW)!;
    expect(verdict.startIndex).toBe(1);
    expect(verdict.chance).toBeGreaterThan(50);
    expect(verdict.chance).toBeLessThan(100);
    expect(verdict.points).toEqual([10, 14]);
  });

  it("gives the same answer whichever player is first", () => {
    const one = startSitVerdict(player("A", 10), player("B", 14), NOW)!;
    const two = startSitVerdict(player("B", 14), player("A", 10), NOW)!;
    expect(one.chance).toBe(two.chance);
    expect(one.startIndex).toBe(1);
    expect(two.startIndex).toBe(0);
  });

  it("calls near-equal players a coin flip", () => {
    const verdict = startSitVerdict(player("A", 12), player("B", 12.05), NOW)!;
    expect(verdict.startIndex).toBeNull();
    expect(verdict.chance).toBe(50);
  });

  it("strongly favors a healthy player over one who is on bye", () => {
    const verdict = startSitVerdict(player("Bye", 15, { isBye: true }), player("Healthy", 6), NOW)!;
    expect(verdict.startIndex).toBe(1);
    expect(verdict.chance).toBeGreaterThan(80);
  });

  it("judges a game in progress on the time left, not the pregame projection", () => {
    // A was projected for 20 but has scored 2 with one minute left in the 4th quarter.
    const live = player("A", 20, { gamePhase: "live", actual: 2, gamePeriod: 4, gameClockSeconds: 60 });
    const verdict = startSitVerdict(live, player("B", 10), NOW)!;
    expect(verdict.startIndex).toBe(1);
    expect(verdict.points[0]).toBeLessThan(3);
  });

  it("returns null when a player has no forecast", () => {
    expect(startSitVerdict(player("A", 10), player("V", null, { playerId: "0" }), NOW)).toBeNull();
  });
});

const blank: FactorInput = {
  projection: null, vegasProjection: null, sleeperProjection: null, bookRange: null, season: null, injuryStatus: null,
  isBye: false, opponent: null, matchupRank: null, targetShare: null, snapShare: null, opportunityShare: null,
};

describe("startSitFactors", () => {
  it("leaves out rows neither player has", () => {
    expect(startSitFactors(blank, blank)).toEqual([]);
  });

  it("marks the better side, and lower is better for matchup rank", () => {
    const rows = startSitFactors(
      { ...blank, projection: 12.8, matchupRank: 8, targetShare: 24 },
      { ...blank, projection: 10.1, matchupRank: 27, targetShare: 17 },
    );
    expect(rows.find((r) => r.label === "Projection")).toMatchObject({ values: ["12.8", "10.1"], edge: 0 });
    expect(rows.find((r) => r.label === "Matchup rank")).toMatchObject({ values: ["#8", "#27"], edge: 0 });
    expect(rows.find((r) => r.label === "Target share")).toMatchObject({ values: ["24%", "17%"], edge: 0 });
  });

  it("shows an injury against the other player, and a bye as the opponent", () => {
    const rows = startSitFactors({ ...blank, injuryStatus: "Questionable", isBye: true }, { ...blank, opponent: "LV" });
    expect(rows.find((r) => r.label === "Injury")).toMatchObject({ values: ["Questionable", "None"], edge: 1 });
    expect(rows.find((r) => r.label === "Opponent")?.values).toEqual(["Bye", "LV"]);
  });
});
