import { describe, expect, it } from "vitest";
import { playoffOddsFromProjections } from "./projected-playoff-odds.js";
import type { ProjectedStandings } from "./projected-standings.js";

const team = (rosterId: number, teamName: string, wins: number, losses: number, isUser = false) => ({
  rosterId, teamName, isUser, rank: rosterId, currentRank: rosterId,
  record: { wins, losses, ties: 0 }, projectedRecord: { wins, losses, ties: 0 },
  pointsFor: 400, projectedPointsFor: 400, inPlayoffs: false,
});

const projected = (games: ProjectedStandings["games"]): ProjectedStandings => ({
  leagueId: "lg", throughWeek: 4, regularSeasonEndsWeek: 6, playoffTeams: 2, divisionsIgnored: false, medianMatchup: false,
  missingWeeks: [], projectionsAsOf: null,
  teams: [team(1, "A", 3, 1, true), team(2, "B", 2, 2), team(3, "C", 2, 2), team(4, "D", 0, 4)],
  games,
});

describe("playoffOddsFromProjections", () => {
  const games = [
    { week: 5, rosterIdA: 1, rosterIdB: 4, projectedA: 130, projectedB: 90 },
    { week: 5, rosterIdA: 2, rosterIdB: 3, projectedA: 110, projectedB: 112 },
    { week: 6, rosterIdA: 1, rosterIdB: 2, projectedA: 120, projectedB: 100 },
    { week: 6, rosterIdA: 3, rosterIdB: 4, projectedA: 115, projectedB: 95 },
  ];

  it("decides games by projected scores and keeps the probabilities coherent", () => {
    const odds = playoffOddsFromProjections(projected(games), 4000);
    expect(odds.userGames.map((g) => g.week)).toEqual([5, 6]);
    expect(odds.userGames[0]!.opponent).toBe("D");
    expect(odds.userGames[0]!.winChance).toBeGreaterThan(90);
    expect(odds.userGames[1]!.projectedFor).toBe(120);
    expect(odds.userGames[1]!.projectedAgainst).toBe(100);
    expect(odds.userGames[1]!.winChance).toBeGreaterThan(50);
    expect(odds.userGames[1]!.winChance).toBeLessThan(90);
    const spots = odds.teams.reduce((sum, t) => sum + t.playoffPct, 0);
    expect(spots).toBeGreaterThan(199);
    expect(spots).toBeLessThan(201);
    const lastTotal = odds.teams.reduce((sum, t) => sum + t.lastPct, 0);
    expect(Math.round(lastTotal)).toBe(100);
  });

  it("ranks the stronger projected team above the weaker one", () => {
    const odds = playoffOddsFromProjections(projected(games), 4000);
    const by = Object.fromEntries(odds.teams.map((t) => [t.teamName, t]));
    expect(by.A!.playoffPct).toBeGreaterThan(by.D!.playoffPct);
    expect(by.D!.lastPct).toBeGreaterThan(by.A!.lastPct);
  });

  it("is deterministic and reports scenarios for the user", () => {
    const a = playoffOddsFromProjections(projected(games), 2000);
    const b = playoffOddsFromProjections(projected(games), 2000);
    expect(a).toEqual(b);
    expect(a.userScenarios.length).toBeGreaterThan(0);
  });

  it("with no games left, odds follow the standings", () => {
    const odds = playoffOddsFromProjections(projected([]), 500);
    const by = Object.fromEntries(odds.teams.map((t) => [t.teamName, t]));
    expect(by.A!.playoffPct).toBe(100);
    expect(by.D!.playoffPct).toBe(0);
    expect(odds.userGames).toEqual([]);
  });
});
