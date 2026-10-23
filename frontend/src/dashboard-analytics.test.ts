import { describe, expect, it } from "vitest";
import { withStreamedAnalytics } from "./dashboard-analytics";
import type { Dashboard } from "./dashboard-types";

const emptyAnalytics: Dashboard["analytics"] = { asOf: null, throughWeek: null, sourceUrl: "", entities: [], teamUsage: [], teamRecords: [] };
const populatedAnalytics: Dashboard["analytics"] = {
  asOf: "2026-10-23T00:00:00.000Z",
  throughWeek: 7,
  sourceUrl: "https://example.com",
  entities: [{ id: "p1" } as Dashboard["analytics"]["entities"][number]],
  teamUsage: [],
  teamRecords: [],
};

function dashboardWith(analytics: Dashboard["analytics"], marker: string): Dashboard {
  return { asOf: "2026-10-23T00:00:00.000Z", analytics, marker } as unknown as Dashboard;
}

describe("withStreamedAnalytics", () => {
  it("fills an empty analytics section from the streamed dashboard for the same snapshot", () => {
    const winner = dashboardWith(emptyAnalytics, "winner");
    const streamed = dashboardWith(populatedAnalytics, "streamed");
    const merged = withStreamedAnalytics(winner, streamed);
    expect(merged?.analytics).toBe(populatedAnalytics);
    expect((merged as unknown as { marker: string }).marker).toBe("winner");
  });

  it("keeps the winner's analytics when it is already populated", () => {
    const winner = dashboardWith(populatedAnalytics, "winner");
    const streamed = dashboardWith(populatedAnalytics, "streamed");
    expect(withStreamedAnalytics(winner, streamed)).toBe(winner);
  });

  it("keeps the winner when the streamed analytics is also empty", () => {
    const winner = dashboardWith(emptyAnalytics, "winner");
    const streamed = dashboardWith(emptyAnalytics, "streamed");
    expect(withStreamedAnalytics(winner, streamed)).toBe(winner);
  });

  it("passes through missing candidates", () => {
    const streamed = dashboardWith(populatedAnalytics, "streamed");
    expect(withStreamedAnalytics(undefined, streamed)).toBeUndefined();
    const winner = dashboardWith(emptyAnalytics, "winner");
    expect(withStreamedAnalytics(winner, undefined)).toBe(winner);
  });
});
