import { describe, expect, it } from "vitest";
import {
  activeBenchIds,
  displayedMatchupPoints,
  gameElapsedFraction,
  isLineupLocked,
  LIVE_PACE_BLEND_END,
  LIVE_PACE_BLEND_START,
  LIVE_PACE_REMAINING_CAP,
  liveForecastPoints,
  livePaceBlendWeight,
  liveRemainingProjection,
  lineupCountingPoints,
  mapSubmittedStarters,
  normalizeGamePhase,
  optimizeLineup,
  optimizeTradeRoster,
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

  it("blends pace with a named cap so an early TD does not over-project", () => {
    expect(LIVE_PACE_BLEND_START).toBeLessThan(LIVE_PACE_BLEND_END);
    expect(LIVE_PACE_REMAINING_CAP).toBeGreaterThan(1);
    expect(livePaceBlendWeight(0)).toBe(LIVE_PACE_BLEND_START);
    expect(livePaceBlendWeight(1)).toBe(LIVE_PACE_BLEND_END);

    // ~5 minutes into Q1 after a TD (~6 pts on a 20-pt projection).
    const elapsed = gameElapsedFraction(1, 600);
    expect(elapsed).toBeCloseTo(300 / 3600, 5);
    const remaining = liveRemainingProjection({
      pregameProjection: 20,
      actual: 6,
      elapsedFraction: elapsed!,
      position: "QB",
    });
    const timeBased = 20 * (1 - elapsed!);
    const purePaceRemaining = timeBased * (6 / (20 * elapsed!));
    expect(remaining).toBeLessThanOrEqual(timeBased * LIVE_PACE_REMAINING_CAP + 1e-9);
    expect(remaining).toBeLessThan(purePaceRemaining);
    const forecast = liveForecastPoints(player({
      playerId: "early-td-qb",
      position: "QB",
      projection: 20,
      actual: 6,
      gamePhase: "live",
      gamePeriod: 1,
      gameClockSeconds: 600,
    }), now);
    // Pure pace would imply ~72; blend+cap keeps the total near the mid-20s.
    expect(forecast).toBeGreaterThan(6);
    expect(forecast).toBeLessThan(32);
    expect(forecast).toBeCloseTo(6 + remaining!, 4);
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

  it("maps canceled and postponed statuses to pregame, not live", () => {
    expect(normalizeGamePhase("canceled")).toBe("pregame");
    expect(normalizeGamePhase("cancelled")).toBe("pregame");
    expect(normalizeGamePhase("postponed")).toBe("pregame");
    expect(normalizeGamePhase("STATUS_POSTPONED")).toBe("pregame");
    expect(normalizeGamePhase("STATUS_IN_PROGRESS")).toBe("live");
    expect(normalizeGamePhase("STATUS_HALFTIME")).toBe("live");
    expect(normalizeGamePhase("complete")).toBe("final");
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
