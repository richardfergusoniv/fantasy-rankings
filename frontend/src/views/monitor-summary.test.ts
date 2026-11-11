import { describe, expect, it } from "vitest";
import { sortMonitorSummaries, summarizeLeagueForMonitor } from "./monitor-summary";
import type { League, RosterPlayer } from "../dashboard-types";

const NOW = Date.parse("2026-11-15T15:00:00Z");

function player(over: Partial<RosterPlayer>): RosterPlayer {
  return {
    playerId: "p", name: "Test Player", team: "KC", position: "WR", lineupSlot: "WR", isStarter: true,
    rank: null, projection: 10, projectionSource: null, actual: null, gamePhase: "pregame",
    gameTime: "2026-11-15T18:00:00Z", opponent: "LV", isAway: false, isBye: false, injuryStatus: null,
    defenseComponents: null, projectionComponents: null,
    ...over,
  } as RosterPlayer;
}

function league(starters: RosterPlayer[], bench: RosterPlayer[] = [], opponent: RosterPlayer[] | null = []): League {
  return {
    id: "L1", name: "Test League", starters, bench,
    opponentTeam: opponent ? { name: "Rivals", teamActual: null, teamProjection: null, starters: opponent, bench: [] } : null,
  } as unknown as League;
}

describe("summarizeLeagueForMonitor", () => {
  it("reports no issues when every starter is healthy and nothing on the bench is better", () => {
    const result = summarizeLeagueForMonitor(league([player({ playerId: "a", projection: 12 })], [player({ playerId: "b", projection: 5, isStarter: false })]), NOW);
    expect(result.issues).toEqual([]);
  });

  it("flags a starter who is out, on bye, or missing", () => {
    const result = summarizeLeagueForMonitor(league([
      player({ playerId: "a", name: "Amon Okafor", injuryStatus: "Out" }),
      player({ playerId: "b", name: "Tyler Abara", isBye: true, lineupSlot: "RB", position: "RB" }),
      player({ playerId: "0", name: "", lineupSlot: "TE", position: "TE" }),
    ]), NOW);
    expect(result.issues.map((issue) => issue.kind).sort()).toEqual(["bye", "empty", "out"]);
    expect(result.issues.find((issue) => issue.kind === "out")?.label).toBe("Okafor out");
    expect(result.issues.find((issue) => issue.kind === "empty")?.label).toBe("TE empty");
  });

  it("does not flag an out player whose game is already over", () => {
    const result = summarizeLeagueForMonitor(league([player({ injuryStatus: "Out", gamePhase: "final", actual: 8 })]), NOW);
    expect(result.issues.some((issue) => issue.kind === "out")).toBe(false);
  });

  it("flags a bench player who is clearly better, and only above the threshold", () => {
    const starter = player({ playerId: "a", projection: 8 });
    const better = player({ playerId: "b", projection: 13, isStarter: false, lineupSlot: null });
    const barely = player({ playerId: "c", projection: 9, isStarter: false, lineupSlot: null });
    expect(summarizeLeagueForMonitor(league([starter], [better]), NOW).issues.map((issue) => issue.label)).toEqual(["Bench +5.0"]);
    expect(summarizeLeagueForMonitor(league([starter], [barely]), NOW).issues).toEqual([]);
  });

  it("computes margin and win chance against the opponent, and null without one", () => {
    const mine = [player({ playerId: "a", projection: 20 })];
    const theirs = [player({ playerId: "x", projection: 10 })];
    const result = summarizeLeagueForMonitor(league(mine, [], theirs), NOW);
    expect(result.margin).toBe(10);
    expect(result.winPercent).toBeGreaterThan(50);
    expect(result.opponentName).toBe("Rivals");
    const none = summarizeLeagueForMonitor(league(mine, [], null), NOW);
    expect(none.margin).toBeNull();
    expect(none.winPercent).toBeNull();
  });
});

describe("sortMonitorSummaries", () => {
  it("puts leagues with problems first and keeps each group's order", () => {
    const sorted = sortMonitorSummaries([
      { id: "a", issues: [] }, { id: "b", issues: [1] }, { id: "c", issues: [] }, { id: "d", issues: [1, 2] },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
  });
});
