import { describe, expect, it } from "vitest";
import { playersInGame } from "./matchup-players";

const canonical = (team: string | null) => (team === "JAC" ? "JAX" : team);
const player = (playerId: string, team: string | null, isStarter: boolean, projection: number | null) => ({
  playerId,
  name: playerId,
  team,
  position: "WR",
  projection,
  isStarter,
});

describe("playersInGame", () => {
  it("keeps only players on either team, starters first by projection", () => {
    const result = playersInGame([
      player("bench-hi", "CIN", false, 12),
      player("elsewhere", "DAL", true, 30),
      player("starter-low", "BAL", true, 6),
      player("starter-high", "CIN", true, 17),
    ], ["CIN", "BAL"], canonical);
    expect(result.map((p) => p.playerId)).toEqual(["starter-high", "starter-low", "bench-hi"]);
  });

  it("matches team aliases and ignores free agents", () => {
    const result = playersInGame([player("a", "JAC", true, 9), player("b", null, true, 20)], ["JAX", "TEN"], canonical);
    expect(result.map((p) => p.playerId)).toEqual(["a"]);
  });

  it("sorts missing projections last within a group", () => {
    const result = playersInGame([player("none", "CIN", true, null), player("some", "CIN", true, 3)], ["CIN", "BAL"], canonical);
    expect(result.map((p) => p.playerId)).toEqual(["some", "none"]);
  });
});
