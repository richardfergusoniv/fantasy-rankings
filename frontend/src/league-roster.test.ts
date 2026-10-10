import { describe, expect, it } from "vitest";
import { leaguePowerTeamForPlayer } from "./league-roster";

const week = [
  { rosterId: 1, teamName: "Ladz", isUser: true, rank: 2 },
  { rosterId: 2, teamName: "Rival", isUser: false, rank: 5 },
  { rosterId: 3, teamName: "Rival", isUser: false, rank: 8 },
];

describe("leaguePowerTeamForPlayer", () => {
  it("returns the power row for the team that rosters the player", () => {
    const team = leaguePowerTeamForPlayer({
      rosterAssignments: [{ playerId: "p1", teamName: "Ladz", isUser: true }],
      tradeTeams: [{ rosterId: 1, teamName: "Ladz", isUser: true, players: [{ playerId: "p1" }] }],
      powerRankingsWeek: week,
    }, "p1");
    expect(team?.rosterId).toBe(1);
  });

  it("uses the roster id when two teams share a name", () => {
    const team = leaguePowerTeamForPlayer({
      rosterAssignments: [{ playerId: "p2", teamName: "Rival", isUser: false }],
      tradeTeams: [{ rosterId: 3, teamName: "Rival", isUser: false, players: [{ playerId: "p2" }] }],
      powerRankingsWeek: week,
    }, "p2");
    expect(team?.rosterId).toBe(3);
  });

  it("returns null for an available player", () => {
    expect(leaguePowerTeamForPlayer({
      rosterAssignments: [],
      tradeTeams: [{ rosterId: 1, teamName: "Ladz", isUser: true, players: [] }],
      powerRankingsWeek: week,
    }, "free-agent")).toBeNull();
  });
});
