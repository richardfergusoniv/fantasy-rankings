import { describe, expect, it } from "vitest";
import { scatterAxisDomain } from "./scatter-zoom";

describe("scatterAxisDomain", () => {
  it("stays auto when not zoomed", () => {
    expect(scatterAxisDomain([1, 2, 3], false)).toEqual(["auto", "auto"]);
  });

  it("zooms into the central 70% of values", () => {
    const values = Array.from({ length: 11 }, (_, index) => index);
    const [lo, hi] = scatterAxisDomain(values, true);
    expect(typeof lo).toBe("number");
    expect(typeof hi).toBe("number");
    expect(lo as number).toBeGreaterThan(values[0]! - 1);
    expect(hi as number).toBeLessThan(values[10]! + 1);
    expect(lo as number).toBeLessThan(hi as number);
  });

  it("pads a single finite value", () => {
    expect(scatterAxisDomain([10], true)).toEqual([9, 11]);
  });
});
