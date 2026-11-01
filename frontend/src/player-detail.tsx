import { refreshPlayerCard, playerPointsLabel } from "./player-card-state";
import { WeeklyPointsChart } from "./views/weekly-points-chart";
import { RangeBar, rangeDomain } from "./components/range-bar";
import { OutcomeBox, outcomeSummary } from "./components/outcome-box";
import { ScheduleStrip } from "./views/schedule-strip";
import type { UpcomingGame } from "../../api/_lib/upcoming-schedule";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { ToolLinks, type ToolLinkItem } from "./tool-links";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "./api";
import type {
  AnalyticsEntity,
  BasePosition,
  BoomBustHistory,
  Dashboard,
  DetailMetric,
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
  newsItemTimeLabel,
  pfnNumber,
  pfnRankForRow,
  projectionComponentsForPlayer,
} from "./dashboard-shared";
import { actualComponentsForGame } from "./actual-components";
import { isHttpOrHttpsUrl } from "../../api/_lib/http-url";
import { NewsTypeBadges } from "./news-badges";
import { faabBidLabel, formatCompactCount, formatDecimal, formatPercent, formatPoints, formatWhole } from "./lib/format-number";
import { buildGameLogRows } from "./lib/game-log-rows";
import { positionTierLabel } from "./lib/position-tier";
import { useProfileTag } from "./lib/use-profile-tag";
import { peerSeasonRates, seasonRateRows } from "./player-season-rates";
import { PlayerExpectedPoints, PlayerNextGen, PlayerPropsSection } from "./player-insights-sections";
import { ModalPortal, ProfileChips, SegmentedControl, positionalSosRank, rankAgainst, rankToneClassName, setPlayerSheetDragLock, useDialogFocusTrap, type StrengthOfScheduleEntryLike } from "./shared";
import { useMinuteNow } from "./use-minute-now";
import { BackGlyph, CloseGlyph, MoveTriangle } from "./components/glyphs";
import { EmptyState, LoadingBlock } from "./components/state-blocks";

const LazyPlayerValueTrend = lazy(() => import("./player-charts").then((module) => ({ default: module.PlayerValueTrend })));

