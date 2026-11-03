import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Dashboard, rosterPlayerSchema } from "./dashboard-schemas.js";

type RosterPlayer = z.infer<typeof rosterPlayerSchema>;
import { blendProjection } from "./move-scoring.js";
import {
  __testParseSnapshotMetrics,
  collectSnapshotPlayers,
  pfnWeekKey,
  scoringSnapshotId,
  sleeperTrendingWeekKey,
} from "./scoring-jobs.js";

describe("scoring job keys", () => {
  it("builds stable weekly cache keys", () => {
    expect(sleeperTrendingWeekKey(2026, 7)).toBe("sleeper-trending:2026-w7");
    expect(pfnWeekKey("offense", 2026, 7)).toBe("pfn:offense:2026-w7");
    expect(scoringSnapshotId(2026, 7, "lg1", "p1")).toBe("2026:7:lg1:p1");
  });
});

describe("snapshot holdout metrics", () => {
  it("computes player-games and RMSE from finalized snapshot rows", () => {
    const metrics = __testParseSnapshotMetrics([
      { week: 5, inputsJson: JSON.stringify({ pStar: 10 }), finalPoints: 1200 },
      { week: 5, inputsJson: JSON.stringify({ pStar: 14 }), finalPoints: 1000 },
      { week: 6, inputsJson: JSON.stringify({ pStar: 8 }), finalPoints: 800 },
      { week: 6, inputsJson: JSON.stringify({ pStar: 9 }), finalPoints: null },
      { week: 6, inputsJson: "{bad", finalPoints: 500 },
    ]);
    expect(metrics.playerGames).toBe(3);
    // errors: (10-12)^2 + (14-10)^2 + (8-8)^2 = 4+16+0 = 20; rmse = sqrt(20/3)
    expect(metrics.rmse).toBeCloseTo(Math.sqrt(20 / 3), 5);
  });
});

describe("collectSnapshotPlayers usage inputs", () => {
  const rosterRow = (patch: Partial<RosterPlayer>): RosterPlayer => ({
    playerId: "p1",
    name: "Player One",
    team: "KC",
    position: "WR",
    lineupSlot: "WR",
    isStarter: true,
    rank: 1,
    projection: 12,
    projectionSource: "vegas",
    actual: null,
    gamePhase: "pregame",
    gameTime: null,
    opponent: "LV",
    isAway: false,
    isBye: false,
    injuryStatus: null,
    defenseComponents: null,
    projectionComponents: null,
    ...patch,
  });

  it("carries usage from roster rows into the blend, and none for rankings-only rows", () => {
    const dashboard = {
      leagues: [{
        id: "lg1",
        starters: [rosterRow({ usageProjection: 16, usageGames: 6 })],
        bench: [],
        tradeWaiverPool: [],
      }],
      rankings: [{
        playerId: "p9", leagueId: "lg1", name: "Board Only", position: "RB", team: "BUF",
        leagueProjection: 11, injuryStatus: null, isBye: false,
      }],
    } as unknown as Dashboard;
    const players = collectSnapshotPlayers(dashboard, "lg1");
    const rostered = players.find((player) => player.playerId === "p1")!;
    expect(rostered.usageProjection).toBe(16);
    expect(rostered.usageGames).toBe(6);
    const blend = blendProjection(rostered, {});
    expect(blend.u).toBe(16);
    expect(blend.pStar).toBeGreaterThan(12);
    expect(blend.pStar).toBeLessThan(16);
    const boardOnly = players.find((player) => player.playerId === "p9")!;
    expect(boardOnly.usageProjection).toBeNull();
    // No usage input: the blend runs Vegas-only (wV 1, P* = V).
    const boardBlend = blendProjection(boardOnly, {});
    expect(boardBlend.wV).toBe(1);
    expect(boardBlend.pStar).toBe(11);
  });
});
