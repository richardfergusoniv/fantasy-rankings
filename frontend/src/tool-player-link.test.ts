import { describe, expect, it } from "vitest";
import { createPlayerResolver } from "./tool-player-link";

const rows = [
  { playerId: "s1", name: "Patrick Mahomes", team: "KC", position: "QB" },
  { playerId: "s2", name: "Josh Allen", team: "BUF", position: "QB" },
  { playerId: "s3", name: "Josh Allen", team: "JAX", position: "LB" },
  { playerId: "s4", name: "Kenneth Walker III", team: "SEA", position: "RB" },
  { playerId: "s5", name: "Jaguars", team: "JAX", position: "DEF" },
];

describe("createPlayerResolver", () => {
  const resolve = createPlayerResolver(rows);

  it("keeps an id the dashboard knows", () => {
    expect(resolve({ playerId: "s1", name: "anything", team: null, position: null })).toBe("s1");
  });

  it("matches a foreign id by name, team and position", () => {
    expect(resolve({ playerId: "00-0033873", name: "Patrick Mahomes", team: "KC", position: "QB" })).toBe("s1");
    expect(resolve({ playerId: null, name: "Kenneth Walker", team: "SEA", position: "RB" })).toBe("s4");
  });

  it("normalizes punctuation, case and team aliases", () => {
    expect(resolve({ playerId: null, name: "patrick  mahomes", team: "KC", position: null })).toBe("s1");
    expect(resolve({ playerId: null, name: "Josh Allen", team: "JAC", position: null })).toBe("s3");
  });

  it("uses team and position to separate two players with one name", () => {
    expect(resolve({ playerId: null, name: "Josh Allen", team: "BUF", position: "QB" })).toBe("s2");
    expect(resolve({ playerId: null, name: "Josh Allen", team: null, position: "QB" })).toBe("s2");
  });

  it("returns null for an ambiguous or unknown name rather than guessing", () => {
    expect(resolve({ playerId: null, name: "Josh Allen", team: null, position: null })).toBeNull();
    expect(resolve({ playerId: null, name: "Nobody Here", team: "KC", position: "QB" })).toBeNull();
    expect(resolve({ playerId: null, name: "Patrick Mahomes", team: "DAL", position: "QB" })).toBeNull();
    expect(resolve({ playerId: null, name: "", team: null, position: null })).toBeNull();
  });
});
