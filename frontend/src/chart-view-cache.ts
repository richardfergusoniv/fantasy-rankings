import type { QueryClient } from "@tanstack/react-query";

export const SAVED_CHART_VIEWS_QUERY_KEY = ["saved-chart-views"] as const;

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
  recipe: (current: SavedChartViewList<T> | undefined) => SavedChartViewList<T>,
): SavedChartViewList<T> | undefined {
  const current = client.getQueryData<SavedChartViewList<T>>(SAVED_CHART_VIEWS_QUERY_KEY);
  const previous = current ? { views: [...current.views] } : undefined;
  client.setQueryData(SAVED_CHART_VIEWS_QUERY_KEY, recipe(previous));
  return previous;
}

export function rollbackSavedChartViewMutation<T>(
  client: QueryClient,
  previous: SavedChartViewList<T> | undefined,
): void {
  if (previous === undefined) {
    client.removeQueries({ queryKey: SAVED_CHART_VIEWS_QUERY_KEY });
    return;
  }
  client.setQueryData(SAVED_CHART_VIEWS_QUERY_KEY, previous);
}

export function settleSavedChartViewMutation(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: SAVED_CHART_VIEWS_QUERY_KEY });
}
