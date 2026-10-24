import { describe, expect, it } from "vitest";
import { handcuffStarter } from "./handcuff";

const players = [
  { playerId: "starter", name: "Jahmyr Gibbs", team: "DET" },
  { playerId: "backup", name: "Sione Vaki", team: "DET" },
  { playerId: "other", name: "Bijan Robinson", team: "ATL" },
];
const depth = {
  starter: { position: "RB", rank: 1 },
  backup: { position: "RB", rank: 2 },
  other: { position: "RB", rank: 1 },
};
const base = { playerId: "backup", position: "RB", team: "DET", weeklyRank: 40, leagueSize: 12, depth, playerLists: [players] };

describe("handcuffStarter", () => {
  it("names the starter of the RB2 on the same team", () => {
    expect(handcuffStarter(base)).toBe("Jahmyr Gibbs");
    expect(handcuffStarter({ ...base, weeklyRank: null })).toBe("Jahmyr Gibbs");
  });

  it("is not a handcuff for the starter, another position or a back who already starts in the league", () => {
    expect(handcuffStarter({ ...base, playerId: "starter" })).toBeNull();
    expect(handcuffStarter({ ...base, position: "WR" })).toBeNull();
    expect(handcuffStarter({ ...base, weeklyRank: 20 })).toBeNull();
  });

  it("finds a starter that is missing from the first list", () => {
    expect(handcuffStarter({ ...base, playerLists: [[players[1]!], players] })).toBe("Jahmyr Gibbs");
  });

  it("returns null when the team has no listed RB1", () => {
    expect(handcuffStarter({ ...base, team: "NYG" })).toBeNull();
  });
});
