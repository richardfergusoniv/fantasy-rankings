import type { Dashboard } from "./dashboard-types";

// The full dashboard (browser cache or a manual refresh) can carry an
// empty analytics section for the same snapshot the streamed sections
// project from, and it wins the freshness tie in App's candidate pick.
// When the winner's analytics is empty and the streamed section has
// entities, take the streamed analytics; every other section stays
// with the winner.
export function withStreamedAnalytics(dashboard: Dashboard | undefined, streamed: Dashboard | undefined): Dashboard | undefined {
  if (!dashboard || !streamed) return dashboard;
  if (dashboard.analytics.entities.length > 0 || streamed.analytics.entities.length === 0) return dashboard;
  return { ...dashboard, analytics: streamed.analytics };
}
