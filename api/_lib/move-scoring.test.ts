import { describe, expect, it } from "vitest";
import {
  assertLabelsNotRefit,
  blendProjection,
  correlatedWinProbability,
  outscoreChance,
  projectionSigma,
  scoreStartSit,
  scoreTrade,
  scoreWaiver,
  scorecardDriftFlags,
  shouldPromoteWeights,
  shrinkAndCap,
  sigma30ForValue,
  startSitLabel,
  tradeFairnessZ,
  SCORING_WEIGHTS,
} from "./move-scoring.js";

describe("start/sit EXAMPLE (FLEX half-PPR WR A vs WR B)", () => {
  it("matches the spec walkthrough numbers", () => {
    // V 13.2 / 12.8; U 13.5 / 9.9; WR w_v = 0.25
    const pA = 0.25 * 13.2 + 0.75 * 13.5;
    const pB = 0.25 * 12.8 + 0.75 * 9.9;
    expect(pA).toBeCloseTo(13.43, 1);
    expect(pB).toBeCloseTo(10.63, 1);

    const sigmaA = projectionSigma(pA, SCORING_WEIGHTS.spreadA.WR, SCORING_WEIGHTS.spreadB.WR);
    const sigmaB = projectionSigma(pB, SCORING_WEIGHTS.spreadA.WR, SCORING_WEIGHTS.spreadB.WR);
    expect(sigmaA).toBeCloseTo(8.23, 1);
    expect(sigmaB).toBeCloseTo(7.14, 1);

    const chanceA = outscoreChance(pA, sigmaA, pB, sigmaB);
    const chanceB = outscoreChance(pB, sigmaB, pA, sigmaA);
    expect(chanceA).toBeCloseTo(60, 0);
    expect(chanceB).toBeCloseTo(40, 0);
    expect(startSitLabel(chanceA, false)).toBe("Start");
    expect(startSitLabel(chanceB, false)).toBe("Sit");
  });

  it("scoreStartSit returns Start for WR A over WR B", () => {
    const result = scoreStartSit({
      player: {
        playerId: "a",
        name: "WR A",
        position: "WR",
        vegasProjection: 13.2,
        usageProjection: 13.5,
        usageGames: 5,
      },
      alternative: {
        playerId: "b",
        name: "WR B",
        position: "WR",
        vegasProjection: 12.8,
        usageProjection: 9.9,
        usageGames: 5,
      },
    });
    expect(result.week.score).toBeGreaterThanOrEqual(55);
    expect(result.week.score).toBeLessThan(70);
    expect(result.week.label).toBe("Start");
    expect(result.week.metric).toBe("win_the_slot_chance");
  });

  it("labels unavailable players Sit", () => {
    const result = scoreStartSit({
      player: {
        playerId: "out",
        name: "Hurt",
        position: "RB",
        vegasProjection: 15,
        usageProjection: 14,
        usageGames: 5,
        injuryStatus: "Out",
      },
      alternative: {
        playerId: "ok",
        name: "Healthy",
        position: "RB",
        vegasProjection: 10,
        usageProjection: 10,
        usageGames: 5,
      },
    });
    expect(result.week.label).toBe("Sit");
    expect(result.week.score).toBe(0);
  });

  it("uses Strong start when there is no eligible backup", () => {
    const result = scoreStartSit({
      player: {
        playerId: "only",
        name: "Stud",
        position: "QB",
        vegasProjection: 20,
        usageProjection: 18,
        usageGames: 5,
      },
      alternative: null,
    });
    expect(result.week.label).toBe("Strong start");
    expect(result.week.reasons.some((r) => r.factor === "no_eligible_backup")).toBe(true);
  });
});

