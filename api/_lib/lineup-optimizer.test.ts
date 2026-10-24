import { describe, expect, it } from "vitest";
import {
  activeBenchIds,
  displayedMatchupPoints,
  espnStatusToPhase,
  gameElapsedFraction,
  isLineupLocked,
  isUnavailableStatus,
  LIVE_PACE_BLEND_END,
  LIVE_PACE_BLEND_START,
  LIVE_PACE_REMAINING_CAP,
  LIVE_PACE_TOTAL_CAP,
  liveForecastPoints,
  livePaceBlendWeight,
  liveRemainingProjection,
  lineupCountingPoints,
  mapSubmittedStarters,
  normalizeGamePhase,
  optimizeLineup,
  optimizeTradeRoster,
  optimizeValueTradeRoster,
  powerRankingPoints,
  sumLiveForecast,
  type OptimizablePlayer,
} from "./lineup-optimizer.js";

const now = Date.parse("2026-10-11T18:00:00.000Z");

function player(overrides: Partial<OptimizablePlayer> & Pick<OptimizablePlayer, "playerId" | "position">): OptimizablePlayer {
  return {
    lineupSlot: null,
    isStarter: false,
    projection: null,
    actual: null,
    gamePhase: "pregame",
    gameTime: "2026-10-11T20:00:00.000Z",
    gamePeriod: null,
    gameClockSeconds: null,
    ...overrides,
  };
}

