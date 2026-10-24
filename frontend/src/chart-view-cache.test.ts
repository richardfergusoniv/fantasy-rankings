import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  applySavedChartViewMutation,
  optimisticRemoveSavedChartView,
  optimisticUpsertSavedChartView,
  rollbackSavedChartViewMutation,
  savedChartViewsQueryKey,
  settleSavedChartViewMutation,
} from "./chart-view-cache";
import type { ViewerIdentity } from "./viewer-scope";

const TEST_VIEWER: ViewerIdentity = { userId: "user-test", accountId: "sleeper-test" };
const SAVED_CHART_VIEWS_QUERY_KEY = savedChartViewsQueryKey(TEST_VIEWER);

type View = { id: string; dataset: string; name: string; position: string };

const existing: View = { id: "view-1", dataset: "advanced", name: "Receiving", position: "WR" };
const renamed: View = { id: "optimistic:advanced:Receiving", dataset: "advanced", name: "Receiving", position: "RB" };
const added: View = { id: "optimistic:advanced:Upside", dataset: "advanced", name: "Upside", position: "RB" };

function clientWith(views: View[]): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SAVED_CHART_VIEWS_QUERY_KEY, { views });
  return client;
}

describe("saved chart view optimistic cache", () => {
  it("replaces a view with the same dataset and name, and appends a new one", () => {
    expect(optimisticUpsertSavedChartView({ views: [existing] }, renamed).views).toEqual([renamed]);
    expect(optimisticUpsertSavedChartView({ views: [existing] }, added).views).toEqual([existing, added]);
    expect(optimisticRemoveSavedChartView({ views: [existing, added] }, existing.id).views).toEqual([added]);
  });

  it("rolls back a failed save to the previous list", () => {
    const client = clientWith([existing]);
    const previous = applySavedChartViewMutation<View>(client, SAVED_CHART_VIEWS_QUERY_KEY, (current) => optimisticUpsertSavedChartView(current, added));
    expect(client.getQueryData<{ views: View[] }>(SAVED_CHART_VIEWS_QUERY_KEY)?.views).toEqual([existing, added]);
    rollbackSavedChartViewMutation(client, SAVED_CHART_VIEWS_QUERY_KEY, previous);
    expect(client.getQueryData<{ views: View[] }>(SAVED_CHART_VIEWS_QUERY_KEY)?.views).toEqual([existing]);
  });

  it("rolls back a failed delete and restores a missing cache", () => {
    const client = clientWith([existing]);
    const previous = applySavedChartViewMutation<View>(client, SAVED_CHART_VIEWS_QUERY_KEY, (current) => optimisticRemoveSavedChartView(current, existing.id));
    expect(client.getQueryData<{ views: View[] }>(SAVED_CHART_VIEWS_QUERY_KEY)?.views).toEqual([]);
    rollbackSavedChartViewMutation(client, SAVED_CHART_VIEWS_QUERY_KEY, previous);
    expect(client.getQueryData<{ views: View[] }>(SAVED_CHART_VIEWS_QUERY_KEY)?.views).toEqual([existing]);

    const empty = new QueryClient();
    const missing = applySavedChartViewMutation<View>(empty, SAVED_CHART_VIEWS_QUERY_KEY, (current) => optimisticUpsertSavedChartView(current, added));
    expect(missing).toBeUndefined();
    rollbackSavedChartViewMutation(empty, SAVED_CHART_VIEWS_QUERY_KEY, missing);
    expect(empty.getQueryData(SAVED_CHART_VIEWS_QUERY_KEY)).toBeUndefined();
  });

  it("invalidates the same query key on settle", async () => {
    const client = clientWith([existing]);
    await settleSavedChartViewMutation(client, SAVED_CHART_VIEWS_QUERY_KEY);
    expect(client.getQueryState(SAVED_CHART_VIEWS_QUERY_KEY)?.isInvalidated).toBe(true);
  });
});
