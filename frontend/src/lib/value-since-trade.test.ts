import { describe, expect, it } from "vitest";
import { valueSinceTrade } from "./value-since-trade";

const history = new Map([
  ["hampton", [{ date: "2026-09-28", value: 5000 }, { date: "2026-10-01", value: 5200 }, { date: "2026-10-15", value: 6100 }]],
  ["deebo", [{ date: "2026-09-30", value: 4800 }, { date: "2026-10-15", value: 4300 }]],
  ["late", [{ date: "2026-10-10", value: 900 }]],
]);

describe("valueSinceTrade", () => {
  it("sums each side's actual daily value from the trade date on", () => {
    const rows = valueSinceTrade(["hampton"], ["deebo"], history, "2026-10-01");
    expect(rows.map((row) => row.date)).toEqual(["2026-10-01", "2026-10-15"]);
    expect(rows[0]).toEqual({ date: "2026-10-01", a: 5200, b: 4800 });
    expect(rows[1]).toEqual({ date: "2026-10-15", a: 6100, b: 4300 });
  });

  it("carries a later-starting player's first value back to the trade date", () => {
    const rows = valueSinceTrade(["hampton", "late"], ["deebo"], history, "2026-10-01");
    expect(rows[0]!.a).toBe(5200 + 900);
  });

  it("is empty when nobody in the trade has stored history", () => {
    expect(valueSinceTrade(["x"], ["y"], history, "2026-10-01")).toEqual([]);
  });

  it("is empty when one whole side has no stored history", () => {
    expect(valueSinceTrade(["hampton"], ["y"], history, "2026-10-01")).toEqual([]);
  });
});
