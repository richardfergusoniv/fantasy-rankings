import { expect, it } from "vitest";
import type { PlayerSearchResult } from "./dashboard-types";
import { refreshPlayerCard, playerPointsLabel } from "./player-card-state";
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
