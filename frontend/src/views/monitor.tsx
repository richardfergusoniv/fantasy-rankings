import { lazy, Suspense, useState } from "react";
import type { Dashboard, League } from "../dashboard-types";
import type { ChartDataset } from "../dashboard-url";
import { SegmentedControl } from "../shared";
import { GameLinesPanel } from "./game-lines-panel";
import { TeamStatsPanel } from "./team-stats-panel";
import { ValueChartPanel } from "./value-chart-panel";

const LazyChartsTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ChartsTool })));

type ResearchTool = "pricing" | "analytics";

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
  // The week comes first (lines, then usage); the two chart tools are
  // research — one visible at a time behind the page-tab control, the
  // same pattern Matchup uses for Current/Optimized.
  const [researchTool, setResearchTool] = useState<ResearchTool>("pricing");

  return (
    <section className="monitor-view" aria-label="Monitor">
      <GameLinesPanel league={league} season={dashboard.season} week={dashboard.week} />

      <TeamStatsPanel league={league} season={dashboard.season} week={dashboard.week} />

      <div className="monitor-research">
        <SegmentedControl
          className="lineup-mode-toggle page-tab-control"
          value={researchTool}
          onChange={setResearchTool}
          label="Research tool"
          options={[
            { value: "pricing", label: "Pricing" },
            { value: "analytics", label: "Analytics" },
          ]}
        />
        {researchTool === "pricing" ? (
          <ValueChartPanel league={league} dashboard={dashboard} />
        ) : (
          <Suspense fallback={<ChartsFallback />}>
            <LazyChartsTool
              dashboard={dashboard}
              league={league}
              dataset={chartDataset}
              onDatasetChange={onChartDatasetChange}
              layout="monitor"
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
