import { describe, expect, it } from "vitest";
import { simulatePlayoffOdds, winProbability } from "./playoff-odds.js";

const team = (rosterId: number, wins: number, losses: number, pointsFor: number, isUser = false) => ({
  rosterId,
  teamName: `T${rosterId}`,
  isUser,
  wins,
  losses,
  ties: 0,
  pointsFor,
});

describe("winProbability", () => {
  it("is even for equal teams and favors the higher scorer", () => {
    expect(winProbability(100, 100)).toBeCloseTo(0.5, 5);
    expect(winProbability(120, 100)).toBeGreaterThan(0.7);
    expect(winProbability(100, 120)).toBeLessThan(0.3);
  });
});

describe("simulatePlayoffOdds", () => {
  const teams = [
    team(1, 8, 0, 960, true),
    team(2, 4, 4, 800),
    team(3, 4, 4, 790),
    team(4, 0, 8, 640),
  ];
  const games = [
    { week: 9, a: 1, b: 4 },
    { week: 9, a: 2, b: 3 },
  ];

  it("is deterministic for a seed and sums playoff spots to the cutoff", () => {
    const a = simulatePlayoffOdds({ teams, games, playoffTeams: 2, trials: 500 });
    const b = simulatePlayoffOdds({ teams, games, playoffTeams: 2, trials: 500 });
    expect(a).toEqual(b);
    const total = a.teams.reduce((sum, row) => sum + row.playoffPct, 0);
    expect(total).toBeGreaterThan(199);
    expect(total).toBeLessThan(201);
  });

  it("clinches a dominant team and eliminates a winless one", () => {
    const odds = simulatePlayoffOdds({ teams, games, playoffTeams: 2, trials: 1000 });
    expect(odds.teams.find((row) => row.rosterId === 1)!.playoffPct).toBe(100);
    expect(odds.teams.find((row) => row.rosterId === 4)!.playoffPct).toBe(0);
    expect(odds.gamesRemaining).toBe(2);
  });

  it("reports what the user's final win total means", () => {
    const close = [team(1, 4, 4, 800, true), team(2, 5, 3, 810), team(3, 4, 4, 790), team(4, 3, 5, 760)];
    const odds = simulatePlayoffOdds({
      teams: close,
      games: [{ week: 9, a: 1, b: 2 }, { week: 9, a: 3, b: 4 }],
      playoffTeams: 2,
      trials: 2000,
    });
    const [lose, win] = odds.userScenarios;
    expect(lose!.finalWins).toBe(4);
    expect(win!.finalWins).toBe(5);
    expect(win!.playoffPct).toBeGreaterThan(lose!.playoffPct);
  });
});
