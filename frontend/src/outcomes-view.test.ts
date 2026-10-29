import { describe, expect, it } from "vitest";
import { axisMax, changeLabel, changeTone, outcomeMeasure, pctLabel, type OutcomeRow } from "./outcomes-view";

const row = (playoffPct: number, lastPct: number, previousPlayoffPct: number | null = null, previousLastPct: number | null = null): OutcomeRow => ({
  playoffPct, lastPct, previousPlayoffPct, previousLastPct,
});

describe("outcomes view helpers", () => {
  it("reads the right measure for each view", () => {
    const team = row(80, 2, 70, 5);
    expect(outcomeMeasure("playoffs").now(team)).toBe(80);
    expect(outcomeMeasure("playoffs").before(team)).toBe(70);
    expect(outcomeMeasure("last").now(team)).toBe(2);
    expect(outcomeMeasure("last").before(team)).toBe(5);
  });

  it("scales the axis: fixed for playoffs, zoomed for last place", () => {
    expect(axisMax("playoffs", [row(10, 5)])).toBe(100);
    expect(axisMax("last", [row(0, 47.9, null, 31.2)])).toBe(50);
    expect(axisMax("last", [row(0, 3, null, 8)])).toBe(10);
    expect(axisMax("last", [])).toBe(10);
  });

  it("colors by what is good for the manager", () => {
    expect(changeTone(11.1, true)).toBe("good");
    expect(changeTone(-3.2, true)).toBe("bad");
    expect(changeTone(-11.4, false)).toBe("good");
    expect(changeTone(16.7, false)).toBe("bad");
    expect(changeTone(0.02, true)).toBe("flat");
    expect(changeTone(null, true)).toBe("flat");
  });

  it("formats changes and small odds", () => {
    expect(changeLabel(11.14)).toBe("+11.1 pp");
    expect(changeLabel(-3.2)).toBe("−3.2 pp");
    expect(changeLabel(0)).toBe("0.0 pp");
    expect(changeLabel(null)).toBe("–");
    expect(pctLabel(0.34)).toBe("0.34%");
    expect(pctLabel(0)).toBe("0.0%");
    expect(pctLabel(90.84)).toBe("90.8%");
  });
});
