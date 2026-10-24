import type { QueryClient } from "@tanstack/react-query";
import { personalQueryKey, type ViewerIdentity } from "./viewer-scope";

/** Shared prefix so cancel/invalidate fan out across every viewer's key. */
export const SAVED_CHART_VIEWS_QUERY_PREFIX = "saved-chart-views";

/** Saved views are per-viewer data: the key carries the verified identity. */
export function savedChartViewsQueryKey(viewer: ViewerIdentity): readonly unknown[] {
  return personalQueryKey(viewer, SAVED_CHART_VIEWS_QUERY_PREFIX);
}

export type SavedChartViewList<T> = { views: T[] };

type NamedChartView = { id: string; dataset: string; name: string };

export function optimisticUpsertSavedChartView<T extends NamedChartView>(
  current: SavedChartViewList<T> | undefined,
  view: T,
): SavedChartViewList<T> {
  const views = [...(current?.views ?? [])];
  const index = views.findIndex((item) => item.id === view.id || (item.dataset === view.dataset && item.name === view.name));
  if (index >= 0) {
    views[index] = view;
    return { views };
  }
  return { views: [...views, view] };
}

export function optimisticRemoveSavedChartView<T extends { id: string }>(
  current: SavedChartViewList<T> | undefined,
  id: string,
): SavedChartViewList<T> {
  return { views: (current?.views ?? []).filter((item) => item.id !== id) };
}

export function applySavedChartViewMutation<T>(
  client: QueryClient,
  queryKey: readonly unknown[],
  recipe: (current: SavedChartViewList<T> | undefined) => SavedChartViewList<T>,
): SavedChartViewList<T> | undefined {
  const current = client.getQueryData<SavedChartViewList<T>>(queryKey);
  const previous = current ? { views: [...current.views] } : undefined;
  client.setQueryData(queryKey, recipe(previous));
  return previous;
}

export function rollbackSavedChartViewMutation<T>(
  client: QueryClient,
  queryKey: readonly unknown[],
  previous: SavedChartViewList<T> | undefined,
): void {
  if (previous === undefined) {
    client.removeQueries({ queryKey });
    return;
  }
  client.setQueryData(queryKey, previous);
}

export function settleSavedChartViewMutation(client: QueryClient, queryKey: readonly unknown[]): Promise<void> {
  return client.invalidateQueries({ queryKey });
}
