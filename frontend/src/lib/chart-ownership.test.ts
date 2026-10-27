import { describe, expect, it } from "vitest";
import {
  chartEntityRosterId,
  chartOwnershipForEntity,
  isPlayerOnSelectedTeam,
  isPlayerRosteredInLeague,
  type ChartOwnershipLeague,
} from "./chart-ownership";

function league(partial: Partial<ChartOwnershipLeague> = {}): ChartOwnershipLeague {
  return {
    starters: [],
    bench: [],
    rosteredPlayerIds: [],
    rosterAssignments: [],
    ...partial,
  };
}

describe("chartEntityRosterId", () => {
  it("uses the NFL team code for defenses", () => {
    expect(chartEntityRosterId({ name: "CIN Defense", team: "CIN", position: "DEF", id: "DEF:CIN" })).toBe("CIN");
  });

  it("prefers Sleeper playerId for skill players", () => {
    expect(chartEntityRosterId({ name: "Justin Tucker", team: "BAL", position: "K", playerId: "5001", id: "K:00-002000" })).toBe("5001");
  });

  it("does not treat nflverse GSIS ids as roster ids", () => {
    expect(chartEntityRosterId({ name: "Puka Nacua", team: "LAR", position: "WR", id: "WR:00-0037834" })).toBeNull();
  });
});

describe("isPlayerOnSelectedTeam", () => {
  it("marks only the viewer's rostered DST as mine, not every league-owned defense", () => {
    const hoeAss = league({
      starters: [{ playerId: "BAL", name: "Baltimore Ravens", team: "BAL", position: "DEF" }],
      bench: [],
      // League-wide roster includes many DSTs — the old bug treated all of these as mine.
      rosteredPlayerIds: ["BAL", "CIN", "MIN", "HOU", "CLE", "DEN", "NYJ", "PIT"],
      rosterAssignments: [
        { playerId: "BAL", teamName: "Love Beatin My Meat", isUser: true },
        { playerId: "CIN", teamName: "Rival", isUser: false },
        { playerId: "MIN", teamName: "Other", isUser: false },
      ],
    });

    expect(isPlayerOnSelectedTeam({ name: "BAL Defense", team: "BAL", position: "DEF" }, hoeAss)).toBe(true);
    expect(isPlayerOnSelectedTeam({ name: "CIN Defense", team: "CIN", position: "DEF" }, hoeAss)).toBe(false);
    expect(isPlayerOnSelectedTeam({ name: "MIN Defense", team: "MIN", position: "DEF" }, hoeAss)).toBe(false);
  });

  it("matches kickers on the viewer roster by name and team", () => {
    const leagueState = league({
      starters: [{ playerId: "k1", name: "Justin Tucker", team: "BAL", position: "K" }],
      rosteredPlayerIds: ["k1", "k2"],
    });
    expect(isPlayerOnSelectedTeam({ name: "Justin Tucker", team: "BAL", position: "K" }, leagueState)).toBe(true);
    expect(isPlayerOnSelectedTeam({ name: "Harrison Butker", team: "KC", position: "K" }, leagueState)).toBe(false);
  });

  it("uses user rosterAssignments when starters omit a DST", () => {
    const leagueState = league({
      starters: [],
      bench: [],
      rosteredPlayerIds: ["SEA", "SF"],
      rosterAssignments: [
        { playerId: "SEA", teamName: "Mine", isUser: true },
        { playerId: "SF", teamName: "Theirs", isUser: false },
      ],
    });
    expect(isPlayerOnSelectedTeam({ name: "SEA Defense", team: "SEA", position: "DEF" }, leagueState)).toBe(true);
    expect(isPlayerOnSelectedTeam({ name: "SF Defense", team: "SF", position: "DEF" }, leagueState)).toBe(false);
  });
});

describe("chartOwnershipForEntity", () => {
  const leagueState = league({
    starters: [{ playerId: "BAL", name: "Baltimore Ravens", team: "BAL", position: "DEF" }],
    bench: [{ playerId: "k1", name: "Justin Tucker", team: "BAL", position: "K" }],
    rosteredPlayerIds: ["BAL", "CIN", "k1", "k2"],
    rosterAssignments: [
      { playerId: "BAL", teamName: "Mine", isUser: true },
      { playerId: "CIN", teamName: "Rival", isUser: false },
      { playerId: "k1", teamName: "Mine", isUser: true },
      { playerId: "k2", teamName: "Rival", isUser: false },
    ],
  });

  it("classifies mine / rostered / available for DST", () => {
    expect(chartOwnershipForEntity({ name: "BAL Defense", team: "BAL", position: "DEF" }, leagueState)).toBe("mine");
    expect(chartOwnershipForEntity({ name: "CIN Defense", team: "CIN", position: "DEF" }, leagueState)).toBe("rostered");
    expect(chartOwnershipForEntity({ name: "ARI Defense", team: "ARI", position: "DEF" }, leagueState)).toBe("available");
  });

  it("classifies mine / rostered / available for kickers", () => {
    expect(chartOwnershipForEntity({ name: "Justin Tucker", team: "BAL", position: "K", playerId: "k1" }, leagueState)).toBe("mine");
    expect(chartOwnershipForEntity({ name: "Harrison Butker", team: "KC", position: "K", playerId: "k2" }, leagueState)).toBe("rostered");
    expect(chartOwnershipForEntity({ name: "Jake Moody", team: "SF", position: "K", playerId: "k3" }, leagueState)).toBe("available");
  });

  it("treats league-rosteredPlayerIds as rostered for skill ids without a name match", () => {
    expect(isPlayerRosteredInLeague({ name: "Waived WR", team: "CHI", position: "WR", playerId: "missing" }, leagueState)).toBe(false);
    expect(isPlayerRosteredInLeague({ name: "Rival K", team: "KC", position: "K", playerId: "k2" }, leagueState)).toBe(true);
  });

  it("does not mark GSIS-only analytics entities as rostered via encoded id", () => {
    const withSleeperRoster = league({
      rosteredPlayerIds: ["12526"],
      rosterAssignments: [{ playerId: "12526", teamName: "Rival", isUser: false }],
    });
    // Without a resolved Sleeper playerId, GSIS in entity.id must not match rosteredPlayerIds.
    expect(chartOwnershipForEntity({
      name: "Puka Nacua",
      team: "LAR",
      position: "WR",
      id: "WR:00-0037834",
    }, withSleeperRoster)).toBe("available");
    expect(chartOwnershipForEntity({
      name: "Puka Nacua",
      team: "LAR",
      position: "WR",
      id: "WR:00-0037834",
      playerId: "12526",
    }, withSleeperRoster)).toBe("rostered");
  });
});
