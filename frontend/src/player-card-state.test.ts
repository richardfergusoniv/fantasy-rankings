import { expect, it } from "vitest";
import type { PlayerSearchResult } from "./dashboard-types";
import { refreshPlayerCard, playerPointsLabel, playerWeeklyRank } from "./player-card-state";
it("refreshes final and next-week data without adding history or changing its index", () => {
  const previous = { playerId: "a" } as PlayerSearchResult;
  const player = { playerId: "b", gamePhase: "pregame", weeklyProjection: 20 } as PlayerSearchResult;
  const history = { entries: [previous, player], index: 1 };
  const final = { ...player, gamePhase: "final" as const, actual: 0, weeklyProjection: 0 };
  const updated = refreshPlayerCard(history, final);
  expect(updated).toEqual({ entries: [previous, final], index: 1 });
  expect(history.entries[1]).toBe(player);
  expect(refreshPlayerCard(updated, { ...final })).toBe(updated);
  expect(refreshPlayerCard(updated, player)).toEqual(history);
  expect(refreshPlayerCard(history, previous)).toBe(history);
});
it("labels only available final actuals as points", () => {
  expect(playerPointsLabel({ gamePhase: "final", actual: 0 })).toBe("points");
  expect(playerPointsLabel({ gamePhase: "final", actual: null })).toBe("projection");
  expect(playerPointsLabel({ gamePhase: "final" })).toBe("projection");
  expect(playerPointsLabel({ gamePhase: "live", actual: 10 })).toBe("live projection");
  expect(playerPointsLabel({ gamePhase: "pregame" })).toBe("projection");
});

it("keeps final actual ranks without projections in either scoring lens", () => {
  const weekly = { leagueProjection: null, gamePhase: "final" as const, actual: 27.4, pprRank: 1, halfPprRank: 2 };
  expect(playerWeeklyRank(weekly, "ppr")).toBe(1);
  expect(playerWeeklyRank(weekly, "halfPpr")).toBe(2);
  expect(playerWeeklyRank({ ...weekly, actual: 0 }, "ppr")).toBe(1);
  expect(playerWeeklyRank({ ...weekly, actual: -2 }, "ppr")).toBe(1);
  for (const actual of [null, NaN, Infinity]) {
    expect(playerWeeklyRank({ ...weekly, actual }, "ppr")).toBeNull();
  }
  for (const gamePhase of ["live", "pregame"] as const) {
    expect(playerWeeklyRank({ ...weekly, gamePhase }, "ppr")).toBeNull();
    expect(playerWeeklyRank({ ...weekly, gamePhase, leagueProjection: 0 }, "ppr")).toBe(1);
  }
});
