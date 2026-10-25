import { describe, expect, it } from "vitest";
import { buildPropHistory } from "../../../api/_lib/prop-line-reads";
import { missingPropWeekLabel, propHistoryDirection, propHistoryRefreshOptions } from "./prop-history-state";

const played = new Set([6]);
const covered = new Set([6]);
const lines = new Map([[6, 0.5]]);

describe("prop history availability", () => {
  it("does not turn a failed history load into an over selection", () => {
    const unavailable = buildPropHistory("receptions", new Map(), [], played, covered);
    expect(propHistoryDirection(unavailable, true)).toBeNull();
    // A successful response without any stored lines retains the ordinary fallback.
    expect(propHistoryDirection(unavailable, false)).toBe("over");
  });

  it("recovers the historical side when lines become available", () => {
    const history = buildPropHistory("receptions", lines, [], played, covered);
    expect(history.cells[0]).toMatchObject({ actual: 0, result: "under" });
    expect(propHistoryDirection(history, false)).toBe("under");
    expect(propHistoryDirection(history, true)).toBeNull();
  });

  it("distinguishes unpublished stats, missing lines, and games not played", () => {
    expect(buildPropHistory("receptions", lines, [], played, new Set()).cells).toEqual([]);
    expect(missingPropWeekLabel(6, lines, played, new Set())).toBe("stats unavailable");
    expect(missingPropWeekLabel(6, lines, new Set(), new Set())).toBe("stats unavailable");
    expect(missingPropWeekLabel(6, new Map(), played, covered)).toBe("no line");
    expect(missingPropWeekLabel(6, lines, new Set(), covered)).toBe("no game");
  });

  it("does not call an unsupported market a missing line", () => {
    expect(buildPropHistory("longest_reception", lines, [], played, covered).cells).toEqual([]);
    expect(missingPropWeekLabel(6, lines, played, covered)).toBe("stats unavailable");
  });

  it("retries degraded history promptly and stops polling after recovery", () => {
    const options = propHistoryRefreshOptions(6 * 60 * 60 * 1000);
    const query = { state: { data: { propLines: { weeklyLinesDegraded: true } } } };
    expect(options.staleTime(query)).toBe(0);
    expect(options.refetchInterval(query)).toBe(30_000);
    query.state.data.propLines.weeklyLinesDegraded = false;
    expect(options.staleTime(query)).toBe(6 * 60 * 60 * 1000);
    expect(options.refetchInterval(query)).toBe(false);
    expect(options.refetchInterval({ state: {} })).toBe(false);
  });
});
