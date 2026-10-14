import { describe, expect, it } from "vitest";
import {
  addUtcDateKey,
  dampenedDriftFactor,
  dampenedTrendCone,
  dailyChangeStdDev,
  linearSlope,
  movingAverage,
  TREND_CONE_PHI,
  TREND_CONE_Z,
} from "./value-chart-math.js";

describe("movingAverage", () => {
  it("returns null until a full window is available", () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("computes a 7-day trailing average", () => {
    const values = [10, 12, 14, 16, 18, 20, 22, 24];
    const ma7 = movingAverage(values, 7);
    expect(ma7[6]).toBeCloseTo((10 + 12 + 14 + 16 + 18 + 20 + 22) / 7);
    expect(ma7[7]).toBeCloseTo((12 + 14 + 16 + 18 + 20 + 22 + 24) / 7);
  });

  it("propagates gaps as null for that index", () => {
    expect(movingAverage([1, null, 3], 2)).toEqual([null, null, null]);
  });

  it("rejects a non-positive window", () => {
    expect(() => movingAverage([1, 2], 0)).toThrow(/positive integer/);
  });
});

describe("linearSlope", () => {
  it("returns 0 for a constant series", () => {
    expect(linearSlope([5, 5, 5, 5])).toBe(0);
  });

  it("recovers a unit slope", () => {
    expect(linearSlope([0, 1, 2, 3, 4])).toBeCloseTo(1);
  });

  it("returns 0 when fewer than two points", () => {
    expect(linearSlope([])).toBe(0);
    expect(linearSlope([10])).toBe(0);
  });
});

describe("dailyChangeStdDev", () => {
  it("is 0 for constant daily values", () => {
    expect(dailyChangeStdDev([10, 10, 10, 10])).toBe(0);
  });

  it("matches the sample stdev of daily changes", () => {
    // changes: +2, +2, +2 → sample stdev 0
    expect(dailyChangeStdDev([1, 3, 5, 7])).toBe(0);
    // changes: 1, 3, 5 → mean 3, sample variance ((4+0+4)/2)=4, stdev 2
    expect(dailyChangeStdDev([0, 1, 4, 9])).toBeCloseTo(2);
  });
});

describe("dampenedDriftFactor", () => {
  it("sums the geometric series φ + φ² + … + φʰ", () => {
    const phi = 0.9;
    expect(dampenedDriftFactor(phi, 1)).toBeCloseTo(phi);
    expect(dampenedDriftFactor(phi, 2)).toBeCloseTo(phi + phi ** 2);
    expect(dampenedDriftFactor(phi, 3)).toBeCloseTo(phi + phi ** 2 + phi ** 3);
    expect(dampenedDriftFactor(phi, 30)).toBeCloseTo(
      (phi * (1 - phi ** 30)) / (1 - phi),
    );
  });

  it("equals horizon when phi is 1", () => {
    expect(dampenedDriftFactor(1, 10)).toBe(10);
  });
});

describe("dampenedTrendCone", () => {
  it("projects a dampened center from today's value and clamps at 0", () => {
    const points = Array.from({ length: 30 }, (_, index) => ({
      date: addUtcDateKey("2026-01-01", index),
      value: 100 + index, // slope ≈ 1
    }));
    const cone = dampenedTrendCone(points, {
      horizon: 5,
      phi: TREND_CONE_PHI,
      z: TREND_CONE_Z,
      lookback: 30,
    });
    expect(cone).toHaveLength(5);
    expect(cone[0]?.date).toBe("2026-01-31");
    const todayValue = 129;
    const expectedH1 = Math.max(0, todayValue + 1 * dampenedDriftFactor(TREND_CONE_PHI, 1));
    expect(cone[0]?.center).toBeCloseTo(expectedH1, 5);
    for (const point of cone) {
      expect(point.low).toBeGreaterThanOrEqual(0);
      expect(point.center).toBeGreaterThanOrEqual(0);
      expect(point.high).toBeGreaterThanOrEqual(point.low);
    }
  });

  it("widens the 80% band with √h and uses ±1.28σ", () => {
    // Alternating +10 / -10 changes → non-zero sigma, near-zero slope.
    const values = [100, 110, 100, 110, 100, 110, 100, 110, 100, 110];
    const points = values.map((value, index) => ({
      date: addUtcDateKey("2026-03-01", index),
      value,
    }));
    const sigma = dailyChangeStdDev(values);
    const cone = dampenedTrendCone(points, {
      horizon: 4,
      phi: 0.9,
      z: 1.28,
      lookback: 10,
    });
    const h = 4;
    const half = 1.28 * sigma * Math.sqrt(h);
    const last = cone[h - 1];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last.high - last.center).toBeCloseTo(half, 5);
    expect(last.center - last.low).toBeCloseTo(half, 5);
  });

  it("clamps a declining projection to zero", () => {
    const points = Array.from({ length: 30 }, (_, index) => ({
      date: addUtcDateKey("2026-01-01", index),
      value: 20 - index * 2,
    }));
    const cone = dampenedTrendCone(points, { horizon: 30, phi: 0.9, lookback: 30 });
    expect(cone.every((point) => point.low >= 0 && point.center >= 0 && point.high >= 0)).toBe(true);
    expect(cone[cone.length - 1]?.center).toBe(0);
  });

  it("returns an empty cone for empty input", () => {
    expect(dampenedTrendCone([])).toEqual([]);
  });
});
