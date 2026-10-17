import { lazy, Suspense, useState } from "react";
import type { Dashboard, League } from "../dashboard-types";
import type { ChartDataset } from "../dashboard-url";
import { SegmentedControl } from "../shared";
import { GameLinesPanel } from "./game-lines-panel";
import { TeamStatsPanel } from "./team-stats-panel";
import { ValueChartPanel } from "./value-chart-panel";

const LazyChartsTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ChartsTool })));

type MonitorTab = "lines" | "team" | "pricing" | "analytics";

function ChartsFallback() {
  return (
    <section className="monitor-section">
      <header className="section-heading">
        <h2>Analytics</h2>
      </header>
      <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading Analytics…">
        <span>Loading Analytics…</span>
      </section>
    </section>
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
  // One tool at a time behind the page-tab control, like the other
  // pages' subviews. Tabs are ordered week-first (lines, then usage,
  // then research). A tool mounts on first visit and then stays
  // mounted (hidden), so switching tabs never resets its selections.
  const [tab, setTab] = useState<MonitorTab>("lines");
  const [visited, setVisited] = useState<ReadonlySet<MonitorTab>>(() => new Set(["lines"]));
  const chooseTab = (next: MonitorTab) => {
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
    setTab(next);
  };

  return (
    <section className="monitor-view" aria-label="Monitor">
      <SegmentedControl
        className="lineup-mode-toggle page-tab-control"
        value={tab}
        onChange={chooseTab}
        label="Monitor tool"
        options={[
          { value: "lines", label: "Game lines" },
          { value: "team", label: "Team stats" },
          { value: "pricing", label: "Pricing" },
          { value: "analytics", label: "Analytics" },
        ]}
      />

      <div hidden={tab !== "lines"}>
        <GameLinesPanel league={league} season={dashboard.season} week={dashboard.week} />
      </div>

      {visited.has("team") ? (
        <div hidden={tab !== "team"}>
          <TeamStatsPanel league={league} season={dashboard.season} week={dashboard.week} />
        </div>
      ) : null}

      {visited.has("pricing") ? (
        <div hidden={tab !== "pricing"}>
          <ValueChartPanel league={league} dashboard={dashboard} />
        </div>
      ) : null}

      {visited.has("analytics") ? (
        <div hidden={tab !== "analytics"}>
          <Suspense fallback={<ChartsFallback />}>
            <LazyChartsTool
              dashboard={dashboard}
              league={league}
              dataset={chartDataset}
              onDatasetChange={onChartDatasetChange}
              layout="monitor"
            />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
