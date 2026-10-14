import { describe, expect, it } from "vitest";
import { leaguePowerTeamForPlayer, resolveLeagueTeamCard } from "./league-roster";

const week = [
  { rosterId: 1, teamName: "Ladz", isUser: true, rank: 2 },
  { rosterId: 2, teamName: "Rival", isUser: false, rank: 5 },
  { rosterId: 3, teamName: "Rival", isUser: false, rank: 8 },
];

const powerWeek = [
  {
    rosterId: 1,
    teamName: "Ladz",
    record: { wins: 2, losses: 1, ties: 0 },
    rank: 2,
    totalValue: 110.5,
    futurePickValue: 0,
    positionValues: { QB: 20, RB: 30, WR: 40, TE: 20.5, FLEX: 0, K: 0, DEF: 0 },
    isUser: true,
  },
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

describe("resolveLeagueTeamCard", () => {
  it("returns the power rankings row when league data is present", () => {
    const resolved = resolveLeagueTeamCard({
      tradeTeams: [{ rosterId: 1, teamName: "Ladz", isUser: true, players: [] }],
      powerRankingsWeek: powerWeek,
    }, 1);
    expect(resolved).toEqual({ team: powerWeek[0], powerLoading: false });
  });

  it("opens immediately from tradeTeams while power rankings are still empty", () => {
    const resolved = resolveLeagueTeamCard({
      tradeTeams: [{ rosterId: 1, teamName: "Ladz", isUser: true, players: [], record: { wins: 1, losses: 0, ties: 0 } }],
      powerRankingsWeek: [],
    }, 1, true);
    expect(resolved?.powerLoading).toBe(true);
    expect(resolved?.team).toMatchObject({
      rosterId: 1,
      teamName: "Ladz",
      isUser: true,
      record: { wins: 1, losses: 0, ties: 0 },
      rank: 0,
      totalValue: 0,
    });
  });

  it("returns null when the roster is unknown", () => {
    expect(resolveLeagueTeamCard({
      tradeTeams: [],
      powerRankingsWeek: [],
    }, 99, true)).toBeNull();
  });
});
