import { describe, expect, it } from "vitest";
import { advantageRows, advantageScale, biggestGaps, formatGap } from "./matchup-advantage";

const side = (name: string, points: number | null) => ({ name, points });

describe("advantageRows", () => {
  it("subtracts theirs from yours per slot, to one decimal", () => {
    const rows = advantageRows([
      { slot: "QB", mine: side("Kyler Murray", 16.66), theirs: side("Joe Burrow", 21.54) },
      { slot: "WR", mine: side("CeeDee Lamb", 18.59), theirs: side("Omar Cooper Jr.", 8.36) },
    ]);
    expect(rows.map((row) => row.gap)).toEqual([-4.9, 10.2]);
  });

  it("treats an empty slot as zero but leaves a missing projection unknown", () => {
    const rows = advantageRows([
      { slot: "FLEX", mine: null, theirs: side("Blake Corum", 7.26) },
      { slot: "K", mine: side("Tyler Bass", null), theirs: side("Chase McLaughlin", 7.68) },
    ]);
    expect(rows.map((row) => row.gap)).toEqual([-7.3, null]);
  });
});

describe("advantageScale and biggestGaps", () => {
  const rows = advantageRows([
    { slot: "QB", mine: side("A", 16.66), theirs: side("B", 21.54) },
    { slot: "RB", mine: side("C", 9.09), theirs: side("D", 18.29) },
    { slot: "WR", mine: side("E", 18.59), theirs: side("F", 8.36) },
    { slot: "FLEX", mine: side("G", 7.3), theirs: side("H", 7.3) },
  ]);

  it("scales every bar to the widest gap", () => {
    expect(advantageScale(rows)).toBe(10.2);
    expect(advantageScale([])).toBe(1);
  });

  it("returns the widest gaps in either direction and skips ties", () => {
    expect(biggestGaps(rows, 2).map((row) => row.slot)).toEqual(["WR", "RB"]);
    expect(biggestGaps(rows, 9).map((row) => row.slot)).not.toContain("FLEX");
  });
});

describe("formatGap", () => {
  it("signs the number with a true minus", () => {
    expect(formatGap(5.3)).toBe("+5.3");
    expect(formatGap(-2.8)).toBe("−2.8");
    expect(formatGap(0)).toBe("0.0");
  });
});
