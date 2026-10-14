import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import {
  GAME_LINES_STALE_MS,
  NFLVERSE_GAMES_CSV_URL,
  gameLineCardsForWeek,
  parseGamesCsv,
} from "../../../api/_lib/nflverse-game-lines";
import type { Dashboard, League } from "../dashboard-types";
import type { ChartDataset } from "../dashboard-url";
import { ValueChartPanel } from "./value-chart-panel";

const LazyChartsTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ChartsTool })));

function ChartsFallback() {
  return (
    <article className="monitor-panel monitor-builder-chart-panel">
      <header className="monitor-panel-header">
        <h2>Charts</h2>
      </header>
      <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading charts…">
        <span>Loading charts…</span>
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
  const gameLinesQuery = useQuery({
    queryKey: ["nflverse-game-lines", dashboard.season, dashboard.week],
    queryFn: async () => {
      const response = await fetch(NFLVERSE_GAMES_CSV_URL);
      if (!response.ok) throw new Error(`game lines HTTP ${response.status}`);
      const csv = await response.text();
      // Zero parsed rows (empty body or bad headers) is a load failure, not an empty week.
      if (parseGamesCsv(csv).length === 0) {
        throw new Error("game lines parse failed");
      }
      return gameLineCardsForWeek(csv, dashboard.season, dashboard.week);
    },
    staleTime: GAME_LINES_STALE_MS,
    gcTime: GAME_LINES_STALE_MS * 2,
    retry: 1,
  });
  const gameLineCards = gameLinesQuery.data ?? [];
  const gameLinesUnavailable = gameLinesQuery.isError;

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

      <article className="monitor-panel">
        <header className="monitor-panel-header">
          <h2>Game lines</h2>
        </header>
        {gameLinesUnavailable ? (
          <p className="monitor-empty">Lines unavailable</p>
        ) : gameLineCards.length > 0 ? (
          <ul className="monitor-game-lines-grid">
            {gameLineCards.map((game) => (
              <li key={game.gameId} className="monitor-game-line-card">
                <strong className="monitor-game-line-matchup">{game.matchup}</strong>
                <span className="monitor-game-line-kickoff">{game.kickoffPt}</span>
                <span className="monitor-game-line-spread">{game.spread}</span>
                <span className="monitor-game-line-total">{game.total}</span>
                <span className="monitor-game-line-ml">{game.moneylines}</span>
                <span className="monitor-game-line-implied">{game.totalsOrScore}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </section>
  );
}
