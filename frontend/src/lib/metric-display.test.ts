import { describe, expect, it } from "vitest";
import { metricDisplay } from "./metric-display";

const metric = (key: string, unit?: string) => ({ key, label: key, short: key, unit });

describe("metricDisplay", () => {
  it("shows market value and yards as whole numbers", () => {
    expect(metricDisplay(2967, metric("fantasyCalcValue"))).toBe("2,967");
    expect(metricDisplay(2655, metric("fantasyCalcValue"))).toBe("2,655");
    expect(metricDisplay(294.58, metric("stat_pass_yd"))).toBe("295");
    expect(metricDisplay(24.27, metric("stat_rush_yd"))).toBe("24");
  });

  it("keeps two decimals for fractional metrics and whole ranks", () => {
    expect(metricDisplay(1.97, metric("stat_pass_td"))).toBe("1.97");
    expect(metricDisplay(0.55, metric("stat_int"))).toBe("0.55");
    expect(metricDisplay(6, metric("matchupPositionRank"))).toBe("6");
  });
});
