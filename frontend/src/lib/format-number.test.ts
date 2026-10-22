import { describe, expect, it } from "vitest";
import { formatCompactCount, formatDecimal, formatPercent, formatPoints, formatWhole, formatWholePercent } from "./format-number";

describe("formatDecimal", () => {
  it("keeps the same rounded digits as toFixed and adds grouping", () => {
    expect(formatDecimal(12, 1, { locale: "en-US" })).toBe("12.0");
    expect(formatDecimal(9.25, 1, { locale: "en-US" })).toBe("9.3");
    expect(formatDecimal(1.005, 2, { locale: "en-US" })).toBe((1.005).toFixed(2));
    expect(formatDecimal(1234.5, 1, { locale: "en-US" })).toBe("1,234.5");
    expect(formatDecimal(-1234.5, 1, { locale: "en-US" })).toBe("-1,234.5");
    expect(formatDecimal(1000000.25, 1, { locale: "en-US" })).toBe("1,000,000.3");
  });

  it("uses the locale's separators without changing the decimal places", () => {
    expect(formatDecimal(1234.5, 1, { locale: "de-DE" })).toBe("1.234,5");
    expect(formatDecimal(-1234.56, 2, { locale: "de-DE" })).toBe("-1.234,56");
    expect(formatPercent(45.26, { locale: "de-DE" })).toBe("45,3%");
  });

  it("matches the existing plus and zero sign rules", () => {
    expect(formatDecimal(1.2, 1, { locale: "en-US", sign: "always" })).toBe("+1.2");
    expect(formatDecimal(0, 2, { locale: "en-US", sign: "always" })).toBe("+0.00");
    expect(formatDecimal(-2, 1, { locale: "en-US", sign: "always" })).toBe("-2.0");
    expect(formatDecimal(1.2, 1, { locale: "en-US", sign: "exceptZero" })).toBe("+1.2");
    expect(formatDecimal(0, 1, { locale: "en-US", sign: "exceptZero" })).toBe("0.0");
    expect(formatDecimal(-2.5, 1, { locale: "en-US", sign: "exceptZero" })).toBe("-2.5");
  });
});

describe("formatPoints", () => {
  it("shows an em dash for a missing score and exactly two decimals otherwise", () => {
    expect(formatPoints(null)).toBe("—");
    expect(formatPoints(12, { locale: "en-US" })).toBe("12.00");
    expect(formatPoints(9.25, { locale: "en-US" })).toBe("9.25");
    expect(formatPoints(8, { locale: "en-US" })).toBe("8.00");
    expect(formatPoints(104.567, { locale: "en-US" })).toBe("104.57");
    expect(formatPoints(12.3, { locale: "en-US" })).toBe("12.30");
  });

  it("supports signed display for deltas", () => {
    expect(formatPoints(1.2, { locale: "en-US", sign: "always" })).toBe("+1.20");
    expect(formatPoints(-2.5, { locale: "en-US", sign: "exceptZero" })).toBe("-2.50");
  });
});

describe("formatPercent", () => {
  it("always shows one decimal on a 0–100 value", () => {
    expect(formatPercent(45.26, { locale: "en-US" })).toBe("45.3%");
    expect(formatPercent(12, { locale: "en-US" })).toBe("12.0%");
    expect(formatPercent(42, { locale: "en-US" })).toBe("42.0%");
    expect(formatPercent(68, { locale: "en-US" })).toBe("68.0%");
    expect(formatPercent(34.54, { locale: "en-US" })).toBe("34.5%");
  });
});

describe("formatWhole", () => {
  it("rounds to a whole number with grouping and supports null", () => {
    expect(formatWhole(null)).toBe("—");
    expect(formatWhole(10391, { locale: "en-US" })).toBe("10,391");
    expect(formatWhole(10.4, { locale: "en-US" })).toBe("10");
    expect(formatWhole(10.6, { locale: "en-US" })).toBe("11");
    expect(formatWhole(0, { locale: "en-US" })).toBe("0");
  });

  it("supports signed display for value changes", () => {
    expect(formatWhole(250, { locale: "en-US", sign: "exceptZero" })).toBe("+250");
    expect(formatWhole(-1200, { locale: "en-US", sign: "exceptZero" })).toBe("-1,200");
    expect(formatWhole(0, { locale: "en-US", sign: "exceptZero" })).toBe("0");
  });
});

describe("formatWholePercent", () => {
  it("rounds a run/pass share to a whole number", () => {
    expect(formatWholePercent(42, { locale: "en-US" })).toBe("42%");
    expect(formatWholePercent(58.4, { locale: "en-US" })).toBe("58%");
    expect(`${formatWholePercent(42, { locale: "en-US" })} / ${formatWholePercent(58, { locale: "en-US" })}`).toBe("42% / 58%");
  });
});

describe("formatCompactCount", () => {
  it("compacts trending counts", () => {
    expect(formatCompactCount(950)).toBe("950");
    expect(formatCompactCount(234135)).toBe("234K");
    expect(formatCompactCount(1200000)).toBe("1.2M");
  });
});
