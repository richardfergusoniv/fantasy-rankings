import { describe, expect, it } from "vitest";
import { parseDashboardSearch, type DashboardUrlState } from "./dashboard-url";
import { commitDashboardUrl } from "./use-dashboard-url";

/** A harness whose view transitions wait until flush(), like a real one a frame later. */
function harness(start: string) {
  const intended = { current: parseDashboardSearch(start) };
  const rendered: DashboardUrlState[] = [];
  const history: Array<{ mode: string; tab: string }> = [];
  const pending: Array<() => void> = [];
  const deps = {
    intended,
    render: (state: DashboardUrlState) => rendered.push(state),
    writeHistory: (next: DashboardUrlState, mode: "push" | "replace") => history.push({ mode, tab: next.tab }),
    animate: (update: () => void) => pending.push(update),
  };
  return {
    intended,
    rendered,
    history,
    commit: (patch: Partial<DashboardUrlState>) => commitDashboardUrl(patch, deps),
    flush: () => pending.splice(0).forEach((update) => update()),
  };
}

describe("commitDashboardUrl", () => {
  it("keeps the last of two quick tab switches", () => {
    const app = harness("?tab=team");
    app.commit({ tab: "rankings" });
    app.commit({ tab: "team" });
    app.flush();
    expect(app.history).toEqual([{ mode: "push", tab: "rankings" }, { mode: "push", tab: "team" }]);
    expect(app.rendered.at(-1)?.tab).toBe("team");
  });

  it("lets a Back pressed mid-transition win", () => {
    const app = harness("?tab=team");
    app.commit({ tab: "rankings" });
    // popstate lands before the transition callback runs.
    app.intended.current = parseDashboardSearch("?tab=team");
    app.flush();
    expect(app.history).toEqual([{ mode: "push", tab: "rankings" }]);
    expect(app.rendered.at(-1)?.tab).toBe("team");
  });

  it("renders a non-view change at once and skips a no-op", () => {
    const app = harness("?tab=rankings");
    app.commit({ tab: "rankings" });
    expect(app.history).toEqual([]);
    app.commit({ playerId: "4046" });
    expect(app.rendered.at(-1)?.playerId).toBe("4046");
  });
});
