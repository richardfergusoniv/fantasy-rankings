import { lazy, Suspense } from "react";
import type { Dashboard, League } from "../dashboard-types";
import type { ChartDataset } from "../dashboard-url";
import { GameLinesPanel } from "./game-lines-panel";
import { TeamStatsPanel } from "./team-stats-panel";
import { ValueChartPanel } from "./value-chart-panel";

const LazyChartsTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ChartsTool })));

function ChartsFallback() {
  return (
    <article className="monitor-panel monitor-builder-chart-panel">
      <header className="monitor-panel-header">
        <h2>Analytics</h2>
      </header>
      <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading Analytics…">
        <span>Loading Analytics…</span>
      </section>
    </article>
  );
}

export function Monitor({
  league,
  dashboard,
  chartDataset,
  onChartDatasetChange,
}: {
  league: League;
  dashboard: Dashboard;
  chartDataset: ChartDataset;
  onChartDatasetChange: (dataset: ChartDataset) => void;
}) {
  return (
    <section className="monitor-view" aria-label="Monitor">
      <Suspense fallback={<ChartsFallback />}>
        <LazyChartsTool
          dashboard={dashboard}
          league={league}
          dataset={chartDataset}
          onDatasetChange={onChartDatasetChange}
          layout="monitor"
        />
      </Suspense>

      <ValueChartPanel league={league} dashboard={dashboard} />

      <TeamStatsPanel league={league} season={dashboard.season} week={dashboard.week} />

      <GameLinesPanel league={league} season={dashboard.season} week={dashboard.week} />
    </section>
  );
}
