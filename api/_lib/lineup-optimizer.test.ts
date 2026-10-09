import { describe, expect, it } from "vitest";
import { lineupCountingPoints, optimizeLineup, type OptimizablePlayer } from "./lineup-optimizer.js";

const now = Date.parse("2026-10-11T18:00:00.000Z");

function player(overrides: Partial<OptimizablePlayer> & Pick<OptimizablePlayer, "playerId" | "position">): OptimizablePlayer {
  return {
    lineupSlot: null,
    isStarter: false,
    projection: null,
    actual: null,
    gamePhase: "pregame",
    gameTime: "2026-10-11T20:00:00.000Z",
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
});
