import { lazy, Suspense, useCallback, useMemo, useRef, type ReactNode } from "react";
import type {
  Dashboard,
  League,
  MatchupSelection,
  PlayerLink,
} from "../dashboard-types";
import { comparisonSeed } from "../lib/comparison-seed";
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
const LazyComparisonTool = lazy(() => import("./comparison").then((module) => ({ default: module.ComparisonTool })));

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
  compareSecondPlayerId,
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
  /** Second Comparison slot (the `c2` URL parameter). */
  compareSecondPlayerId?: string | null;
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
            compareSecondPlayerId={compareSecondPlayerId ?? null}
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

/**
 * Comparison seeded from the URL. The tool applies a seed once per key, so the key
 * advances each time the requested player changes and a repeated link re-seeds.
 */
function SeededComparison({ dashboard, league, comparePlayerId, compareSecondPlayerId, onOpenPlayer, onOpenMatchup }: {
  dashboard: Dashboard;
  league: League;
  comparePlayerId: string | null;
  compareSecondPlayerId: string | null;
  onOpenPlayer: (playerId: string) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
}) {
  const seedId = `${comparePlayerId ?? ""}|${compareSecondPlayerId ?? ""}`;
  const seed = useRef<{ id: string | null; key: number }>({ id: null, key: 0 });
  if (seed.current.id !== seedId) seed.current = { id: seedId, key: seed.current.key + 1 };
  const selection = useCallback(
    (playerId: string | null) => comparisonSeed(dashboard, league.seasonLongFormat.key, playerId),
    [dashboard, league.seasonLongFormat.key],
  );
  const initialPlayer = useMemo(() => selection(comparePlayerId), [comparePlayerId, selection]);
  const initialSecondPlayer = useMemo(() => selection(compareSecondPlayerId), [compareSecondPlayerId, selection]);
  return (
    <LazyComparisonTool
      dashboard={dashboard}
      league={league}
      initialPlayer={initialPlayer}
      initialSecondPlayer={initialSecondPlayer}
      initialKey={seed.current.key}
      onOpenPlayer={onOpenPlayer}
      onOpenMatchup={onOpenMatchup}
    />
  );
}
