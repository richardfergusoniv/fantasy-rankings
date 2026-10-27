import { describe, expect, it } from "vitest";
import { buildPropHistory } from "../../../api/_lib/prop-line-reads";
import { missingPropWeekLabel, propHistoryRefreshOptions } from "./prop-history-state";

const played = new Set([6]);
const covered = new Set([6]);

describe("prop history availability", () => {
  it("grades a played week with no stat row as a zero against this week's line", () => {
    const history = buildPropHistory("receptions", 0.5, [], played, covered);
    expect(history.cells[0]).toMatchObject({ week: 6, line: 0.5, actual: 0, result: "under" });
  });

  it("labels a played week with unusable stats, and a week he did not play", () => {
    expect(missingPropWeekLabel(6, played)).toBe("stats unavailable");
    expect(missingPropWeekLabel(6, new Set())).toBe("no game");
  });

  it("does not call an unsupported market a missing line", () => {
    expect(buildPropHistory("longest_reception", 12.5, [], played, covered).cells).toEqual([]);
    expect(missingPropWeekLabel(6, played)).toBe("stats unavailable");
  });

  it("keeps a stable staleTime and does not poll for unused weeklyLines degradation", () => {
    const options = propHistoryRefreshOptions(6 * 60 * 60 * 1000);
    expect(options.staleTime).toBe(6 * 60 * 60 * 1000);
    expect(options.refetchInterval).toBe(false);
  });
});
