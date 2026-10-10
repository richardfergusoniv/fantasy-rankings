import { describe, expect, it } from "vitest";
import { formatDecimal, formatPercent, formatPoints } from "./format-number";

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
  it("shows an em dash for a missing score and one decimal otherwise", () => {
    expect(formatPoints(null)).toBe("—");
    expect(formatPoints(12, 1, { locale: "en-US" })).toBe("12.0");
    expect(formatPoints(9.25, 1, { locale: "en-US" })).toBe("9.3");
  });
});

describe("formatPercent", () => {
  it("always shows one decimal on a 0–100 value", () => {
    expect(formatPercent(45.26, { locale: "en-US" })).toBe("45.3%");
    expect(formatPercent(12, { locale: "en-US" })).toBe("12.0%");
    expect(formatPercent(42, { locale: "en-US" })).toBe("42.0%");
    expect(formatPercent(68, { locale: "en-US" })).toBe("68.0%");
    expect(`${formatPercent(42, { locale: "en-US" })} / ${formatPercent(58, { locale: "en-US" })}`).toBe("42.0% / 58.0%");
  });
});
