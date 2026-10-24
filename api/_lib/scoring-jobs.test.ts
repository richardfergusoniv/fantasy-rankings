import { describe, expect, it } from "vitest";
import {
  __testParseSnapshotMetrics,
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
