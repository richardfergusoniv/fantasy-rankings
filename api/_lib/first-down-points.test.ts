import { describe, expect, it } from "vitest";
import { firstDownLookup } from "./first-down-points.js";

const row = (player: string, team: string, position: string, leagues: Record<string, number> = {}, projected?: number) => ({
  player, team, position, leagues, expected_stats: (projected === undefined ? {} : { projected_points: projected }) as Record<string, number>,
});

describe("firstDownLookup", () => {
  it("uses the league's own total, then the snapshot's generic total", () => {
    const lookup = firstDownLookup({ projections: [row("Tre Vance", "KC", "RB", { L1: 12.5 }, 11)] });
    expect(lookup({ leagueId: "L1", name: "Tre Vance", position: "RB", team: "KC" })).toBe(12.5);
    expect(lookup({ leagueId: "L2", name: "Tre Vance", position: "RB", team: "KC" })).toBe(11);
  });

  it("matches without a team when the name is unique, ignoring punctuation and case", () => {
    const lookup = firstDownLookup({ projections: [row("D.J. Moore", "CHI", "WR", { L1: 14 })] });
    expect(lookup({ leagueId: "L1", name: "dj moore", position: "WR" })).toBe(14);
  });

  it("refuses a same-name player on a different team", () => {
    const lookup = firstDownLookup({ projections: [row("Josh Allen", "BUF", "QB", { L1: 24 })] });
    expect(lookup({ leagueId: "L1", name: "Josh Allen", position: "QB", team: "JAX" })).toBeNull();
  });

  it("settles a name shared by two players with the team, and gives nothing without one", () => {
    const lookup = firstDownLookup({ projections: [row("Mike Williams", "NYJ", "WR", { L1: 9 }), row("Mike Williams", "PIT", "WR", { L1: 8 })] });
    expect(lookup({ leagueId: "L1", name: "Mike Williams", position: "WR", team: "PIT" })).toBe(8);
    expect(lookup({ leagueId: "L1", name: "Mike Williams", position: "WR" })).toBeNull();
  });

  it("returns null for a player not in the snapshot, or no snapshot", () => {
    expect(firstDownLookup(null)({ leagueId: "L1", name: "Anyone", position: "RB" })).toBeNull();
    expect(firstDownLookup({ projections: [] })({ leagueId: "L1", name: "Anyone", position: "RB" })).toBeNull();
  });
});
