import { describe, expect, it } from "vitest";
import {
  activeBenchIds,
  displayedMatchupPoints,
  lineupCountingPoints,
  mapSubmittedStarters,
  optimizeLineup,
  optimizeTradeRoster,
  powerRankingPoints,
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
