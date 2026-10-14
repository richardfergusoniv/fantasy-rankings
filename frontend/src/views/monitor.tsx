import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  GAME_LINES_STALE_MS,
  NFLVERSE_GAMES_CSV_URL,
  defaultGameLineCardId,
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

  const rosterPlayers = useMemo(
    () => [...league.starters, ...league.bench],
    [league.bench, league.starters],
  );
  const rosterTeams = useMemo(
    () => rosterPlayers.map((player) => player.team).filter((team): team is string => Boolean(team)),
    [rosterPlayers],
  );
  const liveTeams = useMemo(
    () => rosterPlayers
      .filter((player) => player.gamePhase === "live" && player.team)
      .map((player) => player.team)
      .filter((team): team is string => Boolean(team)),
    [rosterPlayers],
  );
  const defaultGameId = useMemo(
    () => defaultGameLineCardId(gameLineCards, rosterTeams, liveTeams, Date.now()),
    [gameLineCards, liveTeams, rosterTeams],
  );
  const [selectedGameId, setSelectedGameId] = useState("");
  useEffect(() => {
    setSelectedGameId((current) => {
      if (current && gameLineCards.some((card) => card.gameId === current)) return current;
      return defaultGameId ?? "";
    });
  }, [defaultGameId, gameLineCards]);
  const selectedGame = gameLineCards.find((card) => card.gameId === selectedGameId)
    ?? gameLineCards[0]
    ?? null;

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
        ) : selectedGame ? (
          <>
            <div className="monitor-value-chart-controls monitor-game-lines-controls">
              <label className="monitor-value-chart-field">
                <span className="sr-only">Game lines</span>
                <select
                  aria-label="Game lines"
                  value={selectedGame.gameId}
                  onChange={(event) => setSelectedGameId(event.target.value)}
                >
                  {gameLineCards.map((game) => (
                    <option key={game.gameId} value={game.gameId}>
                      {game.matchup}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="monitor-game-line-card">
              <strong className="monitor-game-line-matchup">{selectedGame.matchup}</strong>
              <span className="monitor-game-line-kickoff">{selectedGame.kickoffPt}</span>
              <span className="monitor-game-line-spread">{selectedGame.spread}</span>
              <span className="monitor-game-line-total">{selectedGame.total}</span>
              <span className="monitor-game-line-ml">{selectedGame.moneylines}</span>
              <span className="monitor-game-line-implied">{selectedGame.totalsOrScore}</span>
            </div>
          </>
        ) : null}
      </article>
    </section>
  );
}
