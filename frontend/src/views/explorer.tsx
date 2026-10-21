import { lazy, Suspense, useMemo, useRef, type ReactNode } from "react";
import type {
  Dashboard,
  League,
  MatchupSelection,
  PlayerLink,
} from "../dashboard-types";
import type { RankingHorizon, RankingPosition } from "../dashboard-url";

/** Modes that share the Players primary page (excludes draft — that is ?tab=draft). */
export type ExplorerMode = "rankings" | "waivers" | "comparison";

export function isExplorerMode(tab: string): tab is ExplorerMode {
  return (
    tab === "rankings"
    || tab === "waivers"
    || tab === "comparison"
  );
}

const LazyPlayerPool = lazy(() => import("./player-pool").then((module) => ({ default: module.PlayerPool })));
const LazyComparisonTool = lazy(() => import("../AnalyticsViews").then((module) => ({ default: module.ComparisonTool })));

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
  onOpenLeagueTeam,
  rankingPosition,
  rankingHorizon,
  rankingQuery,
  onRankingFiltersChange,
  onOpenPlayer,
  linkedPlayerId,
  onOpenLinkedPlayer,
  comparePlayerId,
}: {
  mode: ExplorerMode;
  dashboard: Dashboard;
  league: League;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
  onOpenLeagueTeam?: (rosterId: number) => void;
  rankingPosition: RankingPosition | null;
  rankingHorizon: RankingHorizon | null;
  rankingQuery: string | null;
  onRankingFiltersChange: (filters: {
    position: RankingPosition | null;
    horizon: RankingHorizon | null;
    query: string | null;
  }) => void;
  onOpenPlayer: (playerId: string) => void;
  /** Dashboard player to seed the first Comparison slot with (the `c1` URL parameter). */
  comparePlayerId?: string | null;
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
            onOpenLeagueTeam={onOpenLeagueTeam}
            rankingPosition={rankingPosition}
            rankingHorizon={rankingHorizon}
            rankingQuery={rankingQuery}
            onRankingFiltersChange={onRankingFiltersChange}
            linkedPlayerId={linkedPlayerId}
            onOpenLinkedPlayer={onOpenLinkedPlayer}
          />
        </Suspense>
      );
    case "comparison":
      return (
        <Suspense fallback={<ExplorerFallback label="Loading comparison…" />}>
          <SeededComparison
            dashboard={dashboard}
            league={league}
            comparePlayerId={comparePlayerId ?? null}
            onOpenPlayer={onOpenPlayer}
            onOpenMatchup={onOpenMatchup}
          />
        </Suspense>
      );
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

const COMPARISON_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/**
 * Comparison seeded from the URL. The tool applies a seed once per key, so the key
 * advances each time the requested player changes and a repeated link re-seeds.
 */
function SeededComparison({ dashboard, league, comparePlayerId, onOpenPlayer, onOpenMatchup }: {
  dashboard: Dashboard;
  league: League;
  comparePlayerId: string | null;
  onOpenPlayer: (playerId: string) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
}) {
  const seed = useRef<{ id: string | null; key: number }>({ id: null, key: 0 });
  if (seed.current.id !== comparePlayerId) seed.current = { id: comparePlayerId, key: seed.current.key + 1 };
  const initialPlayer = useMemo(() => {
    if (!comparePlayerId) return null;
    const row = dashboard.rankings.find((item) => item.playerId === comparePlayerId)
      ?? dashboard.seasonLongRankings.find((item) => item.playerId === comparePlayerId && item.formatKey === league.seasonLongFormat.key);
    const position = COMPARISON_POSITIONS.find((item) => item === row?.position);
    if (!row || !position) return null;
    return { playerId: row.playerId, name: row.name, team: row.team ?? "", position };
  }, [comparePlayerId, dashboard.rankings, dashboard.seasonLongRankings, league.seasonLongFormat.key]);
  return (
    <LazyComparisonTool
      dashboard={dashboard}
      league={league}
      initialPlayer={initialPlayer}
      initialKey={seed.current.key}
      onOpenPlayer={onOpenPlayer}
      onOpenMatchup={onOpenMatchup}
    />
  );
}