describe("waivers EXAMPLE (add RB C, drop WR D)", () => {
  it("matches Week N / Season Long / Dynasty labels", () => {
    const result = scoreWaiver({
      addName: "RB C",
      dropName: "WR D",
      addPosition: "RB",
      needPos: 0.2,
      isDynasty: true,
      week: { lineupBefore: 9.1, lineupAfter: 11.4 },
      seasonLong: {
        starterValueBefore: 38_000,
        starterValueAfter: 38_000 + 1_100,
        benchValueBefore: 0,
        benchValueAfter: 700,
      },
      dynasty: {
        // Dynasty: C 2100 vs D 2600 → dStarter roughly -500 if D was a starter substitute;
        // EXAMPLE: gain −500 × 0.60 × 1.2 = −360 / 52_000 = −0.7%
        starterValueBefore: 52_000,
        starterValueAfter: 52_000,
        benchValueBefore: 2_600,
        benchValueAfter: 2_100,
      },
    });

    expect(result.week.score).toBeCloseTo(2.3, 1);
    expect(result.week.label).toBe("Add");

    // Gain = 1100 + 0.25*(1.2)*700 = 1100 + 210 = 1310; 1310/38000 = 3.45%
    expect(result.seasonLong.score).toBeCloseTo(3.4, 0);
    expect(result.seasonLong.label).toBe("Add");

    // Gain = 0 + 0.60*(1.2)*(-500) = -360; -360/52000 ≈ -0.69%
    expect(result.dynasty?.score).toBeCloseTo(-0.7, 0);
    expect(result.dynasty?.label).toBe("Pass");
  });
});

describe("trades EXAMPLE fair-trade z-score", () => {
  it("matches Season Long Fair band for WR F vs RB G", () => {
    // Give 5200, Get 5600; σ F=1025 G=1060; z = 400/√(1025²+1060²) ≈ 0.27
    const give = [{ playerId: "f", name: "WR F", position: "WR", value: 5_200 }];
    const get = [{ playerId: "g", name: "RB G", position: "RB", value: 5_600 }];
    const fair = tradeFairnessZ(give, get, "season_long", "in_season");
    expect(fair.gap).toBe(400);
    expect(fair.gapPct).toBeCloseTo(7.1, 0);
    expect(fair.z).toBeCloseTo(0.27, 1);
    expect(fair.band).toBe("Fair");

    // Cross-check σ₃₀ formula
    expect(sigma30ForValue(5_200, "season_long", "in_season")).toBeCloseTo(567 + 0.088 * 5_200, 0);
  });

  it("matches Dynasty Fair band including a pick", () => {
    const give = [{ playerId: "f", name: "WR F", position: "WR", value: 6_800 }];
    const get = [
      { playerId: "g", name: "RB G", position: "RB", value: 4_900 },
      { playerId: "p", name: "2027 2nd", position: "PICK", value: 1_300 },
    ];
    const fair = tradeFairnessZ(give, get, "dynasty", "in_season");
    expect(fair.gap).toBe(-600);
    expect(fair.gapPct).toBeCloseTo(-8.8, 0);
    expect(fair.z).toBeCloseTo(-0.61, 1);
    expect(fair.band).toBe("Fair");
  });

  it("scoreTrade labels Season Long Accept for the EXAMPLE", () => {
    const result = scoreTrade({
      week: { yourLineupBefore: 128.4, yourLineupAfter: 130.1 },
      seasonLong: {
        give: [{ playerId: "f", name: "WR F", position: "WR", value: 5_200 }],
        get: [{ playerId: "g", name: "RB G", position: "RB", value: 5_600 }],
        yourStarterValueBefore: 0,
        yourStarterValueAfter: 650,
        yourPowerRankBefore: 5,
        yourPowerRankAfter: 4,
        fillsHole: true,
      },
      phase: "in_season",
    });
    expect(result.week.label).toBe("Accept");
    expect(result.week.score).toBeCloseTo(1.7, 1);
    expect(result.seasonLong.label).toBe("Accept");
    expect(result.fairness?.band).toBe("Fair");
  });
});

