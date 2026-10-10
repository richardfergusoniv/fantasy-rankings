import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "./api";
import type {
  AnalyticsEntity,
  BasePosition,
  BoomBustHistory,
  Dashboard,
  DetailMetric,
  MatchupSelection,
  PlayerDetailTab,
  PlayerNewsItem,
  PlayerSearchResult,
  PfnContextStat,
  PfnRow,
  PfnTable,
} from "./dashboard-types";
import {
  SectionError,
  canonicalNflTeam,
  defenseComponentLabels,
  formatProjectionPoints,
  isBoomBustPosition,
  movementLabel,
  newsTimeLabel,
  pfnDateLabel,
  pfnNumber,
  pfnRankForRow,
  projectionComponentsForPlayer,
} from "./dashboard-shared";
import { formatDecimal } from "./lib/format-number";
import { MatchupTag, ModalPortal, SegmentedControl, SosRankChip, setPlayerSheetDragLock, useDialogFocusTrap, type StrengthOfScheduleEntryLike } from "./shared";

const LazyPlayerValueTrend = lazy(() => import("./player-charts").then((module) => ({ default: module.PlayerValueTrend })));

export const detailAdvancedMetrics: Partial<Record<BasePosition, DetailMetric[]>> = {
  QB: [
    { key: "pass_attempts", label: "Pass attempts / game", digits: 1 },
    { key: "completion_pct", label: "Completion rate", unit: "%", digits: 1 },
    { key: "cpoe", label: "CPOE", unit: "%", digits: 1 },
    { key: "epa_per_play", label: "EPA / play", digits: 2 },
    { key: "carries", label: "Carries / game", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
  ],
  RB: [
    { key: "touches", label: "Touches / game", digits: 1 },
    { key: "target_share", label: "Target share", unit: "%", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
    { key: "scrimmage_yards", label: "Scrimmage yds / game", digits: 1 },
    { key: "yards_per_touch", label: "Yards / touch", digits: 2, derived: (values) => {
      const touches = values.touches;
      const yards = values.scrimmage_yards;
      return typeof touches === "number" && touches > 0 && typeof yards === "number" ? yards / touches : null;
    } },
    { key: "rushing_epa", label: "Rushing EPA / game", digits: 2 },
  ],
  WR: [
    { key: "targets", label: "Targets / game", digits: 1 },
    { key: "target_share", label: "Target share", unit: "%", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
    { key: "air_yards_share", label: "Air-yards share", unit: "%", digits: 1 },
    { key: "wopr", label: "WOPR", digits: 2 },
    { key: "yards_per_target", label: "Yards / target", digits: 2, derived: (values) => {
      const targets = values.targets;
      const yards = values.receiving_yards;
      return typeof targets === "number" && targets > 0 && typeof yards === "number" ? yards / targets : null;
    } },
  ],
  TE: [
    { key: "targets", label: "Targets / game", digits: 1 },
    { key: "target_share", label: "Target share", unit: "%", digits: 1 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 1 },
    { key: "air_yards_share", label: "Air-yards share", unit: "%", digits: 1 },
    { key: "wopr", label: "WOPR", digits: 2 },
    { key: "yards_per_target", label: "Yards / target", digits: 2, derived: (values) => {
      const targets = values.targets;
      const yards = values.receiving_yards;
      return typeof targets === "number" && targets > 0 && typeof yards === "number" ? yards / targets : null;
    } },
  ],
  K: [
    { key: "fg_attempts", label: "FG attempts / game", digits: 1 },
    { key: "fg_pct", label: "Field-goal rate", unit: "%", digits: 1 },
    { key: "fg_50_plus", label: "50+ FG / game", digits: 1 },
    { key: "pat_attempts", label: "PAT attempts / game", digits: 1 },
  ],
  DEF: [
    { key: "qb_hits", label: "QB hits / game", digits: 1 },
    { key: "sacks", label: "Sacks / game", digits: 1 },
    { key: "takeaways", label: "Takeaways / game", digits: 1 },
    { key: "tackles_for_loss", label: "TFL / game", digits: 1 },
  ],
};

export const gameLogStatLabels: Record<string, string> = {
  passCmp: "CMP", passAtt: "ATT", passYds: "PASS YDS", passTd: "PASS TD", interceptions: "INT",
  rushAtt: "CAR", rushYds: "RUSH YDS", rushTd: "RUSH TD", targets: "TGT", receptions: "REC",
  recYds: "REC YDS", recTd: "REC TD", fantasyPoints: "FPTS",
};


export function usePlayerCardHistory() {
  const [history, setHistory] = useState<{ entries: PlayerSearchResult[]; index: number }>({ entries: [], index: -1 });

  const open = useCallback((player: PlayerSearchResult) => {
    setHistory((current) => {
      const active = current.index >= 0 ? current.entries[current.index] : undefined;
      if (active?.playerId === player.playerId) return current;
      const entries = [...current.entries.slice(0, current.index + 1), player];
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const back = useCallback(() => {
    setHistory((current) => current.index > 0 ? { ...current, index: current.index - 1 } : current);
  }, []);

  const close = useCallback(() => {
    setHistory({ entries: [], index: -1 });
  }, []);

  const current = history.index >= 0 ? history.entries[history.index] ?? null : null;
  return {
    current,
    canGoBack: history.index > 0,
    isOpen: current !== null,
    open,
    back,
    close,
  };
}

export function PlayerTeamContext({ player }: { player: PlayerSearchResult }) {
  const query = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const tables = query.data?.tables;
  const team = canonicalNflTeam(player.team);
  const findRow = (table: PfnTable | null | undefined, code: string | null) => table?.rows.find((row) => canonicalNflTeam(row.team) === code);
  const offensiveLine = tables?.["offensive-line"] ?? null;
  const offense = tables?.offense ?? null;
  const defense = tables?.defense ?? null;
  const overall = tables?.["team-overall"] ?? null;
  const teamLine = findRow(offensiveLine, team);
  const teamOffense = findRow(offense, team);
  const teamDefense = findRow(defense, team);
  const teamOverall = findRow(overall, team);
  const stats: PfnContextStat[] = [];

  const addStat = (label: string, table: PfnTable | null, row: PfnRow | undefined, key: string, options?: { higherIsBetter?: boolean; suffix?: string; tableRank?: boolean }) => {
    const value = pfnNumber(row, key);
    if (value === null && !(options?.tableRank && row?.rank != null)) return;
    stats.push({
      label,
      value: value ?? row?.rank ?? 0,
      rank: options?.tableRank ? row?.rank ?? null : pfnRankForRow(table, row, key, options?.higherIsBetter ?? true),
      suffix: options?.suffix,
    });
  };

  // Preview: compact Team section with Off / Def / O-Line / Overall (Look D).
  addStat("Offense", offense, teamOffense, "grade", { tableRank: true });
  addStat("Defense", defense, teamDefense, "grade", { tableRank: true });
  addStat("O-Line", offensiveLine, teamLine, "grade", { tableRank: true });
  if (teamOverall) {
    stats.push({
      label: "Overall",
      value: pfnNumber(teamOverall, "grade") ?? teamOverall.rank,
      rank: teamOverall.rank,
      suffix: typeof teamOverall.record === "string" ? ` grade · ${teamOverall.record}` : " grade",
    });
  }

  const fetchedAt = offensiveLine?.fetched_at ?? offense?.fetched_at ?? defense?.fetched_at ?? overall?.fetched_at ?? null;
  return (
    <section className="player-team-context" aria-label={`${player.name} team grades`}>
      <div className="section-heading">
        <h3>Team</h3>
        <span>{fetchedAt ? `PFN · ${pfnDateLabel(fetchedAt)}` : "PFN"}</span>
      </div>
      {query.isPending ? (
        <div className="player-team-context-state" role="status">Loading team context…</div>
      ) : query.isError ? (
        <SectionError title="Team context didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} compact />
      ) : stats.length > 0 ? (
        <div className="player-team-context-grid">
          {stats.map((stat) => (
            <div key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.rank === null ? "—" : `#${stat.rank}`}</strong>
              <small>{formatDecimal(stat.value, 1)}{stat.suffix ?? " grade"}</small>
            </div>
          ))}
        </div>
      ) : (
        <SectionError title="No PFN team context found for this matchup." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} compact />
      )}
    </section>
  );
}

export function gameLogSummary(position: string, stats: Record<string, number>): string {
  const value = (key: string): number => stats[key] ?? 0;
  const pieces = position === "QB"
    ? [`${value("passCmp")}/${value("passAtt")} passing`, `${value("passYds")} pass yds`, `${value("passTd")} pass TD`, `${value("interceptions")} INT`, `${value("rushYds")} rush yds`]
    : position === "RB"
      ? [`${value("rushAtt")} car`, `${value("rushYds")} rush yds`, `${value("targets")} tgt`, `${value("receptions")} rec`, `${value("recYds")} rec yds`, `${value("rushTd") + value("recTd")} TD`]
      : [`${value("targets")} tgt`, `${value("receptions")} rec`, `${value("recYds")} rec yds`, `${value("recTd")} rec TD`, `${value("rushYds")} rush yds`];
  return pieces.join(" · ");
}

export function SeasonGameLog({ player, history, isLoading }: { player: PlayerSearchResult; history: BoomBustHistory | undefined; isLoading: boolean }) {
  const games = history?.gameLog ?? [];
  const totals = history?.seasonTotals ?? {};
  const totalOrder = player.position === "QB"
    ? ["fantasyPoints", "passCmp", "passAtt", "passYds", "passTd", "interceptions", "rushYds", "rushTd"]
    : player.position === "RB"
      ? ["fantasyPoints", "rushAtt", "rushYds", "rushTd", "targets", "receptions", "recYds", "recTd"]
      : ["fantasyPoints", "targets", "receptions", "recYds", "recTd", "rushAtt", "rushYds", "rushTd"];
  const totalRows = totalOrder.flatMap((key) => typeof totals[key] === "number" ? [{ key, value: totals[key] ?? 0 }] : []);

  if (isLoading && !history) return <div className="player-tab-loading"><span className="loading-shimmer" /><span className="loading-shimmer" /><span className="loading-shimmer" /></div>;
  if (!isBoomBustPosition(player.position)) return <div className="player-tab-empty"><strong>Season log unavailable</strong><span>Weekly stat logs are currently available for QB, RB, WR, and TE.</span></div>;
  if (history?.status === "unavailable") return <div className="player-tab-empty"><strong>Season log didn’t load</strong><span>Try again after the next Sleeper data refresh.</span></div>;
  if (games.length === 0) return <div className="player-tab-empty"><strong>No games yet this season</strong><span>Games appear after Sleeper records participation.</span></div>;

  return (
    <div className="player-season-panel">
      <section aria-labelledby="player-season-totals-heading">
        <div className="section-heading"><h3 id="player-season-totals-heading">Season totals</h3><span>{games.length} game{games.length === 1 ? "" : "s"}</span></div>
        <div className="player-season-totals">
          {totalRows.map(({ key, value: totalValue }) => (
            <div key={key}><span>{gameLogStatLabels[key] ?? key}</span><strong>{key === "fantasyPoints" ? formatDecimal(totalValue, 1) : Number.isInteger(totalValue) ? formatDecimal(totalValue, 0) : formatDecimal(totalValue, 1)}</strong></div>
          ))}
        </div>
      </section>
      <section className="player-game-log" aria-labelledby="player-game-log-heading">
        <div className="section-heading"><h3 id="player-game-log-heading">Game log</h3><span>2026 regular season</span></div>
        <div className="player-game-log-list">
          {[...games].reverse().map((game) => (
            <article key={`${game.season}-${game.week}`}>
              <div><strong>W{game.week}</strong><span>{game.opponent ? `vs ${game.opponent}` : "Opponent unavailable"}</span></div>
              <p>{gameLogSummary(player.position, game.stats)}</p>
              <b>{formatDecimal(game.points, 1)}<small>PTS</small></b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function normalizePlayerIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function PlayerAdvancedPanel({ player, analytics, children }: { player: PlayerSearchResult; analytics: Dashboard["analytics"]; children: ReactNode }) {
  const position = (["QB", "RB", "WR", "TE", "K", "DEF"] as string[]).includes(player.position) ? player.position as BasePosition : null;
  const normalizedPlayerName = normalizePlayerIdentity(player.name);
  const playerTeam = canonicalNflTeam(player.team);
  const entity: AnalyticsEntity | undefined = position
    ? analytics.entities.find((candidate) => candidate.position === position && (
      normalizePlayerIdentity(candidate.name) === normalizedPlayerName
      || (position === "DEF" && canonicalNflTeam(candidate.team) === playerTeam)
    ))
    : undefined;
  const values = entity?.season ?? {};
  const metrics = (position ? detailAdvancedMetrics[position] ?? [] : []).flatMap((metric) => {
    const metricValue = metric.derived ? metric.derived(values) : values[metric.key];
    return typeof metricValue === "number" && Number.isFinite(metricValue) ? [{ ...metric, value: metricValue }] : [];
  });

  return (
    <div className="player-advanced-panel">
      <section aria-labelledby="player-advanced-metrics-heading">
        <div className="section-heading"><h3 id="player-advanced-metrics-heading">Efficiency &amp; usage</h3><span>{entity ? `${entity.seasonGames} games` : null}</span></div>
        {metrics.length > 0 ? (
          <div className="player-advanced-grid">
            {metrics.map((metric) => <div key={metric.key}><span>{metric.label}</span><strong>{formatDecimal(metric.value, metric.digits ?? 1)}{metric.unit ?? ""}</strong></div>)}
          </div>
        ) : <div className="player-tab-empty compact"><strong>No advanced metrics yet</strong><span>nflverse has not published a matching season row for this player.</span></div>}
        {entity && analytics.throughWeek !== null ? <p className="player-tab-source">Through Week {analytics.throughWeek} · nflverse weekly player stats</p> : null}
      </section>
      {children}
    </div>
  );
}

export function PlayerDetailSheet({
  player,
  week,
  leagueId,
  formatKey,
  mode,
  analytics,
  newsItems,
  sosEntry,
  newsLoading = false,
  newsError = false,
  onRetryNews,
  onModeChange,
  onOpenMatchup,
  onBack,
  canGoBack,
  onClose,
  presentation = "modal",
}: {
  player: PlayerSearchResult;
  week: number;
  leagueId: string;
  formatKey: string;
  mode: "details" | "chart";
  analytics: Dashboard["analytics"];
  newsItems: PlayerNewsItem[];
  sosEntry?: StrengthOfScheduleEntryLike;
  newsLoading?: boolean;
  newsError?: boolean;
  onRetryNews?: () => void;
  onModeChange?: (mode: "details" | "chart") => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
  onBack: () => void;
  canGoBack: boolean;
  onClose: () => void;
  /** Docked column skips portal, backdrop, scroll lock, and inert. */
  presentation?: "modal" | "docked";
}) {
  const isModal = presentation === "modal";
  const sheetRef = useRef<HTMLElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const directionTimerRef = useRef<number | null>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    rawDx: number;
    rawDy: number;
    startedAt: number;
    axis: "x" | "y" | "none" | null;
    horizontalBlocked: boolean;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [contentDirection, setContentDirection] = useState<"back" | "none">("none");
  const [activeTab, setActiveTab] = useState<PlayerDetailTab>("overview");
  useDialogFocusTrap(sheetRef, onClose, isModal);
  useEffect(() => {
    if (isModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModal, onClose]);

  const resetDrag = useCallback((animate: boolean) => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    setDragging(false);
    setPlayerSheetDragLock(false);
    setSettling(animate);
    setDragOffset({ x: 0, y: 0 });
    if (animate) {
      settleTimerRef.current = window.setTimeout(() => setSettling(false), 190);
    }
  }, []);

  useEffect(() => () => {
    setPlayerSheetDragLock(false);
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    if (directionTimerRef.current) window.clearTimeout(directionTimerRef.current);
  }, []);

  useEffect(() => {
    gestureRef.current = null;
    resetDrag(false);
    setActiveTab("overview");
  }, [player.playerId, resetDrag]);

  const beginTouch = (event: ReactTouchEvent<HTMLElement>) => {
    if (!isModal) return;
    if (event.touches.length !== 1) {
      gestureRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target instanceof Element ? event.target : null;
    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      rawDx: 0,
      rawDy: 0,
      startedAt: performance.now(),
      axis: null,
      horizontalBlocked: Boolean(target?.closest("canvas, svg, .player-value-trend, .boom-bust-panel, [data-player-chart]")),
    };
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    setSettling(false);
  };

  const moveTouch = (event: ReactTouchEvent<HTMLElement>) => {
    if (!isModal) return;
    const gesture = gestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch) return;
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    gesture.rawDx = dx;
    gesture.rawDy = dy;
    if (gesture.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        gesture.axis = canGoBack && dx > 0 && !gesture.horizontalBlocked ? "x" : "none";
      } else {
        gesture.axis = sheetRef.current?.scrollTop === 0 && dy > 0 ? "y" : "none";
      }
    }
    if (gesture.axis === "none") return;
    if (gesture.axis === "y" && (dy <= 0 || (sheetRef.current?.scrollTop ?? 0) > 0)) {
      gesture.axis = "none";
      resetDrag(true);
      return;
    }
    if (gesture.axis === "x" && dx <= 0) {
      gesture.axis = "none";
      resetDrag(true);
      return;
    }
    event.preventDefault();
    setDragging(true);
    setPlayerSheetDragLock(true);
    setDragOffset(gesture.axis === "x"
      ? { x: Math.max(0, dx * 0.82), y: 0 }
      : { x: 0, y: Math.max(0, dy * 0.72) });
  };

  const navigateBack = () => {
    if (!canGoBack) return;
    setContentDirection("back");
    resetDrag(false);
    onBack();
    if (directionTimerRef.current) window.clearTimeout(directionTimerRef.current);
    directionTimerRef.current = window.setTimeout(() => setContentDirection("none"), 190);
  };

  const endTouch = (event: ReactTouchEvent<HTMLElement>) => {
    if (!isModal) return;
    const gesture = gestureRef.current;
    const touch = event.changedTouches[0];
    if (gesture && touch) {
      gesture.rawDx = touch.clientX - gesture.startX;
      gesture.rawDy = touch.clientY - gesture.startY;
    }
    gestureRef.current = null;
    if (!gesture || gesture.axis === null || gesture.axis === "none") {
      resetDrag(false);
      return;
    }
    const elapsed = Math.max(1, performance.now() - gesture.startedAt);
    if (gesture.axis === "y") {
      const velocity = gesture.rawDy / elapsed;
      if (gesture.rawDy > 110 || (gesture.rawDy > 34 && velocity > 0.5)) {
        onClose();
        return;
      }
      resetDrag(true);
      return;
    }
    const velocity = gesture.rawDx / elapsed;
    if (canGoBack && (gesture.rawDx > 70 || (gesture.rawDx > 24 && velocity > 0.5))) {
      navigateBack();
      return;
    }
    resetDrag(true);
  };

  const cancelTouch = () => {
    if (!isModal) return;
    gestureRef.current = null;
    resetDrag(true);
  };

  const boomBustPosition = isBoomBustPosition(player.position) ? player.position : null;
  const supportsBoomBust = boomBustPosition !== null;
  const [boomBustView, setBoomBustView] = useState<"season" | "last3">("season");
  useEffect(() => setBoomBustView("season"), [player.playerId]);
  const boomBustQuery = useQuery({
    queryKey: ["boom-bust-history", leagueId, player.playerId, boomBustView],
    queryFn: () => {
      if (!boomBustPosition) throw new Error("Unsupported position");
      return api.getBoomBustHistory({ leagueId, playerId: player.playerId, position: boomBustPosition, view: boomBustView });
    },
    enabled: supportsBoomBust,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["fantasycalc-value-history", formatKey, [player.playerId]],
    queryFn: () => api.getValueHistory({ formatKey, playerIds: [player.playerId] }),
    enabled: player.position !== "PICK" && player.seasonValue !== null,
    staleTime: 30 * 60 * 1000,
  });
  const valueHistory = historyQuery.data?.series.find((series) => series.playerId === player.playerId);

  const weeklyWidth = player.weeklyProjection === null ? 0 : Math.min(100, Math.max(4, player.weeklyProjection / 30 * 100));
  const valueWidth = player.seasonValue === null ? 0 : Math.min(100, Math.max(4, player.seasonValue / 10_000 * 100));
  const positionLabel = player.position === "DEF" ? "DST" : player.position;
  const projectionComponents = projectionComponentsForPlayer(player);
  const defenseProjectionComponents = player.defenseComponents
    ? Object.entries(defenseComponentLabels).flatMap(([key, label]) => {
        const value = player.defenseComponents?.[key];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ key, label, value, isYards: key === "pr_yd" || key === "kr_yd" || key === "yds_allow" }]
          : [];
      })
    : [];

  const sheet = (
        <section
        ref={sheetRef}
        className={`player-detail-sheet${isModal ? "" : " is-docked"}${dragging ? " is-dragging" : ""}${settling ? " is-settling" : ""}`}
        style={isModal ? { transform: `translate3d(0, ${dragOffset.y}px, 0)` } : undefined}
        role="dialog"
        aria-modal={isModal ? true : undefined}
        aria-labelledby="player-detail-name"
        tabIndex={-1}
        onClick={isModal ? (event) => event.stopPropagation() : undefined}
        onTouchStart={isModal ? beginTouch : undefined}
        onTouchMove={isModal ? moveTouch : undefined}
        onTouchEnd={isModal ? endTouch : undefined}
        onTouchCancel={isModal ? cancelTouch : undefined}
      >
        <div
          key={player.playerId}
          className={`player-detail-content${contentDirection === "back" ? " history-back" : ""}${dragging ? " is-dragging" : ""}${settling ? " is-settling" : ""}`}
          style={isModal ? { transform: `translate3d(${dragOffset.x}px, 0, 0)` } : undefined}
        >
        {isModal ? <div className="player-sheet-grabber" aria-hidden="true" /> : null}
        <header className="player-detail-header">
          <div>
            <div className="player-detail-title-line">
              <h2 id="player-detail-name">{player.name}</h2>
            </div>
            <p>
              <span>{positionLabel}</span>
              <MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={player.team && player.opponent && onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase ?? null }) : undefined} />
              <SosRankChip entry={sosEntry} opponent={player.opponent} position={player.position} />
            </p>
          </div>
          <div className="player-detail-actions">
            {canGoBack ? <button type="button" onClick={navigateBack} aria-label="Previous player">←</button> : null}
            <button type="button" onClick={onClose} aria-label="Close player details">×</button>
          </div>
        </header>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PlayerDetailTab)} className="player-detail-tabs">
          <TabsList aria-label={`${player.name} details`}>
            <TabsTrigger id="player-detail-overview-tab" value="overview" aria-controls="player-detail-overview-panel">Overview</TabsTrigger>
            <TabsTrigger id="player-detail-season-tab" value="season" aria-controls="player-detail-season-panel">Season</TabsTrigger>
            <TabsTrigger id="player-detail-advanced-tab" value="advanced" aria-controls="player-detail-advanced-panel">Advanced</TabsTrigger>
          </TabsList>
        </Tabs>
        {activeTab === "overview" ? <div id="player-detail-overview-panel" role="tabpanel" aria-labelledby="player-detail-overview-tab">
        {onModeChange ? (
          <SegmentedControl
            className="player-detail-mode-toggle"
            value={mode}
            onChange={onModeChange}
            label={`${player.name} detail view`}
            options={[{ value: "details", label: "Details" }, { value: "chart", label: "Chart" }]}
          />
        ) : null}
        {mode === "chart" ? (
          <div className="player-chart-peek">
            <div><span>Week {week} {player.gamePhase === "final" ? "points" : player.gamePhase === "live" ? "live projection" : "projection"}</span><i><b style={{ width: `${weeklyWidth}%` }} /></i><strong>{formatProjectionPoints(player.weeklyProjection, player.projectionSource)}</strong></div>
            <div><span>Season-long market value</span><i><b style={{ width: `${valueWidth}%` }} /></i><strong>{player.seasonValue === null ? "—" : player.seasonValue.toLocaleString()}</strong></div>
          </div>
        ) : (
          <div className="player-detail-values">
            <div><span>Week {week} {player.gamePhase === "final" ? "points" : player.gamePhase === "live" ? "live projection" : "projection"}</span><strong>{formatProjectionPoints(player.weeklyProjection, player.projectionSource)}</strong><small>{player.weeklyProjection === null ? "No weekly projection" : player.weeklyRank === null ? "No weekly rank" : `${positionLabel} #${player.weeklyRank}`}</small></div>
            <div><span>Season-long value</span><strong>{player.seasonValue === null ? "—" : player.seasonValue.toLocaleString()}</strong><small>{player.seasonRank === null ? "No season rank" : `${positionLabel} #${player.seasonRank}`}</small></div>
          </div>
        )}
        <div className="player-detail-meta">
          <span>{player.isRostered ? "Rostered in this league" : "Available in this league"}</span>
          {player.injuryStatus ? <span className="player-detail-injury">Injury status: {player.injuryStatus}</span> : null}
          {player.seasonValue !== null ? <span className="player-detail-movement">{movementLabel(player.movement30Day)}</span> : null}
        </div>
        {player.waiverTrends && (player.waiverTrends.adds || player.waiverTrends.drops) ? (
          <section className="player-detail-waiver-trends" aria-label={`${player.name} waiver activity`}>
            <div className="section-heading"><h3>Waiver activity</h3><span>Last 24 hours</span></div>
            <div className="player-detail-waiver-trend-list">
              {player.waiverTrends.adds ? (
                <div>
                  <span className="trending-add">+{player.waiverTrends.adds.rank} TREND</span>
                  <strong>{player.waiverTrends.adds.count.toLocaleString()} adds</strong>
                </div>
              ) : null}
              {player.waiverTrends.drops ? (
                <div>
                  <span className="trending-drop">−{player.waiverTrends.drops.rank} DROP</span>
                  <strong>{player.waiverTrends.drops.count.toLocaleString()} drops</strong>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {player.position !== "DEF" && player.gamePhase !== "final" && projectionComponents.length > 0 ? (
          <section className="dst-breakdown" aria-label={`${player.name} projection components`}>
            <div className="section-heading"><h3>Projection components</h3></div>
            <div className="dst-breakdown-grid">
              {projectionComponents.map((component) => (
                <div key={component.key}>
                  <span>{component.label}</span>
                  <strong>{component.isYards ? formatDecimal(Math.round(component.value), 0) : formatDecimal(component.value, 1)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {player.position === "DEF" && player.gamePhase !== "final" && defenseProjectionComponents.length > 0 ? (
          <section className="dst-breakdown" aria-label={`${player.name} projection components`}>
            <div className="section-heading"><h3>Projection components</h3></div>
            <div className="dst-breakdown-grid">
              {defenseProjectionComponents.map((component) => (
                <div key={component.key}>
                  <span>{component.label}</span>
                  <strong>{component.isYards ? formatDecimal(Math.round(component.value), 0) : formatDecimal(component.value, 1)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <PlayerTeamContext player={player} />
        <section className="player-news-section" aria-label={`${player.name} news`}>
          <div className="section-heading"><h3>Latest news</h3><span>{newsItems.length > 0 ? newsItems.length : null}</span></div>
          {newsError && onRetryNews ? (
            <SectionError title="News didn’t load." onRetry={onRetryNews} compact />
          ) : newsLoading ? (
            <div className="empty-inline compact">Loading news…</div>
          ) : newsItems.length > 0 ? newsItems.slice(0, 4).map((item) => (
            <article className="player-news-item" key={item.id}>
              <div><span className={`news-severity ${item.newsType}`}>{item.newsType === "headline" ? "League news" : item.newsType === "waiver" ? "Waiver signal" : "Roster update"}</span><time>{item.sourcePublishedAt ? newsTimeLabel(item.sourcePublishedAt) : "Recent"}</time></div>
              <strong>{item.change}</strong>
              <p>{item.roleContext}</p>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel}<span className="sr-only"> (opens in a new tab)</span></a>
            </article>
          )) : <div className="empty-inline compact">No recent news for this player.</div>}
        </section>
        {player.position !== "PICK" && player.seasonValue !== null ? (
          <Suspense fallback={<div className="loading-shimmer player-value-trend-loading" aria-hidden="true" />}>
            <LazyPlayerValueTrend name={player.name} history={valueHistory} isLoading={historyQuery.isPending} />
          </Suspense>
        ) : null}
        {supportsBoomBust ? (
          <BoomBustPanel name={player.name} view={boomBustView} onViewChange={setBoomBustView} history={boomBustQuery.data} isLoading={boomBustQuery.isPending} />
        ) : null}
        </div> : null}
        {activeTab === "season" ? (
          <div id="player-detail-season-panel" role="tabpanel" aria-labelledby="player-detail-season-tab">
            <SeasonGameLog player={player} history={boomBustQuery.data} isLoading={boomBustQuery.isPending} />
          </div>
        ) : null}
        {activeTab === "advanced" ? (
          <div id="player-detail-advanced-panel" role="tabpanel" aria-labelledby="player-detail-advanced-tab">
            <PlayerAdvancedPanel player={player} analytics={analytics}>
              <PlayerTeamContext player={player} />
            </PlayerAdvancedPanel>
          </div>
        ) : null}
        </div>
        </section>
  );

  if (!isModal) return sheet;

  return (
    <ModalPortal>
      <div className="player-detail-backdrop" onClick={onClose}>
        {sheet}
      </div>
    </ModalPortal>
  );
}

export function BoomBustPanel({
  name,
  view,
  onViewChange,
  history,
  isLoading,
}: {
  name: string;
  view: "season" | "last3";
  onViewChange: (view: "season" | "last3") => void;
  history: BoomBustHistory | undefined;
  isLoading: boolean;
}) {
  const weeklyScores = history?.weeklyScores ?? [];
  const floor = history?.floor ?? null;
  const firstQuartile = history?.firstQuartile ?? null;
  const medianScore = history?.median ?? null;
  const meanScore = history?.mean ?? null;
  const thirdQuartile = history?.thirdQuartile ?? null;
  const ceiling = history?.ceiling ?? null;
  const plotMinimum = weeklyScores.length > 0 ? Math.min(...weeklyScores.map((score) => score.points)) : null;
  const range = plotMinimum !== null && ceiling !== null ? ceiling - plotMinimum : 0;
  const markerPosition = (value: number): number => range === 0 || plotMinimum === null ? 50 : ((value - plotMinimum) / range) * 100;
  const scoreLabel = (value: number | null): string => value === null ? "—" : formatDecimal(value, 1);
  const gameLabel = (score: { season: number; week: number }): string => view === "last3" ? `${score.season} Week ${score.week}` : `Week ${score.week}`;
  const description = weeklyScores.map((score) => `${gameLabel(score)}: ${formatDecimal(score.points, 1)}`).join(", ");
  const showQuartiles = weeklyScores.length >= 8 && firstQuartile !== null && thirdQuartile !== null;
  const quartileDescription = showQuartiles ? ` Interquartile range ${scoreLabel(firstQuartile)} to ${scoreLabel(thirdQuartile)}.` : "";
  const rangeLabel = view === "last3" ? "2024 through 2026 regular-season weekly scores" : "2026 weekly scores";

  return (
    <section className="boom-bust-panel" aria-label={`${name} boom bust history`}>
      <div className="boom-bust-heading">
        <div className="boom-bust-heading-copy">
          <span>Boom / Bust</span>
          <strong>{weeklyScores.length > 0 ? `${weeklyScores.length} game${weeklyScores.length === 1 ? "" : "s"}` : "Weekly range"}</strong>
        </div>
        <div className="boom-bust-toggle" role="group" aria-label="Boom Bust history range">
          <button type="button" className={view === "season" ? "active" : ""} aria-pressed={view === "season"} onClick={() => onViewChange("season")}>2026</button>
          <button type="button" className={view === "last3" ? "active" : ""} aria-pressed={view === "last3"} onClick={() => onViewChange("last3")}>Last 3 Years</button>
        </div>
      </div>
      {isLoading && !history ? (
        <div className="loading-shimmer boom-bust-loading" aria-hidden="true" />
      ) : weeklyScores.length > 0 && floor !== null && medianScore !== null && meanScore !== null && ceiling !== null ? (
        <div className="boom-bust-visual" role="img" aria-label={`${name} ${rangeLabel}. ${description}. Bust ${scoreLabel(floor)}, ${weeklyScores.length >= 5 ? "10th percentile" : "minimum with fewer than 5 qualified weeks"}; median ${scoreLabel(medianScore)}, mean ${scoreLabel(meanScore)}, ceiling ${scoreLabel(ceiling)}.${quartileDescription}`}>
          <div className="boom-bust-track">
            <div className="boom-bust-band" />
            {showQuartiles ? (
              <div
                className="boom-bust-iqr"
                style={{ left: `${markerPosition(firstQuartile)}%`, width: `${markerPosition(thirdQuartile) - markerPosition(firstQuartile)}%` }}
                title={`Middle 50%: ${formatDecimal(firstQuartile, 1)}–${formatDecimal(thirdQuartile, 1)} points`}
              />
            ) : null}
            {weeklyScores.map((score, index) => (
              <i
                className={`boom-bust-dot ${index % 2 === 0 ? "above" : "below"}`}
                key={`${score.season}-${score.week}`}
                style={{ left: `${markerPosition(score.points)}%` }}
                title={`${gameLabel(score)}: ${formatDecimal(score.points, 1)} points`}
              />
            ))}
            <i className="boom-bust-bust-mark" style={{ left: `${markerPosition(floor)}%` }} title={weeklyScores.length >= 5 ? `Bust (10th percentile): ${formatDecimal(floor, 1)} points` : `Bust (minimum): ${formatDecimal(floor, 1)} points`} />
            <i className="boom-bust-median-mark" style={{ left: `${markerPosition(medianScore)}%` }} title={`Median: ${formatDecimal(medianScore, 1)} points`} />
            <i className="boom-bust-mean-mark" style={{ left: `${markerPosition(meanScore)}%` }} title={`Mean: ${formatDecimal(meanScore, 1)} points`} />
          </div>
          <div className="boom-bust-labels">
            <span><small>Bust · {weeklyScores.length >= 5 ? "10th %ile" : "min"}</small><strong>{scoreLabel(floor)}</strong></span>
            <span><small>Median</small><strong>{scoreLabel(medianScore)}</strong></span>
            <span><small>Mean</small><strong>{scoreLabel(meanScore)}</strong></span>
            <span><small>Ceiling</small><strong>{scoreLabel(ceiling)}</strong></span>
          </div>
        </div>
      ) : (
        <div className="boom-bust-empty">{isLoading ? "Loading weekly results…" : history?.status === "unavailable" ? "No scoring history yet. Try again after the next data refresh." : view === "last3" ? "No games in the last 3 seasons" : "No games yet this season"}</div>
      )}
      {view === "last3" && history?.coverageNote ? <p className="boom-bust-note">{history.coverageNote}</p> : null}
    </section>
  );
}

