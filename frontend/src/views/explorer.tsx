import { lazy, Suspense, type ReactNode } from "react";
import type {
  Dashboard,
  League,
  MatchupSelection,
  PlayerLink,
} from "../dashboard-types";
import type { ChartDataset, RankingHorizon, RankingPosition } from "../dashboard-url";

/** Explorer modes that share the Explorer primary page (excludes draft — that is ?tab=draft). */
export type ExplorerMode = "rankings" | "waivers" | "charts" | "comparison" | "strengthOfSchedule";

export function isExplorerMode(tab: string): tab is ExplorerMode {
  return (
    tab === "rankings"
    || tab === "waivers"
    || tab === "charts"
    || tab === "comparison"
    || tab === "strengthOfSchedule"
  );
}

const LazyPlayerPool = lazy(() => import("./player-pool").then((module) => ({ default: module.PlayerPool })));
const LazyChartsTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ChartsTool })));
const LazyComparisonTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ComparisonTool })));
const LazyTablesTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.TablesTool })));

function ExplorerFallback({ label }: { label: string }) {
  return (
    <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span>{label}</span>
    </section>
  );
}

export function Explorer({
  mode,
  dashboard,
  league,
  onOpenMatchup,
  rankingPosition,
  rankingHorizon,
  rankingQuery,
  onRankingFiltersChange,
  chartDataset,
  onChartDatasetChange,
  onOpenPlayer,
  sosLoadFailed,
  onRetrySos,
  sosRetrying,
  linkedPlayerId,
  onOpenLinkedPlayer,
}: {
  mode: ExplorerMode;
  dashboard: Dashboard;
  league: League;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
  rankingPosition: RankingPosition | null;
  rankingHorizon: RankingHorizon | null;
  rankingQuery: string | null;
  onRankingFiltersChange: (filters: {
    position: RankingPosition | null;
    horizon: RankingHorizon | null;
    query: string | null;
  }) => void;
  chartDataset: ChartDataset;
  onChartDatasetChange: (dataset: ChartDataset) => void;
  onOpenPlayer: (playerId: string) => void;
  sosLoadFailed: boolean;
  onRetrySos: () => void;
  sosRetrying: boolean;
} & PlayerLink): ReactNode {
  switch (mode) {
    case "rankings":
    case "waivers":
      return (
        <Suspense fallback={<ExplorerFallback label="Loading players…" />}>
          <LazyPlayerPool
            dashboard={dashboard}
            league={league}
            availableOnly={mode === "waivers"}
            onOpenMatchup={onOpenMatchup}
            rankingPosition={rankingPosition}
            rankingHorizon={rankingHorizon}
            rankingQuery={rankingQuery}
            onRankingFiltersChange={onRankingFiltersChange}
            linkedPlayerId={linkedPlayerId}
            onOpenLinkedPlayer={onOpenLinkedPlayer}
          />
        </Suspense>
      );
    case "charts":
      return (
        <Suspense fallback={<ExplorerFallback label="Loading charts…" />}>
          <LazyChartsTool
            dashboard={dashboard}
            league={league}
            dataset={chartDataset}
            onDatasetChange={onChartDatasetChange}
            onOpenMatchup={onOpenMatchup}
          />
        </Suspense>
      );
    case "comparison":
      return (
        <Suspense fallback={<ExplorerFallback label="Loading comparison…" />}>
          <LazyComparisonTool
            dashboard={dashboard}
            league={league}
            initialPlayer={null}
            initialKey={0}
            onOpenPlayer={onOpenPlayer}
            onOpenMatchup={onOpenMatchup}
          />
        </Suspense>
      );
    case "strengthOfSchedule":
      return (
        <Suspense fallback={<ExplorerFallback label="Loading tables…" />}>
          <LazyTablesTool
            dashboard={dashboard}
            league={league}
            sosLoadFailed={sosLoadFailed}
            onRetrySos={onRetrySos}
            sosRetrying={sosRetrying}
          />
        </Suspense>
      );
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}
