import { describe, expect, it } from "vitest";
import { dashboardUrlHistoryMode, emptyDashboardUrlState, type DashboardUrlState } from "./dashboard-url";
import { flagsForWrite, historyStateFor, NOT_PUSHED, opensByPush, readOpenedByPush, type OpenedByPush } from "./history-ownership";

const matchup = { team: "CAR", opponent: "TB", isAway: false, gamePhase: "final" } as const;

function state(patch: Partial<DashboardUrlState> = {}): DashboardUrlState {
  return { ...emptyDashboardUrlState(), ...patch };
}

describe("readOpenedByPush", () => {
  it("reads the flags and ignores anything malformed", () => {
    expect(readOpenedByPush({ openedByPush: { player: true, matchup: false } })).toEqual({ player: true, matchup: false });
    expect(readOpenedByPush({ openedByPush: { matchup: true } })).toEqual({ player: false, matchup: true });
    for (const junk of [null, undefined, {}, "x", 7, { openedByPush: null }, { openedByPush: { player: "yes" } }, { matchupOpenedByPush: true }]) {
      expect(readOpenedByPush(junk)).toEqual(NOT_PUSHED);
    }
  });
});

describe("opensByPush", () => {
  it("marks a pushed sheet or dialog, and nothing for a replace", () => {
    const base = state({ tab: "rankings" });
    expect(opensByPush("push", base, state({ tab: "rankings", playerId: "p1" }))).toEqual({ player: true, matchup: false });
    expect(opensByPush("push", base, state({ tab: "rankings", matchup }))).toEqual({ player: false, matchup: true });
    expect(opensByPush("replace", base, state({ tab: "rankings", playerId: "p1", matchup }))).toEqual(NOT_PUSHED);
  });

  it("counts a switch to another player as opening one, but not a tab change that merely keeps it", () => {
    expect(opensByPush("push", state({ playerId: "p1" }), state({ playerId: "p2" })).player).toBe(true);
    expect(opensByPush("push", state({ tab: "rankings", playerId: "p1" }), state({ tab: "waivers", playerId: "p1" })).player).toBe(false);
  });
});

describe("flagsForWrite", () => {
  const both: OpenedByPush = { player: true, matchup: true };

  it("lets a push carry only what it opens", () => {
    expect(flagsForWrite("push", both, state({ playerId: "p1", matchup }), { player: false, matchup: true })).toEqual({ player: false, matchup: true });
  });

  it("keeps the flags of overlays that stay open across an in-place edit, and drops closed ones", () => {
    expect(flagsForWrite("replace", both, state({ playerId: "p1", matchup }))).toEqual(both);
    expect(flagsForWrite("replace", both, state({ playerId: "p1" }))).toEqual({ player: true, matchup: false });
    expect(flagsForWrite("replace", both, state())).toEqual(NOT_PUSHED);
  });
});

describe("historyStateFor", () => {
  it("adds the flags only when one is set", () => {
    const next = state({ tab: "team" });
    expect(historyStateFor(next, NOT_PUSHED)).toBe(next);
    expect(historyStateFor(next, { player: false, matchup: true })).toMatchObject({ tab: "team", openedByPush: { matchup: true } });
  });
});

/** A browser history stack driven by the same functions the hook uses. */
function browser(initial: DashboardUrlState, initialHistoryState?: unknown) {
  const entries: { app: DashboardUrlState; hs: unknown }[] = [{ app: initial, hs: initialHistoryState ?? initial }];
  let index = 0;
  const here = () => entries[index]!;
  return {
    get index() { return index; },
    get app() { return here().app; },
    commit(patch: Partial<DashboardUrlState>) {
      const current = here().app;
      const next = { ...current, ...patch };
      const action = dashboardUrlHistoryMode(current, next);
      if (action === "none") return;
      const hs = historyStateFor(next, flagsForWrite(action, readOpenedByPush(here().hs), next, opensByPush(action, current, next)));
      if (action === "push") { entries.splice(index + 1); entries.push({ app: next, hs }); index += 1; }
      else entries[index] = { app: next, hs };
    },
    close(overlay: keyof OpenedByPush) {
      if (readOpenedByPush(here().hs)[overlay]) { index -= 1; return; }
      const clear = overlay === "player" ? { playerId: null } : { matchup: null };
      const next = { ...here().app, ...clear };
      entries[index] = { app: next, hs: historyStateFor(next, flagsForWrite("replace", readOpenedByPush(here().hs), next)) };
    },
    back() { index -= 1; },
  };
}

describe("closing overlays against a simulated history", () => {
  it("steps back when the dialog was opened by a tap, even after a tool trip and Back", () => {
    const b = browser(state({ tab: "team" }));
    b.commit({ matchup });
    const opened = b.index;
    b.commit({ tab: "monitor", matchup: null, gameLinesTeam: "CAR" });
    b.back();
    expect(b.app.matchup).toEqual(matchup);
    b.close("matchup");
    expect(b.index).toBe(opened - 1);
    expect(b.app.matchup).toBeNull();
  });

  it("clears a directly landed dialog link in place, even after a tool trip and Back", () => {
    const b = browser(state({ tab: "team", matchup }));
    const landed = b.index;
    b.commit({ tab: "monitor", matchup: null, gameLinesTeam: "CAR" });
    b.back();
    b.close("matchup");
    expect(b.index).toBe(landed);
    expect(b.app.matchup).toBeNull();
  });

  it("does the same for the player sheet", () => {
    const tapped = browser(state({ tab: "rankings" }));
    tapped.commit({ playerId: "p1" });
    const opened = tapped.index;
    tapped.commit({ tab: "team-stats", playerId: null, teamStatsTeam: "KC" });
    tapped.back();
    tapped.close("player");
    expect(tapped.index).toBe(opened - 1);

    const landed = browser(state({ tab: "rankings", playerId: "p1" }));
    landed.commit({ tab: "team-stats", playerId: null, teamStatsTeam: "KC" });
    landed.back();
    landed.close("player");
    expect(landed.index).toBe(0);
    expect(landed.app.playerId).toBeNull();
  });

  it("unwinds a dialog over a sheet one layer at a time", () => {
    const b = browser(state({ tab: "rankings" }));
    b.commit({ playerId: "p1" });
    b.commit({ matchup });
    b.commit({ tab: "monitor", playerId: null, matchup: null, gameLinesTeam: "CAR" });
    b.back();
    expect(b.app).toMatchObject({ playerId: "p1", matchup });
    b.close("matchup");
    expect(b.app).toMatchObject({ playerId: "p1", matchup: null });
    b.close("player");
    expect(b.app).toMatchObject({ playerId: null, matchup: null });
    expect(b.index).toBe(0);
  });

  it("keeps the dialog's flag when an in-place edit replaces its entry", () => {
    const b = browser(state({ tab: "team" }));
    b.commit({ matchup });
    b.commit({ matchup: { ...matchup, opponent: "GB" } });
    const opened = b.index;
    b.close("matchup");
    expect(b.index).toBe(opened - 1);
  });
});