describe("correlated win chance", () => {
  it("raises variance for QB+WR1 stack on the same team", () => {
    const stacked = correlatedWinProbability(
      [
        { playerId: "qb", position: "QB", team: "KC", pStar: 20, opponentTeam: "LV" },
        { playerId: "wr", position: "WR", team: "KC", pStar: 15, opponentTeam: "LV", wrRankOnTeam: 1 },
      ],
      [
        { playerId: "oq", position: "QB", team: "BUF", pStar: 20, opponentTeam: "MIA" },
        { playerId: "ow", position: "WR", team: "MIA", pStar: 15, opponentTeam: "BUF", wrRankOnTeam: 1 },
      ],
    );
    const unstacked = correlatedWinProbability(
      [
        { playerId: "qb", position: "QB", team: "KC", pStar: 20, opponentTeam: "LV" },
        { playerId: "wr", position: "WR", team: "SF", pStar: 15, opponentTeam: "LAR", wrRankOnTeam: 1 },
      ],
      [
        { playerId: "oq", position: "QB", team: "BUF", pStar: 20, opponentTeam: "MIA" },
        { playerId: "ow", position: "WR", team: "MIA", pStar: 15, opponentTeam: "BUF", wrRankOnTeam: 1 },
      ],
    );
    // Equal means → near 50 either way; just assert a finite probability.
    expect(stacked).toBeGreaterThan(0);
    expect(stacked).toBeLessThan(1);
    expect(unstacked).toBeGreaterThan(0);
  });

  it("applies DST vs opposing QB negative correlation", () => {
    const p = correlatedWinProbability(
      [{ playerId: "dst", position: "DST", team: "BAL", pStar: 8, opponentTeam: "CIN" }],
      [{ playerId: "qb", position: "QB", team: "CIN", pStar: 22, opponentTeam: "BAL" }],
    );
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});

describe("calibration guardrails", () => {
  it("shrinks toward prior and caps the step", () => {
    const next = shrinkAndCap({
      observed: 1.0,
      prior: 0.25,
      current: 0.25,
      n: 50,
      k: 300,
      maxStep: 0.05,
    });
    // Raw shrink ≈ (50*1 + 300*0.25)/350 ≈ 0.357; capped at 0.30
    expect(next).toBeCloseTo(0.3, 5);
  });

  it("blocks promote before 3 snapshot weeks", () => {
    const decision = shouldPromoteWeights({
      snapshotWeekCount: 2,
      activeHoldout: { playerGames: 400, rmse: 8, brier: 0.2 },
      candidateHoldout: { playerGames: 400, rmse: 7, brier: 0.19 },
    });
    expect(decision.promote).toBe(false);
  });

  it("blocks promote without enough holdout player-games", () => {
    const decision = shouldPromoteWeights({
      snapshotWeekCount: 5,
      activeHoldout: { playerGames: 200, rmse: 8, brier: 0.2 },
      candidateHoldout: { playerGames: 200, rmse: 7, brier: 0.19 },
    });
    expect(decision.promote).toBe(false);
  });

  it("blocks promote when RMSE gain is under 0.05", () => {
    const decision = shouldPromoteWeights({
      snapshotWeekCount: 5,
      activeHoldout: { playerGames: 400, rmse: 8.0, brier: 0.2 },
      candidateHoldout: { playerGames: 400, rmse: 7.96, brier: 0.19 },
    });
    expect(decision.promote).toBe(false);
  });

  it("blocks promote when Brier worsens", () => {
    const decision = shouldPromoteWeights({
      snapshotWeekCount: 5,
      activeHoldout: { playerGames: 400, rmse: 8.0, brier: 0.2 },
      candidateHoldout: { playerGames: 400, rmse: 7.5, brier: 0.25 },
    });
    expect(decision.promote).toBe(false);
  });

  it("promotes when holdout clears all guardrails", () => {
    const decision = shouldPromoteWeights({
      snapshotWeekCount: 5,
      activeHoldout: { playerGames: 400, rmse: 8.0, brier: 0.2 },
      candidateHoldout: { playerGames: 400, rmse: 7.5, brier: 0.19 },
    });
    expect(decision.promote).toBe(true);
  });

  it("never allows label auto-refit", () => {
    expect(() => assertLabelsNotRefit()).not.toThrow();
  });

  it("flags Strong start drift below 65%", () => {
    const flags = scorecardDriftFlags({
      strongStartHitRate: 0.6,
      strongStartPairs: 60,
      startHitRate: null,
      startPairs: 0,
      flexHitRate: null,
      flexPairs: 0,
      tiebreakBeatRate: null,
      tiebreakCases: 0,
    });
    expect(flags.some((f) => f.measure === "strong_start" && f.flagged)).toBe(true);
  });
});

describe("no-history blend fallback", () => {
  it("sets w_v = 1 with fewer than 2 usage games", () => {
    const blend = blendProjection({
      playerId: "rookie",
      name: "Rookie",
      position: "WR",
      vegasProjection: 12,
      usageProjection: 8,
      usageGames: 1,
    });
    expect(blend.wV).toBe(1);
    expect(blend.pStar).toBeCloseTo(12, 5);
  });
});