export const detailAdvancedMetrics: Partial<Record<BasePosition, DetailMetric[]>> = {
  QB: [
    { key: "pass_attempts", label: "Pass attempts / game", digits: 2 },
    { key: "completion_pct", label: "Completion rate", unit: "%", digits: 2 },
    { key: "cpoe", label: "CPOE", unit: "%", digits: 2 },
    { key: "epa_per_play", label: "EPA / play", digits: 2 },
    { key: "carries", label: "Carries / game", digits: 2 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 2 },
  ],
  RB: [
    { key: "touches", label: "Touches / game", digits: 2 },
    { key: "target_share", label: "Target share", unit: "%", digits: 2 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 2 },
    { key: "scrimmage_yards", label: "Scrimmage yds / game", digits: 2 },
    { key: "yards_per_touch", label: "Yards / touch", digits: 2, derived: (values) => {
      const touches = values.touches;
      const yards = values.scrimmage_yards;
      return typeof touches === "number" && touches > 0 && typeof yards === "number" ? yards / touches : null;
    } },
    { key: "rushing_epa", label: "Rushing EPA / game", digits: 2 },
  ],
  WR: [
    { key: "targets", label: "Targets / game", digits: 2 },
    { key: "target_share", label: "Target share", unit: "%", digits: 2 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 2 },
    { key: "air_yards_share", label: "Air-yards share", unit: "%", digits: 2 },
    { key: "wopr", label: "WOPR", digits: 2 },
    { key: "yards_per_target", label: "Yards / target", digits: 2, derived: (values) => {
      const targets = values.targets;
      const yards = values.receiving_yards;
      return typeof targets === "number" && targets > 0 && typeof yards === "number" ? yards / targets : null;
    } },
  ],
  TE: [
    { key: "targets", label: "Targets / game", digits: 2 },
    { key: "target_share", label: "Target share", unit: "%", digits: 2 },
    { key: "snap_share", label: "Snap share", unit: "%", digits: 2 },
    { key: "air_yards_share", label: "Air-yards share", unit: "%", digits: 2 },
    { key: "wopr", label: "WOPR", digits: 2 },
    { key: "yards_per_target", label: "Yards / target", digits: 2, derived: (values) => {
      const targets = values.targets;
      const yards = values.receiving_yards;
      return typeof targets === "number" && targets > 0 && typeof yards === "number" ? yards / targets : null;
    } },
  ],
  K: [
    { key: "fg_attempts", label: "FG attempts / game", digits: 2 },
    { key: "fg_pct", label: "Field-goal rate", unit: "%", digits: 2 },
    { key: "fg_50_plus", label: "50+ FG / game", digits: 2 },
    { key: "pat_attempts", label: "PAT attempts / game", digits: 2 },
  ],
  DEF: [
    { key: "qb_hits", label: "QB hits / game", digits: 2 },
    { key: "sacks", label: "Sacks / game", digits: 2 },
    { key: "takeaways", label: "Takeaways / game", digits: 2 },
    { key: "tackles_for_loss", label: "TFL / game", digits: 2 },
  ],
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

  const refresh = useCallback((player: PlayerSearchResult) => {
    setHistory((current) => refreshPlayerCard(current, player));
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
    refresh,
    back,
    close,
  };
}

export function PlayerTeamContext({
  player,
  sosEntry,
}: {
  player: PlayerSearchResult;
  sosEntry?: StrengthOfScheduleEntryLike;
}) {
  const query = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const tables = query.data?.tables;
  const team = canonicalNflTeam(player.team);
  const opponent = canonicalNflTeam(player.opponent);
  const findRow = (table: PfnTable | null | undefined, code: string | null) => table?.rows.find((row) => canonicalNflTeam(row.team) === code);
  const offensiveLine = tables?.["offensive-line"] ?? null;
  const offense = tables?.offense ?? null;
  const defense = tables?.defense ?? null;
  const teamLine = findRow(offensiveLine, team);
  const teamOffense = findRow(offense, team);
  const teamDefense = findRow(defense, team);
  const opponentOffense = findRow(offense, opponent);
  const opponentDefense = findRow(defense, opponent);
  const stats: PfnContextStat[] = [];
  const sosRank = positionalSosRank(sosEntry, player.opponent, player.position);

  const addStat = (label: string, table: PfnTable | null, row: PfnRow | undefined, key: string, options?: { higherIsBetter?: boolean; suffix?: string; tableRank?: boolean }) => {
    const value = pfnNumber(row, key);
    if (value === null) return;
    stats.push({
      label,
      value,
      rank: options?.tableRank ? row?.rank ?? null : pfnRankForRow(table, row, key, options?.higherIsBetter ?? true),
      suffix: options?.suffix,
    });
  };

  if (player.position === "QB") {
    addStat("Pass-block rank", offensiveLine, teamLine, "pass_block");
    addStat("Team pass rank", offense, teamOffense, "pass");
    addStat("Opponent pass defense", defense, opponentDefense, "pass");
  } else if (player.position === "RB") {
    addStat("Run-block rank", offensiveLine, teamLine, "run_block");
    addStat("Opponent run defense", defense, opponentDefense, "run");
  } else if (player.position === "WR" || player.position === "TE") {
    addStat("Team pass rank", offense, teamOffense, "pass");
    addStat("Pass-block rank", offensiveLine, teamLine, "pass_block");
    addStat("Opponent pass defense", defense, opponentDefense, "pass");
  } else if (player.position === "DEF") {
    addStat("Defense rank", defense, teamDefense, "grade", { tableRank: true });
    addStat("Points-allowed rank", defense, teamDefense, "pts_allowed_per_game", { higherIsBetter: false, suffix: " PPG" });
    addStat("Opponent offense", offense, opponentOffense, "grade", { tableRank: true });
  } else if (player.position === "K") {
    addStat("Team scoring", offense, teamOffense, "ppg", { suffix: " PPG" });
  }

  const contextRows = sosRank === null && stats.length === 0;
  return (
    <section className="player-team-context" aria-label={`${player.name} team and matchup context`}>
      <div className="section-heading">
        <h3>Team context</h3>
      </div>
      {query.isPending && sosRank === null ? (
        <div className="player-team-context-state" role="status">Loading team context…</div>
      ) : null}
      {query.isError ? (
        <SectionError title="Team context didn’t load." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} compact />
      ) : null}
      {sosRank !== null || stats.length > 0 ? (
        <div className="player-team-context-grid">
          {sosRank !== null ? (
            <div>
              <span>SOS</span>
              <strong className={rankToneClassName(sosRank)}>#{sosRank}</strong>
            </div>
          ) : null}
          {stats.map((stat) => (
            <div key={stat.label}>
              <span>{stat.label}</span>
              <strong className={rankToneClassName(stat.rank)}>{stat.rank === null ? "—" : `#${stat.rank}`}</strong>
              {stat.suffix ? <small>{formatDecimal(stat.value, 2)}{stat.suffix}</small> : null}
            </div>
          ))}
        </div>
      ) : contextRows && !query.isPending && !query.isError ? (
        <SectionError title="No PFN team context found for this matchup." onRetry={() => { void query.refetch(); }} retrying={query.isFetching} compact />
      ) : null}
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

export function SeasonGameLog({
  player,
  history,
  analytics,
  isLoading,
}: {
  player: PlayerSearchResult;
  history: BoomBustHistory | undefined;
  analytics: Dashboard["analytics"];
  isLoading: boolean;
}) {
  const games = history?.gameLog ?? [];
  const totals = history?.seasonTotals ?? {};
  const totalOrder = player.position === "QB"
    ? ["fantasyPoints", "passCmp", "passAtt", "passYds", "passTd", "interceptions", "rushYds", "rushTd"]
    : player.position === "RB"
      ? ["fantasyPoints", "rushAtt", "rushYds", "rushTd", "targets", "receptions", "recYds", "recTd"]
      : ["fantasyPoints", "targets", "receptions", "recYds", "recTd", "rushAtt", "rushYds", "rushTd"];
  const playerName = normalizePlayerIdentity(player.name);
  const playerTeam = canonicalNflTeam(player.team);
  const rateRows = seasonRateRows(totalOrder, totals, games.length, (analyticsKey) => peerSeasonRates(
    analytics.entities,
    player.position,
    analyticsKey,
    (entity) => normalizePlayerIdentity(entity.name) === playerName || (player.position === "DEF" && canonicalNflTeam(entity.team) === playerTeam),
  ));

  const gameLogRows = buildGameLogRows(games);

  if (isLoading && !history) return <div className="player-tab-loading"><span className="loading-shimmer" /><span className="loading-shimmer" /><span className="loading-shimmer" /></div>;
  if (!isBoomBustPosition(player.position)) return <EmptyState title="Season log unavailable" detail="Weekly stat logs are currently available for QB, RB, WR, and TE." />;
  if (history?.status === "unavailable") return <EmptyState title="Season log didn’t load" detail="Try again after the next Sleeper data refresh." />;
  if (games.length === 0) return <EmptyState title="No games yet this season" detail="Games appear after Sleeper records participation." />;

  return (
    <div className="player-season-panel">
      <section aria-labelledby="player-season-rates-heading">
        <div className="section-heading"><h3 id="player-season-rates-heading">Per game</h3></div>
        <div className="player-season-totals">
          {rateRows.map((row) => (
            <div key={row.key}>
              <span>{row.label}</span>
              <b className="player-rate-value">
                <strong className={row.rank === null ? undefined : rankToneClassName(row.rank)}>{row.rate === null ? "—" : formatDecimal(row.rate, 2)}</strong>
                {row.rank === null ? null : <small>#{row.rank}</small>}
              </b>
            </div>
          ))}
        </div>
      </section>
      <section className="player-game-log" aria-labelledby="player-game-log-heading">
        <div className="section-heading"><h3 id="player-game-log-heading">Game log</h3></div>
        <div className="player-game-log-list">
          {gameLogRows.map((row) => row.kind === "gap" ? (
            <article key={`gap-${row.season}-${row.week}`} className="is-gap">
              <div><strong>W{row.week}</strong></div>
              <p>No game</p>
            </article>
          ) : (
            <article key={`${row.game.season}-${row.game.week}`} style={{ "--share": row.share } as CSSProperties}>
              <div><strong>W{row.game.week}</strong><span>{row.game.opponent ? `vs ${row.game.opponent}` : "Opponent unavailable"}</span></div>
              <p>{gameLogSummary(player.position, row.game.stats)}</p>
              <b>{formatPoints(row.game.points)}</b>
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

export function PlayerAdvancedPanel({ player, analytics, isLoading = false, leading = null, children }: { player: PlayerSearchResult; analytics: Dashboard["analytics"]; isLoading?: boolean; leading?: ReactNode; children: ReactNode }) {
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
  // Every metric for the position is listed, so a gap in the data shows as "—" instead of a missing tile.
  const metrics = (position ? detailAdvancedMetrics[position] ?? [] : []).map((metric) => {
    const read = (season: Record<string, number>): number | null => {
      const metricValue = metric.derived ? metric.derived(season) : season[metric.key];
      return typeof metricValue === "number" && Number.isFinite(metricValue) ? metricValue : null;
    };
    const value = entity ? read(values) : null;
    const peers = analytics.entities.flatMap((candidate) => {
      const peerValue = candidate.position === position ? read(candidate.season) : null;
      return peerValue === null ? [] : [peerValue];
    });
    return { ...metric, value, rank: value === null ? null : rankAgainst(peers, value) };
  });

  return (
    <div className="player-advanced-panel">
      {leading}
      <section aria-labelledby="player-advanced-metrics-heading">
        <div className="section-heading"><h3 id="player-advanced-metrics-heading">Efficiency &amp; usage</h3></div>
        {entity && metrics.length > 0 ? (
          <div className="player-advanced-grid">
            {metrics.map((metric) => (
              <div key={metric.key}>
                <span>{metric.label}</span>
                <b className="player-metric-value">
                  <strong className={metric.rank === null ? undefined : rankToneClassName(metric.rank)}>{metric.value === null ? "—" : metric.unit === "%" ? formatPercent(metric.value) : `${formatDecimal(metric.value, metric.digits ?? 2)}${metric.unit ?? ""}`}</strong>
                  {metric.rank === null ? null : <small>#{metric.rank}</small>}
                </b>
              </div>
            ))}
          </div>
        ) : isLoading ? <LoadingBlock label="Loading advanced metrics…" /> : <EmptyState title="No advanced metrics yet" />}
      </section>
      <PlayerExpectedPoints entity={entity} />
      <PlayerNextGen entity={entity} />
      {children}
    </div>
  );
}

/** The player's NFL team, as a badge that opens the team card. */
function PlayerTeamBadge({ team, onOpen }: { team: string | null; onOpen?: () => void }) {
  if (!team) return null;
  if (!onOpen) return <span className="matchup-reference-tag season-team-pill">{team}</span>;
  return (
    <button
      type="button"
      className="matchup-reference-tag season-team-pill matchup-reference-button"
      aria-label={`View ${team} team data`}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="matchup-reference-button-label">{team}</span>
    </button>
  );
}

function PlayerRosterBadge({
  playerName,
  rosterTeamName,
  rosterLabel,
  onOpenRosterTeam,
  waiversHref,
  onOpenWaivers,
}: {
  playerName: string;
  rosterTeamName: string | null;
  rosterLabel: string | null;
  onOpenRosterTeam?: () => void;
  waiversHref?: string;
  onOpenWaivers?: () => void;
}) {
  if (rosterTeamName && onOpenRosterTeam) {
    return (
      <button
        type="button"
        className="matchup-reference-tag matchup-reference-button player-roster-badge"
        aria-label={rosterLabel ?? `Open ${rosterTeamName} league team`}
        aria-haspopup="dialog"
        onClick={onOpenRosterTeam}
      >
        <span className="matchup-reference-button-label">{rosterTeamName}</span>
      </button>
    );
  }
  if (!waiversHref || !onOpenWaivers) return null;
  return (
    <a
      href={waiversHref}
      className="matchup-reference-tag matchup-reference-button player-roster-badge"
      aria-label={`Open Waivers for ${playerName}`}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenWaivers();
      }}
    >
      <span className="matchup-reference-button-label">Available</span>
    </a>
  );
}

export function PlayerDetailSheet({
  player,
  week,
  leagueId,
  formatKey,
  leagueSize,
  analytics,
  analyticsLoading = false,
  newsItems,
  sosEntry,
  upcomingGames,
  faabBid,
  newsLoading = false,
  newsError = false,
  onRetryNews,
  onOpenTeam,
  onBack,
  canGoBack,
  onClose,
  presentation = "modal",
  rosterTeamName = null,
  rosterLabel = null,
  onOpenRosterTeam,
  waiversHref,
  onOpenWaivers,
  toolLinks,
  suspended = false,
  trending,
  season,
  handcuffTo = null,
}: {
  player: PlayerSearchResult;
  week: number;
  leagueId: string;
  formatKey: string;
  /** Teams in the league; sets how wide an RB1/RB2/RB3 band is. */
  leagueSize?: number;
  /** Starter this running back backs up on the depth chart, when he is a handcuff. */
  handcuffTo?: string | null;
  analytics: Dashboard["analytics"];
  analyticsLoading?: boolean;
  newsItems: PlayerNewsItem[];
  sosEntry?: StrengthOfScheduleEntryLike;
  /** His team's next four games, for the schedule strip. */
  upcomingGames?: readonly UpcomingGame[];
  /** Suggested FAAB bid when he's a top graded waiver add. */
  faabBid?: { low: number; high: number } | null;
  newsLoading?: boolean;
  newsError?: boolean;
  onRetryNews?: () => void;
  /** Open this player's NFL team card. */
  onOpenTeam?: (team: string) => void;
  onBack: () => void;
  canGoBack: boolean;
  onClose: () => void;
  /** Docked column skips portal, backdrop, scroll lock, and inert. */
  presentation?: "modal" | "docked";
  /** League team name when this player is rostered. The badge opens that team card. */
  rosterTeamName?: string | null;
  rosterLabel?: string | null;
  onOpenRosterTeam?: () => void;
  /** Waivers URL for an available player. Keeps the current position filter and player. */
  waiversHref?: string;
  onOpenWaivers?: () => void;
  /** Tools this player can be opened in. Each is a real link; `onOpen` navigates in-app. */
  toolLinks?: ToolLinkItem[];
  /** Pause this dialog while a team card opened from the badge is on top. */
  suspended?: boolean;
  /** Sleeper trending adds/drops for this player (null side = not on that list). */
  trending?: { adds: number | null; drops: number | null };
  /** Season, for this player's prop history. Props are hidden without it. */
  season?: number;
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
  const newsNowMs = useMinuteNow(newsItems.some((item) => item.source === "article"));
  useDialogFocusTrap(sheetRef, onClose, isModal && !suspended);
  useEffect(() => {
    if (isModal || suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModal, onClose, suspended]);

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
  // Which player's news was expanded; another player starts collapsed with no reset step.
  const [newsExpandedFor, setNewsExpandedFor] = useState<string | null>(null);
  const showAllNews = newsExpandedFor === player.playerId;
  const boomBustQuery = useQuery({
    queryKey: ["boom-bust-history", leagueId, player.playerId, boomBustView],
    queryFn: () => {
      if (!boomBustPosition) throw new Error("Unsupported position");
      return api.getBoomBustHistory({ leagueId, playerId: player.playerId, position: boomBustPosition, view: boomBustView });
    },
    enabled: supportsBoomBust && (activeTab === "season" || activeTab === "advanced" || (activeTab === "overview" && player.gamePhase === "final")),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["fantasycalc-value-history", formatKey, [player.playerId]],
    queryFn: () => api.getValueHistory({ formatKey, playerIds: [player.playerId] }),
    enabled: player.position !== "PICK" && player.seasonValue !== null && activeTab === "season",
    staleTime: 30 * 60 * 1000,
  });
  const valueHistory = historyQuery.data?.series.find((series) => series.playerId === player.playerId);

  const positionLabel = player.position === "DEF" ? "DST" : player.position;
  const tierLabel = positionTierLabel(player.position, player.weeklyRank, leagueSize);
  const profileLabel = useProfileTag(leagueId, player.playerId, player.position);
  const projectionComponents = projectionComponentsForPlayer(player);
  const defenseProjectionComponents = player.defenseComponents
    ? Object.entries(defenseComponentLabels).flatMap(([key, label]) => {
        const value = player.defenseComponents?.[key];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ key, label, value, isYards: key === "pr_yd" || key === "kr_yd" || key === "yds_allow" }]
          : [];
      })
    : [];
  const finalGameLog = player.gamePhase === "final"
    ? boomBustQuery.data?.gameLog.find((game) => game.week === week) ?? null
    : null;
  const actualComponents = finalGameLog ? actualComponentsForGame(player.position, finalGameLog.stats) : [];

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
        <div className="player-detail-header">
          <div>
            <div className="player-detail-title-line">
              <h2 id="player-detail-name">{player.name}</h2>
            </div>
            <p><span>{positionLabel}</span><PlayerTeamBadge team={player.team} onOpen={player.team && onOpenTeam ? () => onOpenTeam(player.team ?? "") : undefined} />{tierLabel ? <span className="depth-chart-tag" title="Where this week's rank falls at the position">{tierLabel}</span> : null}<ProfileChips profile={profileLabel} handcuffTo={handcuffTo} />{player.injuryStatus ? <span className="player-detail-injury">{player.injuryStatus}</span> : null}<PlayerRosterBadge
              playerName={player.name}
              rosterTeamName={rosterTeamName}
              rosterLabel={rosterLabel}
              onOpenRosterTeam={onOpenRosterTeam}
              waiversHref={waiversHref}
              onOpenWaivers={onOpenWaivers}
            /></p>
          </div>
          <div className="player-detail-actions">
            {canGoBack ? <button type="button" onClick={navigateBack} aria-label="Previous player"><BackGlyph /></button> : null}
            <button type="button" onClick={onClose} aria-label="Close player details"><CloseGlyph /></button>
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PlayerDetailTab)} className="player-detail-tabs">
          <TabsList aria-label={`${player.name} details`}>
            <TabsTrigger id="player-detail-overview-tab" value="overview" aria-controls="player-detail-overview-panel">Overview</TabsTrigger>
            <TabsTrigger id="player-detail-season-tab" value="season" aria-controls="player-detail-season-panel">Season</TabsTrigger>
            <TabsTrigger id="player-detail-advanced-tab" value="advanced" aria-controls="player-detail-advanced-panel">Advanced</TabsTrigger>
            <TabsTrigger id="player-detail-props-tab" value="props" aria-controls="player-detail-props-panel">Props</TabsTrigger>
          </TabsList>
        </Tabs>
        {activeTab === "overview" ? <div id="player-detail-overview-panel" role="tabpanel" aria-labelledby="player-detail-overview-tab">
        <div className="player-detail-values">
          <div>
            <span>Week {week} {playerPointsLabel(player)}</span>
            <div className="player-detail-value-row">
              <strong>{formatProjectionPoints(player.weeklyProjection, player.projectionSource)}</strong>
              <small>{player.weeklyProjection === null ? "No weekly projection" : player.weeklyRank === null ? "No weekly rank" : <>{positionLabel} <span className={rankToneClassName(player.weeklyRank)}>#{player.weeklyRank}</span></>}</small>
            </div>
            {player.projectionRange ? (
              <RangeBar className="player-detail-range" range={player.projectionRange} value={player.weeklyProjection} domain={rangeDomain([player.projectionRange])} />
            ) : null}
          </div>
          <div>
            <span>Season-long value</span>
            <div className="player-detail-value-row">
              <strong>{player.seasonValue === null ? "—" : formatWhole(player.seasonValue)}</strong>
              {player.seasonValue !== null && player.movement30Day !== null ? <span className={`player-detail-delta ${player.movement30Day < 0 ? "is-down" : player.movement30Day > 0 ? "is-up" : ""}`} title={movementLabel(player.movement30Day)}>{player.movement30Day !== 0 ? <MoveTriangle direction={player.movement30Day < 0 ? "down" : "up"} /> : null}{Number.isFinite(player.movement30Day) ? formatPercent(Math.abs(player.movement30Day)) : "from 0"}</span> : player.seasonValue !== null ? <span className="player-detail-delta">{movementLabel(null)}</span> : null}
              <small>{player.seasonRank === null ? "No season rank" : <>{positionLabel} <span className={rankToneClassName(player.seasonRank)}>#{player.seasonRank}</span></>}</small>
            </div>
          </div>
        </div>
        {upcomingGames?.length ? <ScheduleStrip games={upcomingGames} position={player.position} sosEntry={sosEntry} /> : null}
        {(trending && (trending.adds !== null || trending.drops !== null)) || faabBid ? (
          <div className="player-trending" aria-label="Sleeper adds and drops">
            {trending && (trending.adds !== null || trending.drops !== null) ? (
              <>
                <div><span>Adds</span><strong className="is-up">{trending.adds === null ? "—" : `+${formatCompactCount(trending.adds)}`}</strong></div>
                <div><span>Drops</span><strong className="is-down">{trending.drops === null ? "—" : `−${formatCompactCount(trending.drops)}`}</strong></div>
              </>
            ) : null}
            {faabBid ? <div><span>Bid</span><strong>{faabBidLabel(faabBid)}</strong></div> : null}
          </div>
        ) : null}
        {toolLinks ? <ToolLinks ariaLabel={`Open ${player.name} in a tool`} links={toolLinks} /> : null}
        <section className="player-news-section" aria-label={`${player.name} news`}>
          <div className="section-heading"><h3>Latest news</h3></div>
          {newsError && onRetryNews ? (
            <SectionError title="News didn’t load." onRetry={onRetryNews} compact />
          ) : newsLoading ? (
            <div className="empty-inline compact">Loading news…</div>
          ) : newsItems.length > 0 ? (
            <>
              {newsItems.slice(0, showAllNews ? 8 : 3).map((item) => {
                const isArticle = item.source === "article";
                const outletLabel = item.author && !isArticle
                  ? `${item.sourceLabel} · ${item.author}`
                  : item.sourceLabel;
                const timeLabel = newsItemTimeLabel(item, newsNowMs);
                const header = (
                  <div>
                    <NewsTypeBadges item={item} />
                    <time>{outletLabel} · {timeLabel}</time>
                  </div>
                );
                const body = (
                  <>
                    {header}
                    {isArticle || !isHttpOrHttpsUrl(item.sourceUrl) ? (
                      <span className="player-news-headline"><strong>{item.change}</strong></span>
                    ) : (
                      <a className="player-news-headline" href={item.sourceUrl} target="_blank" rel="noreferrer"><strong>{item.change}</strong><span className="sr-only"> (opens in a new tab)</span></a>
                    )}
                    {item.roleContext ? <p>{item.roleContext}</p> : null}
                  </>
                );
                return isArticle && isHttpOrHttpsUrl(item.sourceUrl) ? (
                  <a className="player-news-item" key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer">
                    {body}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <article className="player-news-item" key={item.id}>{body}</article>
                );
              })}
              {!showAllNews && newsItems.length > 3 ? (
                <button type="button" className="player-news-more" onClick={() => setNewsExpandedFor(player.playerId)}>Show {Math.min(newsItems.length, 8) - 3} more</button>
              ) : null}
            </>
          ) : <div className="empty-inline compact">No recent news for this player.</div>}
        </section>
        {player.gamePhase === "final" && actualComponents.length > 0 ? (
          <section className="dst-breakdown" aria-label={`${player.name} game stats`}>
            <div className="section-heading"><h3>Game stats</h3></div>
            <div className="dst-breakdown-grid">
              {actualComponents.map((component) => (
                <div key={component.key}>
                  <span>{component.label}</span>
                  <strong>{formatWhole(component.value)}</strong>
                </div>
              ))}
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
                  <strong>{component.isYards ? formatWhole(component.value) : formatDecimal(component.value, 2)}</strong>
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
                  <strong>{component.isYards ? formatWhole(component.value) : formatDecimal(component.value, 2)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        </div> : null}
        {activeTab === "season" ? (
          <div id="player-detail-season-panel" role="tabpanel" aria-labelledby="player-detail-season-tab">
            {boomBustQuery.data?.gameLog?.length ? (
              <WeeklyPointsChart
                games={boomBustQuery.data.gameLog}
                nextWeek={week}
                nextProjection={player.gamePhase === "pregame" || player.gamePhase == null ? player.weeklyProjection : null}
                nextOpponent={player.opponent}
              />
            ) : null}
            {boomBustQuery.data?.gameLog?.length ? <SeasonOutcome points={boomBustQuery.data.gameLog.map((game) => game.points)} /> : null}
            {player.position !== "PICK" && player.seasonValue !== null ? (
              <Suspense fallback={<div className="loading-shimmer player-value-trend-loading" aria-hidden="true" />}>
                <LazyPlayerValueTrend name={player.name} history={valueHistory} isLoading={historyQuery.isPending} />
              </Suspense>
            ) : null}
            <SeasonGameLog player={player} history={boomBustQuery.data} analytics={analytics} isLoading={boomBustQuery.isPending} />
          </div>
        ) : null}
        {activeTab === "advanced" ? (
          <div id="player-detail-advanced-panel" role="tabpanel" aria-labelledby="player-detail-advanced-tab">
            <PlayerAdvancedPanel
              player={player}
              analytics={analytics}
              isLoading={analyticsLoading}
              leading={supportsBoomBust ? (
                <BoomBustPanel name={player.name} view={boomBustView} onViewChange={setBoomBustView} history={boomBustQuery.data} isLoading={boomBustQuery.isPending} />
              ) : null}
            >
              <PlayerTeamContext player={player} sosEntry={sosEntry} />
            </PlayerAdvancedPanel>
          </div>
        ) : null}
        {activeTab === "props" ? (
          <div id="player-detail-props-panel" role="tabpanel" aria-labelledby="player-detail-props-tab">
            {season !== undefined && player.gamePhase !== "final" ? <PlayerPropsSection player={player} season={season} week={week} /> : null}
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
  const scoreLabel = (value: number | null): string => formatPoints(value);
  const gameLabel = (score: { season: number; week: number }): string => view === "last3" ? `${score.season} Week ${score.week}` : `Week ${score.week}`;
  const description = weeklyScores.map((score) => `${gameLabel(score)}: ${formatPoints(score.points)}`).join(", ");
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
        <SegmentedControl
          className="boom-bust-toggle"
          value={view}
          onChange={onViewChange}
          label="Boom Bust history range"
          options={[
            { value: "season", label: "2026" },
            { value: "last3", label: "Last 3 years" },
          ]}
        />
      </div>
      {isLoading && !history ? (
        <div className="loading-shimmer boom-bust-loading" aria-hidden="true" />
      ) : weeklyScores.length > 0 && floor !== null && medianScore !== null && meanScore !== null && ceiling !== null ? (
        <div className="boom-bust-visual" role="img" aria-label={`${name} ${rangeLabel}. ${description}. Bust ${scoreLabel(floor)}; median ${scoreLabel(medianScore)}, mean ${scoreLabel(meanScore)}, boom ${scoreLabel(ceiling)}.${quartileDescription}`}>
          <div className="boom-bust-track">
            <div className="boom-bust-band" />
            {showQuartiles ? (
              <div
                className="boom-bust-iqr"
                style={{ left: `${markerPosition(firstQuartile)}%`, width: `${markerPosition(thirdQuartile) - markerPosition(firstQuartile)}%` }}
              />
            ) : null}
            {weeklyScores.map((score, index) => (
              <i
                className={`boom-bust-dot ${index % 2 === 0 ? "above" : "below"}`}
                key={`${score.season}-${score.week}`}
                style={{ left: `${markerPosition(score.points)}%` }}
                title={`${gameLabel(score)}: ${formatPoints(score.points)} points`}
              />
            ))}
            <i className="boom-bust-bust-mark" style={{ left: `${markerPosition(floor)}%` }} title={weeklyScores.length >= 5 ? `Bust (10th percentile): ${formatPoints(floor)} points` : `Bust (minimum): ${formatPoints(floor)} points`} />
            <i className="boom-bust-median-mark" style={{ left: `${markerPosition(medianScore)}%` }} title={`Median: ${formatPoints(medianScore)} points`} />
            <i className="boom-bust-mean-mark" style={{ left: `${markerPosition(meanScore)}%` }} title={`Mean: ${formatPoints(meanScore)} points`} />
          </div>
          <div className="boom-bust-labels">
            <span><small>Bust</small><strong>{scoreLabel(floor)}</strong></span>
            <span><small>Median</small><strong>{scoreLabel(medianScore)}</strong></span>
            <span><small>Mean</small><strong>{scoreLabel(meanScore)}</strong></span>
            <span><small>Boom</small><strong>{scoreLabel(ceiling)}</strong></span>
          </div>
        </div>
      ) : (
        <div className="boom-bust-empty">{isLoading ? "Loading weekly results…" : history?.status === "unavailable" ? "No scoring history yet. Try again after the next data refresh." : view === "last3" ? "No games in the last 3 seasons" : "No games yet this season"}</div>
      )}
    </section>
  );
}

/** Start/sit box under the weekly chart: floor and ceiling at the ends, median ticked. */
function SeasonOutcome({ points }: { points: readonly number[] }) {
  const summary = outcomeSummary(points);
  if (!summary) return null;
  return (
    <div className="season-outcome" role="img" aria-label={`Weekly points this season: floor ${formatDecimal(summary.floor, 1)}, median ${formatDecimal(summary.median, 1)}, ceiling ${formatDecimal(summary.ceiling, 1)}`}>
      <span aria-hidden="true">{formatDecimal(summary.floor, 1)}</span>
      <OutcomeBox summary={summary} domain={{ min: summary.floor, max: Math.max(summary.ceiling, summary.floor + 1) }} />
      <span aria-hidden="true">{formatDecimal(summary.ceiling, 1)}</span>
    </div>
  );
}