describe("optimizeLineup", () => {
  it("keeps an underperforming locked starter in their slot", () => {
    const bust = player({
      playerId: "bust",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: 18,
      actual: 2,
      gamePhase: "final",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const replacement = player({ playerId: "fresh", position: "WR", projection: 14 });
    const optimized = optimizeLineup([bust], [replacement], now);

    expect(optimized.starters.map((starter) => starter.playerId)).toEqual(["bust"]);
    expect(optimized.starters[0]).toMatchObject({ lineupSlot: "WR", isStarter: true });
    expect(optimized.bench.map((reserve) => reserve.playerId)).toEqual(["fresh"]);
    expect(lineupCountingPoints(bust, now)).toBe(2);

    const liveBust = player({
      playerId: "live-bust",
      position: "RB",
      lineupSlot: "RB",
      isStarter: true,
      projection: 16,
      actual: 3,
      gamePhase: "live",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const liveOptimized = optimizeLineup([liveBust], [player({ playerId: "rb-bench", position: "RB", projection: 12 })], now);
    expect(liveOptimized.starters.map((starter) => starter.playerId)).toEqual(["live-bust"]);
    expect(lineupCountingPoints(liveBust, now)).toBe(3);
  });

  it("does not slot in a locked bench player", () => {
    const starter = player({
      playerId: "starter",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: 8,
    });
    const alreadyPlayed = player({
      playerId: "bench-boom",
      position: "WR",
      projection: 4,
      actual: 25,
      gamePhase: "final",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const optimized = optimizeLineup([starter], [alreadyPlayed], now);

    expect(optimized.starters.map((row) => row.playerId)).toEqual(["starter"]);
    expect(optimized.bench.map((row) => row.playerId)).toEqual(["bench-boom"]);
    expect(optimized.bench[0]).toMatchObject({ isStarter: false, lineupSlot: null });
  });

  it("optimizes unlocked players around locked ones and respects flex eligibility", () => {
    const lockedRb = player({
      playerId: "locked-rb",
      position: "RB",
      lineupSlot: "RB",
      isStarter: true,
      projection: 16,
      actual: 3,
      gamePhase: "final",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const flexStarter = player({
      playerId: "flex-starter",
      position: "WR",
      lineupSlot: "FLEX",
      isStarter: true,
      projection: 6,
    });
    const betterFlex = player({ playerId: "better-flex", position: "WR", projection: 12 });
    const lockedBenchRb = player({
      playerId: "locked-bench-rb",
      position: "RB",
      projection: 2,
      actual: 22,
      gamePhase: "live",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const ineligibleQb = player({ playerId: "bench-qb", position: "QB", projection: 20 });
    const optimized = optimizeLineup(
      [lockedRb, flexStarter],
      [betterFlex, lockedBenchRb, ineligibleQb],
      now,
    );

    expect(optimized.starters.map((starter) => [starter.playerId, starter.lineupSlot])).toEqual([
      ["locked-rb", "RB"],
      ["better-flex", "FLEX"],
    ]);
    expect(optimized.bench.map((reserve) => reserve.playerId)).toEqual(["flex-starter", "locked-bench-rb", "bench-qb"]);

    const lockedQb = player({
      playerId: "locked-qb",
      position: "QB",
      lineupSlot: "QB",
      isStarter: true,
      projection: 20,
      actual: 4,
      gamePhase: "live",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const superflexStarter = player({
      playerId: "super-wr",
      position: "WR",
      lineupSlot: "SUPER_FLEX",
      isStarter: true,
      projection: 5,
    });
    const superflex = optimizeLineup(
      [lockedQb, superflexStarter],
      [
        player({ playerId: "bench-qb-2", position: "QB", projection: 18 }),
        player({ playerId: "bench-rb", position: "RB", projection: 12 }),
      ],
      now,
    );
    expect(superflex.starters.map((starter) => [starter.playerId, starter.lineupSlot])).toEqual([
      ["locked-qb", "QB"],
      ["bench-qb-2", "SUPER_FLEX"],
    ]);
  });

  it("locks a player whose kickoff has passed and still moves a pregame player who only has a zero actual", () => {
    const started = player({
      playerId: "started",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: 19,
      actual: 1,
      gamePhase: null,
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const waiting = player({ playerId: "waiting", position: "WR", projection: 14 });
    expect(optimizeLineup([started], [waiting], now).starters.map((starter) => starter.playerId)).toEqual(["started"]);

    const pregame = player({
      playerId: "pregame",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: 4,
      actual: 0,
      gamePhase: "pregame",
    });
    const better = player({ playerId: "better", position: "WR", projection: 10 });
    const optimized = optimizeLineup([pregame], [better], now);
    expect(optimized.starters.map((starter) => starter.playerId)).toEqual(["better"]);
    expect(optimized.bench.map((reserve) => reserve.playerId)).toEqual(["pregame"]);
  });

  it("keeps an empty starter slot so a healthy player can fill it", () => {
    const qb = player({ playerId: "qb", position: "QB", lineupSlot: "QB", isStarter: true, projection: 18 });
    const vacantFlex = player({ playerId: "0", position: "FLEX", lineupSlot: "FLEX", isStarter: true, projection: null });
    const benchWr = player({ playerId: "wr", position: "WR", projection: 11 });
    const optimized = optimizeLineup([qb, vacantFlex], [benchWr], now);

    expect(mapSubmittedStarters(["qb", "0", "rb"], (id) => id, () => "vacant")).toEqual(["qb", "vacant", "rb"]);
    expect(optimized.starters.map((starter) => [starter.playerId, starter.lineupSlot])).toEqual([
      ["qb", "QB"],
      ["wr", "FLEX"],
    ]);
    expect(optimized.bench.map((reserve) => reserve.playerId)).toEqual([]);
  });

  it("does not let an unavailable player replace a bye or fill an empty slot", () => {
    const byeWr = player({
      playerId: "bye-wr",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: null,
      isBye: true,
    });
    const outBench = player({ playerId: "out-wr", position: "WR", projection: 0, injuryStatus: "Out" });
    const irBench = player({ playerId: "ir-wr", position: "WR", projection: 0, injuryStatus: "IR" });
    const kept = optimizeLineup([byeWr], [outBench, irBench], now);
    expect(kept.starters.map((starter) => starter.playerId)).toEqual(["bye-wr"]);
    expect(kept.bench.map((reserve) => reserve.playerId)).toEqual(["out-wr", "ir-wr"]);

    const healthy = player({ playerId: "healthy-wr", position: "WR", projection: 9 });
    const replaced = optimizeLineup([byeWr], [outBench, healthy], now);
    expect(replaced.starters.map((starter) => starter.playerId)).toEqual(["healthy-wr"]);
    expect(replaced.bench.map((reserve) => reserve.playerId)).toEqual(["bye-wr", "out-wr"]);

    const vacant = player({ playerId: "0", position: "WR", lineupSlot: "WR", isStarter: true });
    const hole = optimizeLineup([vacant], [outBench], now);
    expect(hole.starters.map((starter) => starter.playerId)).toEqual(["0"]);
    expect(hole.bench.map((reserve) => reserve.playerId)).toEqual(["out-wr"]);
  });
});

describe("matchup points and bench pool", () => {
  it("shows live points once an actual is posted and keeps a projection when it is not", () => {
    expect(displayedMatchupPoints({ gamePhase: "live", actual: 7.4, projection: 16 })).toEqual({ value: 7.4, label: "PTS" });
    expect(displayedMatchupPoints({ gamePhase: "live", actual: 0, projection: 16 })).toEqual({ value: 0, label: "PTS" });
    expect(displayedMatchupPoints({ gamePhase: "live", actual: null, projection: 16 })).toEqual({ value: 16, label: "PROJ" });
    expect(displayedMatchupPoints({ gamePhase: "pregame", actual: 0, projection: 12 })).toEqual({ value: 12, label: "PROJ" });
    expect(displayedMatchupPoints({ gamePhase: "final", actual: 9, projection: 14 })).toEqual({ value: 9, label: "PTS" });
  });

  it("counts live actuals in power rankings and drops reserve and taxi from the bench", () => {
    const live = player({
      playerId: "live",
      position: "WR",
      projection: 18,
      actual: 4,
      gamePhase: "live",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    expect(powerRankingPoints(live, now)).toBe(4);
    expect(lineupCountingPoints(live, now)).toBe(4);
    expect(powerRankingPoints(player({ playerId: "0", position: "FLEX", lineupSlot: "FLEX", isStarter: true }), now)).toBeNull();
    expect(activeBenchIds(["qb", "wr", "ir", "taxi", "0"], ["qb", "0"], ["ir"], ["taxi"])).toEqual(["wr"]);
  });
});

describe("optimizeTradeRoster", () => {
  it("keeps a locked starter in place and does not start a locked bench boom", () => {
    const locked = player({
      playerId: "locked-wr",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: 18,
      actual: 2,
      gamePhase: "final",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const fresh = player({ playerId: "fresh-wr", position: "WR", projection: 14 });
    const lockedBench = player({
      playerId: "bench-boom",
      position: "WR",
      projection: 4,
      actual: 25,
      gamePhase: "final",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const graded = optimizeTradeRoster([locked, fresh, lockedBench], ["WR"], now);

    expect(graded.starters.map((starter) => starter.playerId)).toEqual(["locked-wr"]);
    expect(graded.bench.map((reserve) => reserve.playerId)).toEqual(["fresh-wr", "bench-boom"]);
    expect(graded.score).toBe(2);
  });

  it("fills Season Long starters by board value, not weekly projection", () => {
    const highProj = player({
      playerId: "boom",
      position: "WR",
      isStarter: false,
      projection: 20,
    });
    const highValue = player({
      playerId: "hold",
      position: "WR",
      isStarter: false,
      projection: 8,
    });
    const values = new Map([
      ["boom", 1_000],
      ["hold", 8_000],
    ]);
    const graded = optimizeValueTradeRoster([highProj, highValue], ["WR"], values, now);
    expect(graded.starters.map((starter) => starter.playerId)).toEqual(["hold"]);
    expect(graded.score).toBe(8_000);
  });

  it("keeps locked starters pinned but scores them by window value", () => {
    const locked = player({
      playerId: "locked-wr",
      position: "WR",
      lineupSlot: "WR",
      isStarter: true,
      projection: 18,
      actual: 2,
      gamePhase: "final",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    const bench = player({ playerId: "bench-wr", position: "WR", projection: 14 });
    const values = new Map([
      ["locked-wr", 5_000],
      ["bench-wr", 9_000],
    ]);
    const graded = optimizeValueTradeRoster([locked, bench], ["WR"], values, now);
    expect(graded.starters.map((starter) => starter.playerId)).toEqual(["locked-wr"]);
    expect(graded.score).toBe(5_000);
  });

  it("ranks a high-value bye-week player as a Season Long starter", () => {
    const byeStar = player({
      playerId: "bye-wr",
      position: "WR",
      isStarter: false,
      projection: 0,
      isBye: true,
    });
    const active = player({
      playerId: "active-wr",
      position: "WR",
      isStarter: false,
      projection: 15,
      isBye: false,
    });
    const values = new Map([
      ["bye-wr", 9_000],
      ["active-wr", 2_000],
    ]);
    const graded = optimizeValueTradeRoster([byeStar, active], ["WR"], values, now);
    expect(graded.starters.map((starter) => starter.playerId)).toEqual(["bye-wr"]);
    expect(graded.score).toBe(9_000);
  });
});

describe("liveForecastPoints", () => {
  it("keeps Current and Optimized totals consistent for the same live lineup", () => {
    const starters = [
      player({
        playerId: "qb",
        position: "QB",
        lineupSlot: "QB",
        isStarter: true,
        projection: 20,
        actual: 6,
        gamePhase: "live",
        gameTime: "2026-10-11T17:00:00.000Z",
        gamePeriod: 1,
        gameClockSeconds: 600,
      }),
      player({
        playerId: "rb",
        position: "RB",
        lineupSlot: "RB",
        isStarter: true,
        projection: 14,
        actual: 3,
        gamePhase: "live",
        gameTime: "2026-10-11T17:00:00.000Z",
        gamePeriod: 1,
        gameClockSeconds: 600,
      }),
      player({
        playerId: "wr",
        position: "WR",
        lineupSlot: "WR",
        isStarter: true,
        projection: 12,
        gamePhase: "pregame",
        gameTime: "2026-10-11T20:00:00.000Z",
      }),
    ];
    const currentTotal = sumLiveForecast(starters, now);
    const optimized = optimizeLineup(starters, [], now);
    expect(sumLiveForecast(optimized.starters, now)).toBe(currentTotal);
    expect(optimized.starters.map((starter) => starter.playerId)).toEqual(["qb", "rb", "wr"]);
  });

  it("blends pace with named remaining and total caps so an early TD does not over-project", () => {
    expect(LIVE_PACE_BLEND_START).toBeLessThan(LIVE_PACE_BLEND_END);
    expect(LIVE_PACE_REMAINING_CAP).toBeCloseTo(1.1);
    expect(LIVE_PACE_TOTAL_CAP).toBeCloseTo(1.35);
    expect(livePaceBlendWeight(0)).toBe(LIVE_PACE_BLEND_START);
    expect(livePaceBlendWeight(1)).toBe(LIVE_PACE_BLEND_END);

    // QB proj 20 with 7 pts at 12:00 left in Q1 → near 27–28 (neutral time path is 26).
    const twelveLeft = liveForecastPoints(player({
      playerId: "q1-td",
      position: "QB",
      projection: 20,
      actual: 7,
      gamePhase: "live",
      gamePeriod: 1,
      gameClockSeconds: 720,
    }), now);
    expect(twelveLeft).toBeGreaterThanOrEqual(27);
    expect(twelveLeft).toBeLessThanOrEqual(28);

    // QB with 20 pts one minute in must not project near 45.
    const oneMinuteIn = liveForecastPoints(player({
      playerId: "instant-boom",
      position: "QB",
      projection: 20,
      actual: 20,
      gamePhase: "live",
      gamePeriod: 1,
      gameClockSeconds: 840,
    }), now);
    expect(oneMinuteIn).toBeGreaterThanOrEqual(20);
    expect(oneMinuteIn).toBeLessThanOrEqual(20 * LIVE_PACE_TOTAL_CAP + 1e-9);
    expect(oneMinuteIn).toBeLessThan(30);

    // Halftime: QB 20 with 12 pts stays about 22–23.
    const halftime = liveForecastPoints(player({
      playerId: "ht-qb",
      position: "QB",
      projection: 20,
      actual: 12,
      gamePhase: "live",
      gamePeriod: 2,
      gameClockSeconds: 0,
    }), now);
    expect(halftime).toBeGreaterThanOrEqual(22);
    expect(halftime).toBeLessThanOrEqual(23);

    // Late game still moves with pace (underperforming QB shrinks below neutral 20).
    const late = liveForecastPoints(player({
      playerId: "late-qb",
      position: "QB",
      projection: 20,
      actual: 14,
      gamePhase: "live",
      gamePeriod: 4,
      gameClockSeconds: 300,
    }), now);
    expect(late).toBeGreaterThan(14);
    expect(late).toBeLessThan(20);

    const elapsed = gameElapsedFraction(1, 720);
    const remaining = liveRemainingProjection({
      pregameProjection: 20,
      actual: 7,
      elapsedFraction: elapsed!,
      position: "QB",
    });
    const timeBased = 20 * (1 - elapsed!);
    expect(remaining).toBeLessThanOrEqual(timeBased * LIVE_PACE_REMAINING_CAP + 1e-9);
  });

  it("counts final actuals, pregame projections, and bye as zero", () => {
    expect(liveForecastPoints(player({
      playerId: "done",
      position: "WR",
      projection: 15,
      actual: 9.4,
      gamePhase: "final",
    }), now)).toBe(9.4);
    expect(liveForecastPoints(player({
      playerId: "waiting",
      position: "WR",
      projection: 11,
      actual: 0,
      gamePhase: "pregame",
    }), now)).toBe(11);
    expect(liveForecastPoints(player({
      playerId: "bye",
      position: "RB",
      projection: null,
      isBye: true,
      gamePhase: "pregame",
    }), now)).toBe(0);
  });

  it("uses projection for a stale pregame payload after kickoff instead of actual 0", () => {
    const stale = player({
      playerId: "stale",
      position: "WR",
      projection: 16,
      actual: 0,
      gamePhase: "pregame",
      gameTime: "2026-10-11T17:00:00.000Z",
    });
    expect(isLineupLocked(stale, now)).toBe(true);
    expect(lineupCountingPoints(stale, now)).toBe(0);
    expect(liveForecastPoints(stale, now)).toBe(16);
  });

  it("does not lock on date-only kickoff strings", () => {
    const dateOnly = player({
      playerId: "date-only",
      position: "WR",
      projection: 13,
      actual: 0,
      gamePhase: "pregame",
      gameTime: "2026-10-11",
    });
    expect(isLineupLocked(dateOnly, now)).toBe(false);
    expect(liveForecastPoints(dateOnly, now)).toBe(13);
  });

  it("maps delayed/suspended/postponed/canceled phases correctly", () => {
    expect(normalizeGamePhase("canceled")).toBe("pregame");
    expect(normalizeGamePhase("cancelled")).toBe("pregame");
    expect(normalizeGamePhase("postponed")).toBe("pregame");
    expect(normalizeGamePhase("STATUS_POSTPONED")).toBe("pregame");
    expect(normalizeGamePhase("delayed")).toBe("pregame");
    expect(normalizeGamePhase("STATUS_DELAYED", { hasStarted: false })).toBe("pregame");
    expect(normalizeGamePhase("STATUS_DELAYED", { hasStarted: true })).toBe("live");
    expect(normalizeGamePhase("suspended")).toBe("live");
    expect(normalizeGamePhase("STATUS_SUSPENDED", { hasStarted: true })).toBe("live");
    expect(normalizeGamePhase("STATUS_SUSPENDED", { hasStarted: false })).toBe("pregame");
    expect(normalizeGamePhase("STATUS_IN_PROGRESS")).toBe("live");
    expect(normalizeGamePhase("STATUS_HALFTIME")).toBe("live");
    expect(normalizeGamePhase("complete")).toBe("final");

    // Delayed mid-game (clock already into Q1) stays live and keeps the clock.
    expect(espnStatusToPhase({
      period: 1,
      clock: 600,
      type: { name: "STATUS_DELAYED", state: "in", description: "Delayed" },
    })).toBe("live");
    // Delayed before kickoff stays pregame.
    expect(espnStatusToPhase({
      period: 1,
      clock: 900,
      type: { name: "STATUS_DELAYED", state: "pre", description: "Delayed" },
    })).toBe("pregame");
    expect(espnStatusToPhase({
      period: 2,
      clock: 120,
      type: { name: "STATUS_SUSPENDED", state: "in", description: "Suspended" },
    })).toBe("live");
    expect(espnStatusToPhase({
      type: { name: "STATUS_POSTPONED", state: "pre", description: "Postponed" },
    })).toBe("pregame");
    expect(espnStatusToPhase({
      type: { name: "STATUS_CANCELED", state: "pre", description: "Canceled" },
    })).toBe("pregame");
    // Unrecognized in-progress name still falls back via ESPN state.
    expect(espnStatusToPhase({
      period: 3,
      clock: 400,
      type: { name: "STATUS_SOMETHING_NEW", state: "in", description: "In Progress" },
    })).toBe("live");
  });

  it("treats Sleeper Sus status as unavailable", () => {
    expect(isUnavailableStatus("Sus")).toBe(true);
    expect(isUnavailableStatus("sus")).toBe(true);
  });

  it("counts only actuals for Out/injured players in a live game and keeps Questionable projections", () => {
    expect(liveForecastPoints(player({
      playerId: "hurt",
      position: "RB",
      projection: 15,
      actual: 4.2,
      gamePhase: "live",
      gamePeriod: 2,
      gameClockSeconds: 300,
      injuryStatus: "Out",
    }), now)).toBe(4.2);
    expect(liveForecastPoints(player({
      playerId: "q",
      position: "WR",
      projection: 12,
      actual: null,
      gamePhase: "pregame",
      injuryStatus: "Questionable",
    }), now)).toBe(12);
  });

  it("uses time-only remaining for K and DST with no pace boost", () => {
    const elapsed = gameElapsedFraction(2, 0);
    expect(elapsed).toBe(0.5);
    const kickerRemaining = liveRemainingProjection({
      pregameProjection: 10,
      actual: 8,
      elapsedFraction: elapsed!,
      position: "K",
    });
    const dstRemaining = liveRemainingProjection({
      pregameProjection: 8,
      actual: 12,
      elapsedFraction: elapsed!,
      position: "DEF",
    });
    expect(kickerRemaining).toBeCloseTo(5, 5);
    expect(dstRemaining).toBeCloseTo(4, 5);
    expect(liveForecastPoints(player({
      playerId: "k",
      position: "K",
      projection: 10,
      actual: 8,
      gamePhase: "live",
      gamePeriod: 2,
      gameClockSeconds: 0,
    }), now)).toBeCloseTo(13, 4);
  });

  it("falls back to max(actual, projection) when the clock is missing", () => {
    expect(liveForecastPoints(player({
      playerId: "no-clock",
      position: "QB",
      projection: 18,
      actual: 5,
      gamePhase: "live",
      gamePeriod: null,
      gameClockSeconds: null,
    }), now)).toBe(18);
    expect(liveForecastPoints(player({
      playerId: "boom-no-clock",
      position: "QB",
      projection: 18,
      actual: 22,
      gamePhase: "live",
    }), now)).toBe(22);
  });

  it("treats overtime as fully elapsed so the forecast is the actual", () => {
    expect(gameElapsedFraction(5, 420)).toBe(1);
    expect(liveForecastPoints(player({
      playerId: "ot-qb",
      position: "QB",
      projection: 20,
      actual: 24.5,
      gamePhase: "live",
      gamePeriod: 5,
      gameClockSeconds: 420,
    }), now)).toBe(24.5);
  });

  it("handles halftime as half the game elapsed", () => {
    expect(gameElapsedFraction(2, 0)).toBe(0.5);
    expect(gameElapsedFraction(3, 900)).toBe(0.5);
  });
});
