import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "./api";
import { playerWeeklyRank } from "./player-card-state";
import { newsVisibleInContext } from "../../api/_lib/player-news-filters";
import { selectNewsBadges } from "../../api/_lib/player-news-badges";
import { isDynastyNewsContext } from "./player-news-context";
import { newsForTicker, PROMINENT_OVERALL_RANK_LIMIT, tickerItemKind } from "./ticker-news";
import { isHttpOrHttpsUrl } from "../../api/_lib/http-url";
import type {
  Dashboard,
  DashboardSection,
  DraftCenterData,
  LeagueSection,
  MatchupSelection,
  MetaSection,
  PlayerNews,
  PlayerNewsItem,
  PlayerSearchResult,
  PrimaryPage,
  Tab,
  TeamSection,
  PlayersSection,
  AnalyticsSection,
} from "./dashboard-types";
export type { League, MatchupSelection } from "./dashboard-types";
import {
  BROWSER_DASHBOARD_CACHE_KEY,
  canonicalNflTeam,
  DashboardPartialNotes,
  MatchupDataModal,
  NewsCardModal,
  RefreshIcon,
  SectionError,
  groupNewsItemsByPlayer,
  isBoomBustPosition,
  movementPercent,
  shortLeagueName,
  signOutForPersonalData,
} from "./dashboard-shared";
import { formatDecimal } from "./lib/format-number";
import type { ChartDataset, DraftPosition, DraftRoom, RankingHorizon, RankingPosition, TradeMode } from "./dashboard-url";
import { withStreamedAnalytics } from "./dashboard-analytics";
import { isSectionWaiting, sectionBuildFailed, shouldShowProgressiveShell } from "./dashboard-loading";
import { FeatureErrorBoundary } from "./error-boundary";
import { CLEARED_TOOL_SELECTIONS, effectiveTradeMode, serializeDashboardSearch, toolLinkSearch, waiversSearchPreservingContext } from "./dashboard-url";
import { createPlayerResolver, type DashboardPlayerRow, type PlayerLinkResolver } from "./tool-player-link";
import { formatRecord, LeagueTeamCard } from "./league-team-card";
import { leaguePowerTeamForPlayer } from "./league-roster";
import { PlayerDetailSheet, usePlayerCardHistory } from "./player-detail";
import { SkipLink } from "./shared";
import { supabase } from "./supabase";
import { personalQueryKey, snapshotViewer, useViewerIdentity } from "./viewer-scope";
import { useDashboardUrl } from "./use-dashboard-url";
import { CommandBar } from "./shell/command-bar";
import { isTypingTarget, type CommandLeagueItem, type CommandPlayerItem } from "./shell/command-palette";
import { InspectorFrame, useInspectorDockViewport } from "./shell/inspector-frame";
import { ShortcutsDialog } from "./shell/shortcuts-dialog";
import { AskButton } from "./shell/ask-button";
import { askContextForTab } from "./lib/ask-context";
import { handcuffStarter } from "./lib/handcuff";
import { AccountMenu } from "./shell/account-menu";
import { ThemeToggle } from "./shell/theme-toggle";
import { Explorer, isExplorerMode } from "./views/explorer";
import { GameLinesPanel } from "./views/game-lines-panel";
import { Lineup } from "./views/lineup";
import { TeamStatsPanel } from "./views/team-stats-panel";
import { MoveTriangle } from "./components/glyphs";
import { leagueDraftIsFinal } from "./draft-final";

const DOCKABLE_INSPECTOR_TABS = new Set<Tab>(["team", "rankings", "waivers", "draft", "power", "monitor", "team-stats", "analytics"]);

/** The former Monitor page's tools, now subviews under Tools. The
 * "monitor" tab id predates the move and still names Game lines, so
 * existing ?tab=monitor links land in the right place. */
const MARKET_TOOL_TABS = new Set<Tab>(["monitor", "team-stats", "analytics"]);

const LazyLeagueOutcomes = lazy(() => import("./LeagueOutcomes").then((module) => ({ default: module.LeagueOutcomes })));
const LazyPowerRankings = lazy(() => import("./PowerRankings").then((module) => ({ default: module.PowerRankings })));
const LazyConnectedTeamCard = lazy(() => import("./views/player-pool").then((module) => ({ default: module.ConnectedTeamCard })));
const LazyDraftCenter = lazy(() => import("./views/draft-center").then((module) => ({ default: module.DraftCenter })));
const LazyTradeCalculator = lazy(() => import("./views/trade-calculator").then((module) => ({ default: module.TradeCalculator })));
const LazyChartsTool = lazy(() => import("./AnalyticsViews").then((module) => ({ default: module.ChartsTool })));
const LazyAskSheet = lazy(() => import("./views/ask-sheet").then((module) => ({ default: module.AskSheet })));

function SafeAreaTopScrim({ backgroundColor }: { backgroundColor?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height: "env(safe-area-inset-top, 0px)",
        backgroundColor: backgroundColor ?? "transparent",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    />
  );
}

function withSignIn<T>(operation: Promise<T>): Promise<T> {
  return operation.catch((error: unknown) => {
    signOutForPersonalData(error);
    throw error;
  });
}

function NavigationIcon({ page }: { page: PrimaryPage }) {
  const paths: Record<PrimaryPage, ReactNode> = {
    draft: <><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></>,
    team: <><path d="M4 19V8l8-4 8 4v11" /><path d="M8 19v-5h8v5M8 9h.01M12 9h.01M16 9h.01" /></>,
    players: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-4 2.3-6 5.5-6s5 2 5.5 6M16 6.5a2.5 2.5 0 0 1 0 5M16 14c2.7.2 4.2 1.9 4.5 5" /></>,
    league: <><path d="M7 4h10v3c0 3-2 5-5 5S7 10 7 7V4Z" /><path d="M7 6H4v1c0 2 1.4 3.5 3.5 3.8M17 6h3v1c0 2-1.4 3.5-3.5 3.8M12 12v4M8 20h8M9 16h6" /></>,
    tools: <><path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z" /></>,
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[page]}</g>
    </svg>
  );
}

function primaryPageForTab(tab: Tab): PrimaryPage {
  if (tab === "team") return "team";
  if (tab === "rankings" || tab === "waivers" || tab === "comparison") return "players";
  if (tab === "power" || tab === "outcomes" || tab === "trade") return "league";
  if (tab === "draft") return "draft";
  if (tab === "monitor" || tab === "team-stats" || tab === "analytics") return "tools";
  const unreachable: never = tab;
  return unreachable;
}

type TickerItem = {
  key: string;
  source: string;
  /** Rumor uses muted amber so unconfirmed items stay distinct from good/bad. */
  sourceTone?: "neutral" | "rumor";
  label: string;
  quote: string | null;
  move: number | null;
  tone: "up" | "down" | "neutral";
  playerId?: string;
  href?: string;
  newsItem?: PlayerNewsItem;
};

const TICKER_LABEL_LIMIT = 58;

function clipTickerText(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const available = Math.max(1, limit - 1);
  const candidate = clean.slice(0, available);
  const lastSpace = candidate.lastIndexOf(" ");
  const clipped = lastSpace >= Math.floor(available * 0.62) ? candidate.slice(0, lastSpace) : candidate;
  return `${clipped.trimEnd()}…`;
}

function tickerFragment(value: string): string {
  return value
    .replace(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi, (day) => day.slice(0, 3))
    .replace(/\bversus\b/gi, "vs")
    .replace(/\bagainst\b/gi, "vs")
    .replace(/\bquestionable\b/gi, "Q")
    .replace(/\bdoubtful\b/gi, "D")
    .replace(/\bwill not play\b/gi, "OUT")
    .replace(/\bhas been ruled out\b/gi, "OUT")
    .replace(/\bruled out\b/gi, "OUT")
    .replace(/\btouchdowns\b/gi, "TDs")
    .replace(/\btouchdown\b/gi, "TD")
    .replace(/\byards\b/gi, "yds")
    .replace(/\breceptions\b/gi, "rec")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[.!?]+$/g, "")
    .trim();
}

function tickerLabel(subject: string, detail: string): string {
  const compactSubject = clipTickerText(subject.replace(/[.!?]+$/g, "").trim().toUpperCase(), 34);
  const prefix = `${compactSubject}:`;
  const room = Math.max(1, TICKER_LABEL_LIMIT - prefix.length - 1);
  return `${prefix} ${clipTickerText(tickerFragment(detail), room)}`;
}

function tickerNewsLabel(item: PlayerNewsItem): string {
  const scope = item.scope ?? "player";
  const isTeamScoped = scope === "team";
  const isLeagueScoped = scope === "league"
    || item.playerId === "league"
    || /^league headline$/i.test(item.player);
  const subject = isTeamScoped
    ? (item.team && item.team !== "NFL" ? item.team : item.player)
    : isLeagueScoped
      ? (item.team && item.team !== "NFL" ? item.team : "NFL")
      : item.player;
  // Include `subject` so league "NFL: …" does not keep a leading "NFL" in the
  // change text (player/team names still strip as before).
  const escapedNames = [subject, item.player, item.player.split(/\s+/).at(-1), item.team]
    .filter((value): value is string => {
      if (!value) return false;
      return !/^league headline$/i.test(value);
    })
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const uniqueEscaped = [...new Set(escapedNames)];
  const subjectPattern = uniqueEscaped.length > 0
    ? new RegExp(`^(?:${uniqueEscaped.join("|")})\\s*(?::|[-–—])?\\s*`, "i")
    : null;
  const detail = subjectPattern ? item.change.replace(subjectPattern, "") : item.change;
  return tickerLabel(subject, detail.replace(/^(?:is|are|has|have)\s+/i, ""));
}

function TickerStrip({ data, news, rosterPlayerIds, opponentPlayerIds, prominentPlayerIds, isDynastyContext, onPlayer, onNews }: {
  data: DraftCenterData | undefined;
  news: PlayerNews | undefined;
  /** Player ids on the signed-in user's roster in the selected league. */
  rosterPlayerIds: Set<string>;
  /** Player ids on this week's opponent roster in the selected league. */
  opponentPlayerIds: Set<string>;
  /** Season-long top ranks (and similar) used to fill remaining ticker slots. */
  prominentPlayerIds: Set<string>;
  /** Dynasty leagues show dynasty-tagged news; redraft / no league hides them. */
  isDynastyContext: boolean;
  onPlayer: (playerId: string) => void;
  onNews: (item: PlayerNewsItem) => void;
}) {
  const items = useMemo<TickerItem[]>(() => {
    const headlineItems: TickerItem[] = newsForTicker(
      news,
      rosterPlayerIds,
      opponentPlayerIds,
      prominentPlayerIds,
      { isDynastyContext },
    ).map((item) => {
      const isArticle = item.source === "article" && isHttpOrHttpsUrl(item.sourceUrl);
      const badges = selectNewsBadges(item);
      const sourceParts = [badges.primary.label, ...badges.secondary.map((badge) => badge.label)];
      return {
        key: `news:${item.id}`,
        source: sourceParts.join(" · "),
        // Primary is never muted (cryptic is secondary-only); keep ticker amber for rumor.
        sourceTone: badges.primary.tone === "rumor" ? "rumor" : "neutral",
        label: tickerNewsLabel(item),
        quote: null,
        move: null,
        tone: "neutral" as const,
        ...(isArticle
          ? { href: item.sourceUrl }
          : { newsItem: item }),
      };
    });

    if (headlineItems.length > 0) return headlineItems;

    // No player news: keep the existing ADP edge fallback (never Sleeper adds/drops).
    // ADP rows repeat per league format, so each player appears once (largest edge wins).
    const seenAdpPlayers = new Set<string>();
    return (data?.adp ?? [])
      .filter((row) => row.pool === "all" && row.mflAdp !== null)
      .map((row) => ({ row, edge: (row.mflAdp ?? row.adp) - row.adp }))
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
      .filter(({ row }) => {
        const playerKey = row.playerId ?? row.name;
        if (seenAdpPlayers.has(playerKey)) return false;
        seenAdpPlayers.add(playerKey);
        return true;
      })
      .slice(0, 7)
      .map(({ row, edge }) => ({
        key: `adp:${row.format}:${row.playerId ?? row.name}`,
        source: "ADP",
        // The edge is drawn once, by the move arrow; the label names both ADPs.
        label: tickerLabel(row.name, `ADP ${formatDecimal(row.adp, 1)} · MFL ${formatDecimal(row.mflAdp ?? row.adp, 1)}`),
        quote: null,
        move: edge,
        tone: Math.abs(edge) < 0.05 ? "neutral" : edge > 0 ? "up" : "down",
        ...(row.playerId ? { playerId: row.playerId } : {}),
      }));
  }, [data, isDynastyContext, news, opponentPlayerIds, prominentPlayerIds, rosterPlayerIds]);

  const visibleItems = items.length > 0 ? items : [{ key: "waiting", source: "NFL", label: "Awaiting the next update", quote: null, move: null, tone: "neutral" as const }];
  const repeatedItems = visibleItems.length > 1 ? [...visibleItems, ...visibleItems] : visibleItems;
  const isStatic = visibleItems.length === 1;

  const content = (item: TickerItem) => (
    <>
      <span className={`ticker-source${item.sourceTone === "rumor" ? " is-rumor" : ""}`}>{item.source}</span>
      <span className="ticker-label">{item.label}</span>
      {item.quote ? <strong>{item.quote}</strong> : null}
      {item.move !== null && Math.abs(item.move) >= 0.05 ? <span className={`ticker-move ${item.tone}`}><MoveTriangle direction={item.move > 0 ? "up" : "down"} />{formatDecimal(Math.abs(item.move), 2)}</span> : null}
    </>
  );

  return (
    <section className="ticker-strip" aria-label="Live fantasy and NFL ticker">
      <div className="ticker-viewport">
        <div className={`ticker-track${isStatic ? " is-static" : ""}`}>
          {repeatedItems.map((item, index) => {
            const isCopy = index >= visibleItems.length;
            const kind = tickerItemKind(item);
            const className = `ticker-item${isCopy ? " ticker-copy" : ""}`;
            const key = `${item.key}:${index}`;
            // Items render their full visible text, so the accessible name always
            // matches the label; extra hints go on aria-description instead.
            return kind === "news" ? (
              <button
                type="button"
                className={className}
                key={key}
                onClick={() => item.newsItem ? onNews(item.newsItem) : undefined}
                aria-hidden={isCopy || undefined}
                tabIndex={isCopy ? -1 : undefined}
              >{content(item)}</button>
            ) : kind === "link" ? (
              <a href={item.href} target="_blank" rel="noreferrer" className={className} key={key} aria-description={isCopy ? undefined : "Opens in a new tab"} aria-hidden={isCopy || undefined} tabIndex={isCopy ? -1 : undefined}>{content(item)}</a>
            ) : kind === "player" ? (
              <button
                type="button"
                className={className}
                key={key}
                onClick={() => item.playerId ? onPlayer(item.playerId) : undefined}
                aria-hidden={isCopy || undefined}
                tabIndex={isCopy ? -1 : undefined}
              >{content(item)}</button>
            ) : (
              <span className={className} key={key} aria-hidden={isCopy || undefined}>{content(item)}</span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const BROWSER_DASHBOARD_MAX_AGE_MS = 2 * 60 * 1000;
// Stay under the 60s Hobby function cap. The server build deadline is 55s.
const DASHBOARD_DEADLINE_MS = 58_000;
// While a section answers `data: null` (signed-in user's first dashboard is
// still building in the background), poll until the build lands.
const SECTION_BUILD_POLL_MS = 4_000;
const LIVE_LINEUP_REFETCH_MS = 150_000;
function pollWhileSectionBuilding(query: { state: { data?: unknown } }): number | false {
  const data = query.state.data as { data?: unknown; build?: { status?: string } } | undefined;
  if (data === undefined || data.data != null) return false;
  // A failed background build stops the poll — the view shows its error state
  // and retry kicks a new build instead of waiting forever.
  return data.build?.status === "failed" ? false : SECTION_BUILD_POLL_MS;
}

function teamSectionHasLiveGame(data: unknown): boolean {
  if (!data || typeof data !== "object" || !("data" in data)) return false;
  const payload = (data as { data?: { leagues?: Array<{
    starters?: Array<{ gamePhase?: string | null }>;
    bench?: Array<{ gamePhase?: string | null }>;
    opponentTeam?: {
      starters?: Array<{ gamePhase?: string | null }>;
      bench?: Array<{ gamePhase?: string | null }>;
    } | null;
  }> } | null }).data;
  const leagues = payload?.leagues;
  if (!leagues) return false;
  return leagues.some((league) => {
    const pools = [
      league.starters ?? [],
      league.bench ?? [],
      league.opponentTeam?.starters ?? [],
      league.opponentTeam?.bench ?? [],
    ];
    return pools.some((players) => players.some((player) => player.gamePhase === "live"));
  });
}

function pollBootstrapSections(query: { state: { data?: { sections?: Record<string, unknown> } } }): number | false {
  const sections = query.state.data?.sections;
  for (const section of BOOTSTRAP_SECTION_NAMES) {
    const poll = pollWhileSectionBuilding({ state: { data: sections?.[section] } });
    if (poll) return poll;
  }
  return teamSectionHasLiveGame(sections?.team) ? LIVE_LINEUP_REFETCH_MS : false;
}

const BOOTSTRAP_SECTION_NAMES = ["meta", "team", "players", "league"] as const;

function dashboardTimestamp(dashboard: Dashboard | undefined): number {
  if (!dashboard) return 0;
  const timestamp = new Date(dashboard.asOf).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dropUnsignedBrowserDashboard(): void {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BROWSER_DASHBOARD_CACHE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || !("userId" in parsed) || parsed.userId != null) return;
    localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
  } catch {
    // A corrupt cache is ignored. A later signed-in save replaces it.
  }
}

function readBrowserDashboard(userId: string | null, accountId: string | null): Dashboard | undefined {
  if (!userId) {
    dropUnsignedBrowserDashboard();
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BROWSER_DASHBOARD_CACHE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || !("dashboard" in parsed) || !("userId" in parsed)) return undefined;
    // Keyed by user and connected Sleeper account: switching accounts on the
    // same login must not show the previous account's leagues.
    if (parsed.userId !== userId || !("accountId" in parsed) || parsed.accountId !== accountId) return undefined;
    const dashboard = parsed.dashboard;
    if (!dashboard || typeof dashboard !== "object" || !("leagues" in dashboard) || !Array.isArray(dashboard.leagues) || !("asOf" in dashboard) || typeof dashboard.asOf !== "string") return undefined;
    if (!dashboard.leagues.every((league) => league && typeof league === "object" && "tradeValuation" in league)) {
      localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
      return undefined;
    }
    const stored = dashboard as Dashboard;
    const age = Date.now() - dashboardTimestamp(stored);
    if (age < 0 || age > BROWSER_DASHBOARD_MAX_AGE_MS) {
      localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
      return undefined;
    }
    return stored;
  } catch {
    return undefined;
  }
}

function saveBrowserDashboard(userId: string | null, accountId: string | null, dashboard: Dashboard): void {
  if (!userId) return;
  try {
    localStorage.setItem(BROWSER_DASHBOARD_CACHE_KEY, JSON.stringify({ userId, accountId, dashboard }));
  } catch {
    // A full storage bucket must never block rendering fresh data.
  }
}

async function currentViewerId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function freshestDashboard(...candidates: Array<Dashboard | undefined>): Dashboard | undefined {
  return candidates.reduce<Dashboard | undefined>((freshest, candidate) => {
    if (!candidate) return freshest;
    return !freshest || dashboardTimestamp(candidate) > dashboardTimestamp(freshest) ? candidate : freshest;
  }, undefined);
}

type TradeSection = Extract<DashboardSection, { section: "trade" }>;
type TradeWaiverSection = Extract<DashboardSection, { section: "trade-waiver" }>;

function assembleStreamedDashboard(
  meta: MetaSection["data"],
  team: TeamSection["data"],
  players: PlayersSection["data"],
  power: LeagueSection["data"],
  analytics: AnalyticsSection["data"],
  trade: TradeSection["data"],
  tradeWaiver: TradeWaiverSection["data"],
): Dashboard | undefined {
  if (!meta) return undefined;
  const teamByLeague = new Map((team?.leagues ?? []).map((league) => [league.id, league]));
  const powerByLeague = new Map((power?.leagues ?? []).map((league) => [league.id, league]));
  const tradeByLeague = new Map((trade?.leagues ?? []).map((league) => [league.id, league]));
  const waiverByLeague = new Map((tradeWaiver?.leagues ?? []).map((league) => [league.id, league]));
  const leagues: Dashboard["leagues"] = meta.leagues.map((identity) => {
    const teamData = teamByLeague.get(identity.id);
    const powerData = powerByLeague.get(identity.id);
    const tradeData = tradeByLeague.get(identity.id);
    const waiverData = waiverByLeague.get(identity.id);
    return {
      ...identity,
      record: teamData?.record ?? { wins: 0, losses: 0, ties: 0 },
      teamActual: teamData?.teamActual ?? null,
      teamProjection: teamData?.teamProjection ?? null,
      starters: teamData?.starters ?? [],
      bench: teamData?.bench ?? [],
      opponentTeam: teamData?.opponentTeam ?? null,
      suggestion: teamData?.suggestion ?? null,
      // Prefer dedicated trade / trade-waiver sections; fall back to team (legacy).
      tradeTeams: tradeData?.tradeTeams ?? teamData?.tradeTeams ?? [],
      tradeWaiverPool: waiverData?.tradeWaiverPool
        ?? tradeData?.tradeWaiverPool
        ?? teamData?.tradeWaiverPool
        ?? [],
      tradeStarterSlots: tradeData?.tradeStarterSlots ?? teamData?.tradeStarterSlots ?? [],
      powerRankingsWeek: powerData?.powerRankingsWeek ?? [],
      powerRankingsSeasonLong: powerData?.powerRankingsSeasonLong ?? [],
      powerRankingsDynasty: powerData?.powerRankingsDynasty ?? [],
      standings: powerData?.standings ?? [],
      playoffs: powerData?.playoffs ?? { teams: null, weekStart: null },
      waivers: identity.waivers ?? null,
    };
  });
  return {
    ...meta,
    leagues,
    rankings: players?.rankings ?? [],
    weeklyChartRankings: players?.weeklyChartRankings ?? [],
    seasonLongRankings: players?.seasonLongRankings ?? [],
    defenses: players?.defenses ?? [],
    playerTrending: players?.playerTrending ?? {},
    playerInsights: players?.playerInsights ?? { depth: {}, depthAsOf: null, depthPrevious: {} },
    strengthOfSchedule: players?.strengthOfSchedule ?? [],
    gameLines: players?.gameLines ?? [],
    analytics: analytics?.analytics ?? { asOf: null, throughWeek: null, sourceUrl: "", entities: [], teamUsage: [], teamRecords: [] },
  };
}

function pollTradeSectionWhileLive(
  query: { state: { data?: unknown } },
  teamSectionData: unknown,
): number | false {
  const building = pollWhileSectionBuilding(query);
  if (building) return building;
  // LeagueTeamCard live projections/gamePhase come from tradeTeams — keep them
  // on the same 150s cadence as the team section while any game is live.
  return teamSectionHasLiveGame(teamSectionData) ? LIVE_LINEUP_REFETCH_MS : false;
}

async function withClientDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Section request timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function SectionLoading({ label }: { label: string }) {
  return (
    <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span>{label}</span>
      <div className="loading-shimmer loading-score" aria-hidden="true" />
      <div className="loading-shimmer loading-line wide" aria-hidden="true" />
      <div className="loading-shimmer loading-line" aria-hidden="true" />
      <div className="loading-shimmer loading-line" aria-hidden="true" />
    </section>
  );
}

function ProgressiveShell({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const primaryPage = primaryPageForTab(tab);
  const pageTabs: Array<[PrimaryPage, string, Tab]> = [
    ["team", "Matchup", "team"],
    ["players", "Players", "rankings"],
    ["league", "League", "power"],
    ["draft", "Draft", "draft"],
    ["tools", "Tools", "monitor"],
  ];
  return (
    <div className="app-shell progressive-shell">
      <SkipLink />
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div role="region" aria-label="League and week" className="league-sticky progressive-sticky">
        <div className="week-line"><div><span className="live-dot" /> Loading latest saved week</div><button className="refresh-button" disabled aria-label="Fantasy data is loading"><RefreshIcon spinning /></button></div>
        <label className="league-picker"><span className="sr-only">League list is loading</span><select disabled><option>Loading leagues…</option></select></label>
      </div>
      <header className="control-deck">
        <nav className="primary-tabs" aria-label="Fantasy sections">
          {pageTabs.map(([page, label, nextTab]) => <button key={page} className={primaryPage === page ? "active" : ""} onClick={() => onTab(nextTab)} aria-current={primaryPage === page ? "page" : undefined}><NavigationIcon page={page} /><span>{label}</span></button>)}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}><h1 className="sr-only">Fantasy {pageTabs.find(([page]) => page === primaryPage)?.[1] ?? "dashboard"}</h1><SectionLoading label={`Loading ${primaryPage}…`} /></main>
    </div>
  );
}

/** A trade partner roster id from the URL; anything that is not a whole number is ignored. */
function parsePartnerRosterId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export function App() {
  const queryClient = useQueryClient();
  // Per-viewer scope for every personal query key: AuthGate only renders the
  // app once a session and Sleeper connection are verified, and clears these
  // caches on sign-out, so no other viewer can read this data back.
  const viewer = useViewerIdentity();
  // Latest identity for async work that outlives the render that started it.
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const readViewer = useCallback(async () => ({ sessionUserId: await currentViewerId(), identity: viewerRef.current }), []);
  const dashboardUrl = useDashboardUrl();
  const tab = dashboardUrl.state.tab;
  const setTab = useCallback((next: Tab) => {
    dashboardUrl.commit({ tab: next, playerId: null, ...CLEARED_TOOL_SELECTIONS });
  }, [dashboardUrl.commit]);
  const openCommandPage = useCallback((next: Tab, options?: { tradeMode?: TradeMode }) => {
    if (next === "trade") {
      dashboardUrl.commit({
        tab: "trade",
        playerId: null,
        tradeMode: options?.tradeMode && options.tradeMode !== "league" ? options.tradeMode : null,
        ...CLEARED_TOOL_SELECTIONS,
      });
      return;
    }
    dashboardUrl.commit({ tab: next, playerId: null, ...CLEARED_TOOL_SELECTIONS });
  }, [dashboardUrl.commit]);
  const inspectorDockViewport = useInspectorDockViewport();
  useEffect(() => {
    const titles: Record<Tab, string> = {
      team: "Matchup",
      rankings: "Players",
      waivers: "Players",
      power: "League",
      outcomes: "Projected standings",
      draft: "Draft",
      trade: "Trade",
      comparison: "Players",
      monitor: "Game lines",
      "team-stats": "Team stats",
      analytics: "Analytics",
    };
    document.title = `${titles[tab]} · Fantasy Rankings`;
  }, [tab]);
  const playerHistory = usePlayerCardHistory();
  const [tickerNews, setTickerNews] = useState<PlayerNewsItem | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const askButtonRef = useRef<HTMLButtonElement | null>(null);
  // The sheet is mounted only while open, so Radix has no trigger to hand focus back to.
  const changeAskOpen = useCallback((open: boolean) => {
    setAskOpen(open);
    if (!open) requestAnimationFrame(() => askButtonRef.current?.focus());
  }, []);
  // The matchup dialog lives in the URL (`mu`), so opening it is a history step and Back from a tool brings it back.
  const selectedMatchup = dashboardUrl.state.matchup;
  const { commit: commitDashboardUrl, closeMatchup } = dashboardUrl;
  const setSelectedMatchup = useCallback((matchup: MatchupSelection | null) => {
    if (matchup) commitDashboardUrl({ matchup });
    else closeMatchup();
  }, [commitDashboardUrl, closeMatchup]);
  const [teamCardTeam, setTeamCardTeam] = useState<string | null>(null);
  // From a team card, open the team's game. If that game's card is already open behind this one, just go back to it.
  const openMatchupFromTeamCard = useCallback((matchup: MatchupSelection) => {
    setTeamCardTeam(null);
    const pair = (m: MatchupSelection) => [m.team, m.opponent].map((name) => canonicalNflTeam(name) ?? name).sort().join("|");
    if (selectedMatchup && pair(selectedMatchup) === pair(matchup)) return;
    setSelectedMatchup(matchup);
  }, [selectedMatchup, setSelectedMatchup]);
  const [rosterCardRosterId, setRosterCardRosterId] = useState<number | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [failedResyncAsOf, setFailedResyncAsOf] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState(() => dashboardUrl.state.league ?? localStorage.getItem("fantasy-rankings-league") ?? "");
  const [browserViewerId, setBrowserViewerId] = useState<string | null | undefined>(undefined);
  // Tagged with the Sleeper account it was read for: after an account switch
  // the stale entry is ignored in the very render the switch lands in, before
  // the effect below re-reads storage, so it can't seed the new account's query.
  const [browserDashboardEntry, setBrowserDashboard] = useState<{ accountId: string | null; dashboard: Dashboard | undefined }>(
    { accountId: null, dashboard: undefined },
  );
  const browserDashboard = browserDashboardEntry.accountId === viewer.accountId ? browserDashboardEntry.dashboard : undefined;
  useEffect(() => {
    let cancelled = false;
    void currentViewerId().then((userId) => {
      if (cancelled) return;
      setBrowserViewerId(userId);
      setBrowserDashboard({ accountId: viewer.accountId, dashboard: readBrowserDashboard(userId, viewer.accountId) });
    });
    return () => {
      cancelled = true;
    };
  }, [viewer.accountId]);
  // Sections whose next fetch should restart a failed background build. Polls
  // never set this, so a failure stays visible until the user hits Retry.
  const retryBuildSections = useRef(new Set<DashboardSection["section"]>());
  const loadDashboardSection = (section: DashboardSection["section"], deadlineMs: number) => {
    const retryBuild = retryBuildSections.current.delete(section) || undefined;
    // Pin lazy section loads to the bootstrap snapshot version when known so
    // every view comes from the same dashboard snapshot.
    const v = bootstrapQuery.data?.snapshotVersion ?? undefined;
    return withSignIn(withClientDeadline(api.getDashboardSection({ section, retryBuild, v }), deadlineMs));
  };
  const retrySection = (query: { data?: unknown; refetch: () => Promise<unknown> }, section: DashboardSection["section"]) => {
    if (sectionBuildFailed(query.data)) retryBuildSections.current.add(section);
    void query.refetch();
  };
  // Bootstrap: the four always-needed sections in ONE request (was four
  // parallel /section calls). trade / trade-waiver / analytics stay lazy
  // single-section loads below.
  const BOOTSTRAP_SECTIONS = BOOTSTRAP_SECTION_NAMES;
  const bootstrapQuery = useQuery({
    queryKey: personalQueryKey(viewer, "dashboard-section", "bootstrap"),
    queryFn: () => {
      const retryBuild = BOOTSTRAP_SECTIONS.some((s) => retryBuildSections.current.delete(s)) || undefined;
      return withSignIn(withClientDeadline(
        api.getDashboardSections({ sections: [...BOOTSTRAP_SECTIONS], retryBuild }),
        20_000,
      ));
    },
    staleTime: (query) => (query.state.status === "error" ? 0 : 90_000),
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: 2,
    retryDelay: (attempt) => 1_000 * (attempt + 1),
    refetchInterval: pollBootstrapSections,
  });
  // Per-section facades over the batched response keep the rest of the app
  // reading `xxxQuery.data` exactly as before; a facade refetch re-runs the
  // whole bootstrap call, which is still one request.
  const sectionQueryFacade = (section: DashboardSection["section"]) => ({
    data: bootstrapQuery.data?.sections?.[section],
    isError: bootstrapQuery.isError,
    isPending: bootstrapQuery.isPending,
    isFetching: bootstrapQuery.isFetching,
    isSuccess: bootstrapQuery.isSuccess,
    refetch: bootstrapQuery.refetch,
  });
  const metaQuery = sectionQueryFacade("meta");
  const teamQuery = sectionQueryFacade("team");
  const playersQuery = sectionQueryFacade("players");
  const leagueQuery = sectionQueryFacade("league");
  // Matchup player cards need fantasy SOS for Team context ranks.
  // The Tools market views reuse the same players + analytics section queries as the chart builder (no per-panel fetches).
  const analyticsQuery = useQuery({
    queryKey: personalQueryKey(viewer, "dashboard-section", "analytics"),
    queryFn: () => loadDashboardSection("analytics", 8_000),
    staleTime: 90_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: MARKET_TOOL_TABS.has(tab) || tab === "rankings" || tab === "waivers" || tab === "comparison" || playerHistory.isOpen,
    refetchInterval: pollWhileSectionBuilding,
  });
  // tradeTeams (+ starter slots) for Matchup/Power/Trade. Live-polled with
  // the team section so LeagueTeamCard projections/gamePhase stay fresh.
  // The Tools market views need trade when the player inspector opens a league roster card.
  const tradeSectionActive = tab === "team" || MARKET_TOOL_TABS.has(tab) || tab === "power" || tab === "outcomes" || tab === "trade" || tab === "rankings" || tab === "waivers";
  const tradeMode = effectiveTradeMode(dashboardUrl.state);
  // Waiver pool is only consumed by League-adjusted trade (not Market/History).
  const tradeWaiverActive = tab === "trade" && tradeMode === "league";
  const tradeQuery = useQuery({
    queryKey: personalQueryKey(viewer, "dashboard-section", "trade"),
    queryFn: () => loadDashboardSection("trade", 20_000),
    // Errors must not stick for the session: stale immediately so tab switch /
    // remount / manual refresh retries instead of serving a failed empty cache.
    staleTime: (query) => (query.state.status === "error" ? 0 : 90_000),
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: 2,
    retryDelay: (attempt) => 1_000 * (attempt + 1),
    enabled: tradeSectionActive,
    refetchInterval: (query) => pollTradeSectionWhileLive(query, teamQuery.data),
  });
  const tradeWaiverQuery = useQuery({
    queryKey: personalQueryKey(viewer, "dashboard-section", "trade-waiver"),
    queryFn: () => loadDashboardSection("trade-waiver", 20_000),
    staleTime: (query) => (query.state.status === "error" ? 0 : 90_000),
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: 2,
    retryDelay: (attempt) => 1_000 * (attempt + 1),
    enabled: tradeWaiverActive,
    refetchInterval: pollWhileSectionBuilding,
  });
  const dashboardQuery = useQuery({
    queryKey: personalQueryKey(viewer, "fantasy-dashboard"),
    queryFn: () => withSignIn(withClientDeadline(api.getDashboard({ force: false }), DASHBOARD_DEADLINE_MS)),
    staleTime: 90_000,
    initialData: browserDashboard,
    initialDataUpdatedAt: 0,
    retry: false,
    enabled: false,
  });
  const refresh = useMutation({
    // Whoever started the refresh owns its result; see snapshotViewer.
    onMutate: () => snapshotViewer(readViewer),
    mutationFn: async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("Sign in required.");
      }
      return withClientDeadline(api.refreshDashboard(), DASHBOARD_DEADLINE_MS);
    },
    onSuccess: async (data, _variables, owner) => {
      if (!owner || !(await owner.stillCurrent())) return;
      const { sessionUserId, identity } = owner.startedBy;
      // A fell-back resync still returns the previous dashboard; flag its
      // asOf so the header can say the refresh failed. The note clears on
      // its own once a dashboard with a newer asOf lands by any path.
      setFailedResyncAsOf(data.resyncFailed ? data.dashboard.asOf : null);
      saveBrowserDashboard(sessionUserId, identity.accountId, data.dashboard);
      queryClient.setQueryData(personalQueryKey(identity, "fantasy-dashboard"), data.dashboard);
      queryClient.invalidateQueries({ queryKey: personalQueryKey(identity, "dashboard-section") });
      queryClient.invalidateQueries({ queryKey: personalQueryKey(identity, "projected-standings") });
    },
    onError: async (error: unknown, _variables, owner) => {
      // A stale 401 from the previous viewer's token must not sign out the new one.
      if (owner && !(await owner.stillCurrent())) return;
      signOutForPersonalData(error);
    },
  });
  const draftQuery = useQuery({
    queryKey: personalQueryKey(viewer, "draft-center"),
    queryFn: async () => {
      try {
        return await withClientDeadline(api.getDraftCenter({ force: false }), 24_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: 15_000,
    refetchInterval: tab === "draft" ? 15_000 : false,
    retry: false,
  });
  const draftRefresh = useMutation({
    onMutate: () => snapshotViewer(readViewer),
    mutationFn: () => withClientDeadline(api.getDraftCenter({ force: true }), 24_000),
    onSuccess: async (data, _variables, owner) => {
      if (!owner || !(await owner.stillCurrent())) return;
      queryClient.setQueryData(personalQueryKey(owner.startedBy.identity, "draft-center"), data);
    },
    onError: async (error: unknown, _variables, owner) => {
      if (owner && !(await owner.stillCurrent())) return;
      signOutForPersonalData(error);
    },
  });
  // Prefer browser/full dashboard until tradeTeams land so returning users do not
  // flash empty "No roster available" / "My Team" states over localStorage data.
  const streamedDashboard = useMemo(() => {
    if (tradeSectionActive && !tradeQuery.isError) {
      const tradeReady = tradeQuery.data?.section === "trade" && tradeQuery.data.data != null;
      if (!tradeReady && (tradeQuery.isPending || tradeQuery.data === undefined || tradeQuery.isFetching)) {
        return undefined;
      }
    }
    if (tradeWaiverActive && !tradeWaiverQuery.isError) {
      const waiverReady = tradeWaiverQuery.data?.section === "trade-waiver" && tradeWaiverQuery.data.data != null;
      if (!waiverReady && (tradeWaiverQuery.isPending || tradeWaiverQuery.data === undefined || tradeWaiverQuery.isFetching)) {
        return undefined;
      }
    }
    return assembleStreamedDashboard(
      metaQuery.data?.section === "meta" ? metaQuery.data.data : null,
      teamQuery.data?.section === "team" ? teamQuery.data.data : null,
      playersQuery.data?.section === "players" ? playersQuery.data.data : null,
      leagueQuery.data?.section === "league" ? leagueQuery.data.data : null,
      analyticsQuery.data?.section === "analytics" ? analyticsQuery.data.data : null,
      tradeQuery.data?.section === "trade" ? tradeQuery.data.data : null,
      tradeWaiverQuery.data?.section === "trade-waiver" ? tradeWaiverQuery.data.data : null,
    );
  }, [
    analyticsQuery.data,
    leagueQuery.data,
    metaQuery.data,
    playersQuery.data,
    teamQuery.data,
    tradeQuery.data,
    tradeQuery.isError,
    tradeQuery.isFetching,
    tradeQuery.isPending,
    tradeSectionActive,
    tradeWaiverActive,
    tradeWaiverQuery.data,
    tradeWaiverQuery.isError,
    tradeWaiverQuery.isFetching,
    tradeWaiverQuery.isPending,
  ]);
  // Every section is projected from the same saved dashboard snapshot; no
  // render-time source refresh occurs. The one merge: a cache/refresh
  // dashboard whose analytics section is empty for this snapshot must not
  // shadow the streamed analytics section (see dashboard-analytics.ts).
  const dashboard = withStreamedAnalytics(freshestDashboard(dashboardQuery.data, streamedDashboard, browserDashboard), streamedDashboard);

  const league = dashboard?.leagues.find((item) => item.id === selectedLeagueId) ?? dashboard?.leagues[0];
  // Same effective league as the rendered dashboard (cached + streamed meta).
  // No league yet → redraft (exclude dynasty-tagged rows) per product default.
  const leagueIsDynasty = isDynastyNewsContext(dashboard?.leagues, selectedLeagueId);
  const newsQuery = useQuery({
    queryKey: personalQueryKey(viewer, "player-news", leagueIsDynasty ? "dynasty" : "redraft"),
    queryFn: async () => {
      try {
        return await withClientDeadline(api.getPlayerNews({ dynasty: leagueIsDynasty }), 8_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const leagueScopedNews = useMemo((): PlayerNews | undefined => {
    if (!newsQuery.data) return undefined;
    return {
      ...newsQuery.data,
      runs: newsQuery.data.runs.map((run) => ({
        ...run,
        items: run.items.filter((item) => newsVisibleInContext(item, leagueIsDynasty)),
      })),
    };
  }, [leagueIsDynasty, newsQuery.data]);
  const newsItemsByPlayer = useMemo(() => groupNewsItemsByPlayer(leagueScopedNews), [leagueScopedNews]);
  const tickerPlayerNews = playerHistory.current ? newsItemsByPlayer.get(playerHistory.current.playerId) ?? [] : [];
  const selectedLeagueRosterIds = useMemo(
    () => new Set([...(league?.starters ?? []), ...(league?.bench ?? [])].map((p) => p.playerId)),
    [league],
  );
  const selectedLeagueOpponentIds = useMemo(
    () => new Set([
      ...(league?.opponentTeam?.starters ?? []),
      ...(league?.opponentTeam?.bench ?? []),
    ].map((p) => p.playerId)),
    [league],
  );
  const selectedLeagueProminentIds = useMemo(() => {
    const formatKey = league?.seasonLongFormat.key;
    if (!formatKey || !dashboard) return new Set<string>();
    return new Set(
      dashboard.seasonLongRankings
        .filter((row) => (
          row.formatKey === formatKey
          && row.position !== "PICK"
          && row.overallRank <= PROMINENT_OVERALL_RANK_LIMIT
        ))
        .map((row) => row.playerId),
    );
  }, [dashboard, league]);
  useEffect(() => {
    setRosterCardRosterId(null);
  }, [league?.id]);
  const leagueDashboard = useMemo<Dashboard | undefined>(() => {
    if (!dashboard || !league) return dashboard;
    return {
      ...dashboard,
      rankings: dashboard.rankings.filter((row) => row.leagueId === league.id),
      weeklyChartRankings: dashboard.weeklyChartRankings.filter((row) => row.leagueId === league.id),
      defenses: dashboard.defenses.filter((row) => row.leagueId === league.id),
      strengthOfSchedule: dashboard.strengthOfSchedule.filter((row) => row.leagueId === league.id),
    };
  }, [dashboard, league]);

  // Don't persist a dashboard while a section this tab depends on is still
  // building (a completed response with a null payload): caching it would
  // freeze empty tradeTeams/league data for later visits. Errors release the
  // gate so the retry paths can run.
  const leagueCacheBlocked = (tab === "rankings" || tab === "waivers")
    && !dashboardQuery.data
    && !browserDashboard
    && !leagueQuery.isError
    && !(leagueQuery.data?.section === "league" && leagueQuery.data.data != null);
  const tradeCacheBlocked = tradeSectionActive
    && !tradeQuery.isError
    && !(tradeQuery.data?.section === "trade" && tradeQuery.data.data != null);
  useEffect(() => {
    if (!dashboard || !browserViewerId) return;
    if (leagueCacheBlocked || tradeCacheBlocked) return;
    saveBrowserDashboard(browserViewerId, viewer.accountId, dashboard);
    if (document.documentElement.dataset.fantasyFirstContentMs) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const elapsed = Math.round(performance.now());
      document.documentElement.dataset.fantasyFirstContentMs = String(elapsed);
      performance.mark("fantasy-first-content");
    }));
  }, [dashboard, browserViewerId, leagueCacheBlocked, tradeCacheBlocked]);

  useEffect(() => {
    if (!dashboard?.leagues.length) return;
    const requested = dashboardUrl.state.league;
    const requestedIsValid = Boolean(requested && dashboard.leagues.some((item) => item.id === requested));
    const stored = localStorage.getItem("fantasy-rankings-league") ?? "";
    const storedIsValid = dashboard.leagues.some((item) => item.id === stored);
    const resolved = (requestedIsValid ? requested : storedIsValid ? stored : dashboard.leagues[0]?.id) ?? "";
    if (!resolved) return;
    if (resolved !== selectedLeagueId) setSelectedLeagueId(resolved);
    if (requested !== resolved) dashboardUrl.commit({ league: resolved });
    if (localStorage.getItem("fantasy-rankings-league") !== resolved) localStorage.setItem("fantasy-rankings-league", resolved);
  }, [dashboard, dashboardUrl.commit, dashboardUrl.state.league, selectedLeagueId]);

  function chooseLeague(id: string) {
    setSelectedLeagueId(id);
    localStorage.setItem("fantasy-rankings-league", id);
    dashboardUrl.commit({ league: id, playerId: null, ...CLEARED_TOOL_SELECTIONS });
  }

  const openLinkedPlayer = useCallback((playerId: string) => {
    dashboardUrl.commit({ playerId });
  }, [dashboardUrl.commit]);
  const closeLinkedPlayer = useCallback(() => {
    dashboardUrl.closePlayer();
  }, [dashboardUrl.closePlayer]);
  const publishRankingFilters = useCallback((filters: { position: RankingPosition | null; horizon: RankingHorizon | null; query: string | null }) => {
    dashboardUrl.commit(filters);
  }, [dashboardUrl.commit]);
  const publishDraftFilters = useCallback((filters: { draftPosition: DraftPosition | null; draftQuery: string | null; draftRoom: DraftRoom | null }) => {
    dashboardUrl.commit(filters);
  }, [dashboardUrl.commit]);
  const publishChartDataset = useCallback((dataset: ChartDataset) => {
    dashboardUrl.commit({ chartDataset: dataset === "advanced" ? null : dataset });
  }, [dashboardUrl.commit]);
  const publishTradeMode = useCallback((mode: TradeMode) => {
    dashboardUrl.commit({ tradeMode: mode === "league" ? null : mode });
  }, [dashboardUrl.commit]);

  const primaryPage = primaryPageForTab(tab);
  function choosePrimaryPage(page: PrimaryPage) {
    const defaultTabs: Record<PrimaryPage, Tab> = {
      team: "team",
      players: "rankings",
      league: "power",
      draft: "draft",
      tools: "monitor",
    };
    setTab(defaultTabs[page]);
  }

  function dashboardPlayerDetail(playerId: string): PlayerSearchResult | null {
    const currentDashboard = leagueDashboard ?? dashboard;
    if (!currentDashboard || !league) return null;
    const weekly = currentDashboard.rankings.find((row) => row.playerId === playerId);
    const season = currentDashboard.seasonLongRankings.find((row) => row.playerId === playerId && row.formatKey === league.seasonLongFormat.key);
    // Prefer matchup starters/bench (always in team section), then tradeTeams when loaded.
    // Rankings/season cover ticker and deep links on Comparison without trade data.
    const rosterPlayer = [...league.starters, ...league.bench, ...(league.opponentTeam?.starters ?? []), ...(league.opponentTeam?.bench ?? [])]
      .find((row) => row.playerId === playerId)
      ?? league.tradeTeams.flatMap((team) => team.players).find((row) => row.playerId === playerId);
    const defense = currentDashboard.defenses.find((row) => row.team === playerId);
    const name = weekly?.name ?? season?.name ?? rosterPlayer?.name ?? (defense ? `${defense.team} Defense` : null);
    const position = weekly?.position ?? season?.position ?? rosterPlayer?.position ?? (defense ? "DEF" : null);
    if (!name || !position) return null;
    return {
      key: `dashboard:${playerId}`,
      playerId,
      name,
      team: weekly?.team ?? season?.team ?? rosterPlayer?.team ?? defense?.team ?? null,
      position,
      opponent: weekly?.opponent ?? rosterPlayer?.opponent ?? defense?.opponent ?? null,
      isAway: weekly?.isAway ?? rosterPlayer?.isAway ?? defense?.isAway ?? null,
      isBye: weekly?.isBye ?? rosterPlayer?.isBye ?? false,
      injuryStatus: weekly?.injuryStatus ?? rosterPlayer?.injuryStatus ?? null,
      weeklyRank: weekly ? playerWeeklyRank(weekly, league.rankingField) : defense?.rank ?? rosterPlayer?.rank ?? null,
      weeklyProjection: weekly
        ? (weekly.gamePhase === "final" && typeof weekly.actual === "number" ? weekly.actual : league.rankingField === "ppr" ? weekly.ppr : weekly.halfPpr)
        : defense?.displayProjection ?? (rosterPlayer?.gamePhase === "final" ? rosterPlayer.actual : rosterPlayer?.projection) ?? null,
      projectionSource: weekly?.projectionSource ?? defense?.projectionSource ?? rosterPlayer?.projectionSource ?? null,
      seasonRank: season?.positionRank ?? null,
      seasonValue: season?.value ?? null,
      movement30Day: season ? movementPercent(season.value, season.trend30Day) : null,
      isRostered: league.rosteredPlayerIds.includes(playerId),
      gamePhase: weekly?.gamePhase ?? defense?.gamePhase ?? rosterPlayer?.gamePhase,
      actual: weekly?.actual ?? defense?.actualScore ?? rosterPlayer?.actual ?? null,
      defenseComponents: defense?.components ?? rosterPlayer?.defenseComponents,
      projectionComponents: weekly?.projectionComponents ?? rosterPlayer?.projectionComponents ?? null,
    };
  }

  function prefetchDashboardPlayer(playerId: string) {
    const player = dashboardPlayerDetail(playerId);
    if (!player || !league) return;
    const boomBustPosition = isBoomBustPosition(player.position) ? player.position : null;
    if (boomBustPosition) {
      void queryClient.prefetchQuery({
        queryKey: ["boom-bust-history", league.id, player.playerId, "season"],
        queryFn: () => api.getBoomBustHistory({ leagueId: league.id, playerId: player.playerId, position: boomBustPosition, view: "season" }),
        staleTime: 30 * 60 * 1000,
      });
    }
    if (player.position !== "PICK" && player.seasonValue !== null) {
      void queryClient.prefetchQuery({
        queryKey: ["fantasycalc-value-history", league.seasonLongFormat.key, [player.playerId]],
        queryFn: () => api.getValueHistory({ formatKey: league.seasonLongFormat.key, playerIds: [player.playerId] }),
        staleTime: 30 * 60 * 1000,
      });
    }
  }

  function openDashboardPlayer(playerId: string): boolean {
    const player = dashboardPlayerDetail(playerId);
    if (!player) return false;
    dashboardUrl.commit({ playerId });
    return true;
  }

  function openTickerPlayer(playerId: string) {
    if (dashboardPlayerDetail(playerId) || DOCKABLE_INSPECTOR_TABS.has(tab) || tab === "trade") {
      dashboardUrl.commit({ playerId });
      return;
    }
    dashboardUrl.commit({ tab: "rankings", playerId });
  }

  useEffect(() => {
    function onGlobalKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setShortcutsOpen(false);
        setCommandBarOpen((open) => !open);
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setCommandBarOpen(false);
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  const commandLeagues = useMemo<CommandLeagueItem[]>(
    () => (dashboard?.leagues ?? []).map((item) => ({ kind: "league", id: item.id, label: shortLeagueName(item.name) })),
    [dashboard?.leagues],
  );
  const commandPlayers = useMemo<CommandPlayerItem[]>(
    () => ((leagueDashboard ?? dashboard)?.rankings ?? []).map((row) => ({
      kind: "player" as const,
      id: row.playerId,
      label: row.name,
      position: row.position,
    })),
    [dashboard, leagueDashboard],
  );

  const isRefreshing = tab === "draft" ? draftRefresh.isPending : refresh.isPending;
  const refreshCurrentView = () => {
    if (tab === "draft") draftRefresh.mutate();
    else {
      refresh.mutate();
      queryClient.invalidateQueries({ queryKey: personalQueryKey(viewer, "player-news") });
    }
  };

  const hasCompleteDashboard = Boolean(dashboardQuery.data || browserDashboard);
  const hasPlayerSectionData = hasCompleteDashboard
    || (playersQuery.data?.section === "players" && playersQuery.data.data != null);
  const playerSectionError = !hasPlayerSectionData && (playersQuery.isError || sectionBuildFailed(playersQuery.data));
  const teamSectionError = !hasCompleteDashboard && sectionBuildFailed(teamQuery.data);
  const leagueSectionError = !hasCompleteDashboard && (leagueQuery.isError || sectionBuildFailed(leagueQuery.data));
  const analyticsSectionError = !hasCompleteDashboard && sectionBuildFailed(analyticsQuery.data);
  // League-adjusted trade also needs the waiver pool; a failed one must not
  // silently render as an empty pool.
  const tradeWaiverError = tradeWaiverActive && (tradeWaiverQuery.isError || sectionBuildFailed(tradeWaiverQuery.data));
  const tradeSectionError = !hasCompleteDashboard && (tradeQuery.isError || sectionBuildFailed(tradeQuery.data) || tradeWaiverError);
  const draftSectionError = draftQuery.isError && !draftQuery.data;
  // Hindsight only exists once the league's draft is final; a link to it before then lands on My team.
  const draftIsFinal = leagueDraftIsFinal(draftQuery.data?.drafts, league?.id);
  const draftRoomShown = dashboardUrl.state.draftRoom === "altPicks" && !draftIsFinal ? "myTeam" : dashboardUrl.state.draftRoom ?? "board";
  const newsLoading = newsQuery.isPending && !newsQuery.data;
  const newsError = newsQuery.isError && !newsQuery.data;
  const retryNews = () => { void newsQuery.refetch(); };
  // A `{ section: "trade", data: null }` response means the trade section is
  // still building server-side; the poll keeps running, so keep waiting rather
  // than assemble a dashboard with an empty tradeTeams.
  const tradeSectionWaiting = isSectionWaiting({
    active: tradeSectionActive,
    isError: tradeQuery.isError,
    isPending: tradeQuery.isPending,
    isFetching: tradeQuery.isFetching,
    hasPayload: tradeQuery.data?.section === "trade" && tradeQuery.data.data != null,
    dataUndefined: tradeQuery.data === undefined,
    waitingForBuild: !sectionBuildFailed(tradeQuery.data)
      && tradeQuery.data?.section === "trade"
      && tradeQuery.data.data == null,
  });
  const tradeWaiverWaiting = isSectionWaiting({
    active: tradeWaiverActive,
    isError: tradeWaiverQuery.isError,
    isPending: tradeWaiverQuery.isPending,
    isFetching: tradeWaiverQuery.isFetching,
    hasPayload: tradeWaiverQuery.data?.section === "trade-waiver" && tradeWaiverQuery.data.data != null,
    dataUndefined: tradeWaiverQuery.data === undefined,
  });
  // Rankings and Waivers render league badges and roster-card lookups from
  // the league section, so they wait until its payload is usable — including
  // the building state, where the section answers data: null between polls
  // and isPending alone would release the gate with empty power data.
  const leagueSectionWaiting = isSectionWaiting({
    active: (tab === "rankings" || tab === "waivers") && !hasCompleteDashboard,
    isError: leagueQuery.isError,
    isPending: leagueQuery.isPending,
    isFetching: leagueQuery.isFetching,
    hasPayload: leagueQuery.data?.section === "league" && leagueQuery.data.data != null,
    dataUndefined: leagueQuery.data === undefined,
    waitingForBuild: !sectionBuildFailed(leagueQuery.data)
      && leagueQuery.data?.section === "league"
      && leagueQuery.data.data == null,
  });
  const currentSectionLoading = tradeSectionWaiting
    || tradeWaiverWaiting
    || leagueSectionWaiting
    || (!hasCompleteDashboard && (
      (tab === "team" && teamQuery.isPending)
      || (MARKET_TOOL_TABS.has(tab) && (teamQuery.isPending || leagueQuery.isPending || analyticsQuery.isPending || playersQuery.isPending))
      || ((tab === "rankings" || tab === "waivers") && playersQuery.isPending)
      || (tab === "draft" && playersQuery.isPending)
      || (tab === "trade" && (playersQuery.isPending || teamQuery.isPending))
      || ((tab === "power" || tab === "outcomes") && (leagueQuery.isPending || teamQuery.isPending || playersQuery.isPending))
      || (tab === "comparison" && (analyticsQuery.isPending || playersQuery.isPending))
    ));

  // A signed-in user's first-ever dashboard builds in the background
  // (~30s) while sections answer `data: null`. Hold the loading shell and
  // let the section queries poll until it lands; only surface the error
  // state if nothing arrives after a generous wait.
  const waitingForFirstBuild =
    metaQuery.isSuccess
    && metaQuery.data?.section === "meta"
    && metaQuery.data.data == null
    // A failed background build is an error state, not "still building".
    && !sectionBuildFailed(metaQuery.data);
  const [firstBuildTimedOut, setFirstBuildTimedOut] = useState(false);
  useEffect(() => {
    if (!waitingForFirstBuild || dashboard) {
      setFirstBuildTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setFirstBuildTimedOut(true), 150_000);
    return () => clearTimeout(timer);
  }, [waitingForFirstBuild, dashboard]);

  // Shell owns the only PlayerDetailSheet. Open when URL playerId resolves from dashboard
  // (including deep links that miss a view-local list until section data lands).
  useEffect(() => {
    const playerId = dashboardUrl.state.playerId;
    if (!playerId) {
      if (playerHistory.isOpen) playerHistory.close();
      return;
    }
    const player = dashboardPlayerDetail(playerId);
    if (!player) return;
    if (playerHistory.current?.playerId === playerId) playerHistory.refresh(player);
    else playerHistory.open(player);
  }, [dashboard, dashboardUrl.state.playerId, league, leagueDashboard, tab]);

  if (shouldShowProgressiveShell({
    hasDashboard: Boolean(dashboard),
    metaPending: metaQuery.isPending,
    teamPending: teamQuery.isPending,
    waitingForFirstBuild,
    firstBuildTimedOut,
    tradeSectionWaiting,
    tradeWaiverWaiting,
  })) {
    return <ProgressiveShell tab={tab} onTab={setTab} />;
  }

  if (!dashboard || !league) {
    const noLeagues = Boolean(dashboard);
    // A failed first build gets its own message; Try again forces a rebuild.
    const firstBuildFailed = !noLeagues && sectionBuildFailed(metaQuery.data);
    return (
      <>
        <div className="fixed right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10">
          {supabase ? <AccountMenu /> : null}
        </div>
        <main id="main-content" tabIndex={-1} className="empty-state">
          <SafeAreaTopScrim backgroundColor="var(--bg)" />
          <div className="empty-mark">4TH</div>
        <h1>{noLeagues ? "No leagues for this season." : firstBuildFailed ? "Your dashboard didn’t build." : "Data didn’t make it through."}</h1>
        <p>{noLeagues ? "This Sleeper account isn’t in any NFL league for the current season. Join or create a league on Sleeper, then refresh." : firstBuildFailed ? "Building your leagues failed on our side. Try again to rebuild it." : "Fantasy data didn’t load. Try again."}</p>
        <Button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshIcon spinning={refresh.isPending} /> {noLeagues ? "Refresh" : "Try again"}</Button>
        </main>
      </>
    );
  }

  const activeDashboard = leagueDashboard ?? dashboard;
  const selectedPlayerId = dashboardUrl.state.playerId;
  const rosterTeam = playerHistory.current ? leaguePowerTeamForPlayer(league, playerHistory.current.playerId) : null;
  const rosterCardTeam = rosterCardRosterId === null
    ? null
    : league.powerRankingsWeek.find((team) => team.rosterId === rosterCardRosterId) ?? null;
  const rosterCardOnTop = rosterCardTeam !== null && selectedMatchup === null && teamCardTeam === null;
  const showAvailableBadge = playerHistory.current !== null && rosterTeam === null && !playerHistory.current.isRostered;
  const waiversHref = waiversSearchPreservingContext(dashboardUrl.state);
  const inspectorPresentation: "modal" | "docked" =
    playerHistory.current
    && DOCKABLE_INSPECTOR_TABS.has(tab)
    && inspectorDockViewport
      ? "docked"
      : "modal";
  const inspectorDocked = inspectorPresentation === "docked" && Boolean(playerHistory.current);
  // Player names inside tool rows link to the player card. The tools' data does not always share
  // the dashboard's player ids, so a row resolves by id first, then by an unambiguous name match.
  // A link into Analytics names a dashboard player; the chart finds them by name and position.
  const analyticsFocusDetail = tab === "analytics" && dashboardUrl.state.analyticsPlayerId
    ? dashboardPlayerDetail(dashboardUrl.state.analyticsPlayerId)
    : null;
  const analyticsFocusPlayer = analyticsFocusDetail
    ? { id: analyticsFocusDetail.playerId, name: analyticsFocusDetail.name, team: analyticsFocusDetail.team, position: analyticsFocusDetail.position }
    : null;
  let playerResolver: ReturnType<typeof createPlayerResolver> | null = null;
  const toolPlayerLink: PlayerLinkResolver = (ref) => {
    if (!playerResolver) {
      // Index the players dashboardPlayerDetail can open: weekly rankings, the league's season-long format, and rosters.
      const rows = new Map<string, DashboardPlayerRow>();
      const add = (row: DashboardPlayerRow) => { if (!rows.has(row.playerId)) rows.set(row.playerId, row); };
      activeDashboard.rankings.forEach(add);
      activeDashboard.seasonLongRankings.filter((row) => row.formatKey === league?.seasonLongFormat.key).forEach(add);
      if (league) {
        [...league.starters, ...league.bench, ...(league.opponentTeam?.starters ?? []), ...(league.opponentTeam?.bench ?? []), ...league.tradeTeams.flatMap((team) => team.players)].forEach(add);
      }
      playerResolver = createPlayerResolver([...rows.values()]);
    }
    const playerId = playerResolver(ref);
    if (!playerId) return null;
    return {
      href: serializeDashboardSearch({ ...dashboardUrl.state, playerId }),
      onOpen: () => { openDashboardPlayer(playerId); },
    };
  };

  // The analytics section reports a null payload while it is still
  // building; the query itself has completed by then, so pending alone
  // would flash the panel's empty state during the build.
  const analyticsLoading =
    analyticsQuery.isPending
    || (!analyticsQuery.isError
      && analyticsQuery.data?.section === "analytics"
      && analyticsQuery.data.data == null);
  const sheetPlayer = playerHistory.current;
  const sheetHandcuffTo = sheetPlayer
    ? handcuffStarter({
        playerId: sheetPlayer.playerId,
        position: sheetPlayer.position,
        team: sheetPlayer.team,
        weeklyRank: sheetPlayer.weeklyRank,
        leagueSize: league.seasonLongFormat.numTeams,
        depth: dashboard.playerInsights?.depth ?? {},
        playerLists: [dashboard.rankings, dashboard.seasonLongRankings],
      })
    : null;
  const playerSheet = playerHistory.current ? (
    <PlayerDetailSheet
      player={playerHistory.current}
      week={dashboard.week}
      leagueId={league.id}
      formatKey={league.seasonLongFormat.key}
      leagueSize={league.seasonLongFormat.numTeams}
      handcuffTo={sheetHandcuffTo}
      analytics={dashboard.analytics}
      analyticsLoading={analyticsLoading}
      sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id)}
      newsItems={tickerPlayerNews}
      newsLoading={newsLoading}
      newsError={newsError}
      onRetryNews={retryNews}
      onOpenTeam={setTeamCardTeam}
      onBack={playerHistory.back}
      canGoBack={playerHistory.canGoBack}
      onClose={() => { setRosterCardRosterId(null); setTeamCardTeam(null); playerHistory.close(); closeLinkedPlayer(); }}
      presentation={inspectorPresentation}
      rosterTeamName={rosterTeam?.teamName ?? null}
      rosterLabel={rosterTeam ? `Open ${rosterTeam.teamName}, ${formatRecord(rosterTeam.record)} record, rank ${rosterTeam.rank}` : null}
      onOpenRosterTeam={rosterTeam ? () => setRosterCardRosterId(rosterTeam.rosterId) : undefined}
      waiversHref={showAvailableBadge ? waiversHref : undefined}
      onOpenWaivers={showAvailableBadge ? () => dashboardUrl.commit({ tab: "waivers" }) : undefined}
      suspended={rosterCardOnTop || teamCardTeam !== null}
      trending={dashboard.playerTrending?.[playerHistory.current.playerId]}
      season={dashboard.season}
    />
  ) : null;

  return (
    <div className={`app-shell${primaryPage === "team" ? " matchup-page" : ""}${inspectorDocked ? " is-inspector-docked" : ""}`}>
      <SkipLink />
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {askOpen ? (
        <Suspense fallback={null}>
          <LazyAskSheet open={askOpen} onOpenChange={changeAskOpen} context={askContextForTab(tab)} horizon={dashboardUrl.state.horizon} leagueId={league?.id ?? null} />
        </Suspense>
      ) : null}
      <div role="region" aria-label="League and week" className="league-sticky">
          <TickerStrip
            data={draftQuery.data}
            news={leagueScopedNews}
            rosterPlayerIds={selectedLeagueRosterIds}
            opponentPlayerIds={selectedLeagueOpponentIds}
            prominentPlayerIds={selectedLeagueProminentIds}
            isDynastyContext={leagueIsDynasty}
            onPlayer={openTickerPlayer}
            onNews={setTickerNews}
          />
          <div className="week-line">
            <div><span className="live-dot" /> NFL {dashboard.season} · Week {dashboard.week}</div>
            <div className="week-actions">
            <AskButton buttonRef={askButtonRef} onClick={() => setAskOpen(true)} />
            {supabase ? <AccountMenu /> : null}
            <ThemeToggle />
            <button className="refresh-button" onClick={refreshCurrentView} disabled={isRefreshing} aria-label={tab === "draft" ? "Refresh draft data" : "Refresh scores and rankings"}><RefreshIcon spinning={isRefreshing} /></button>
            </div>
          </div>
          <DashboardPartialNotes dashboard={dashboard} />
          {failedResyncAsOf !== null && dashboard.asOf === failedResyncAsOf ? (
            <p className="data-notes resync-note" role="status">
              Couldn’t resync with Sleeper, so this is still the data from {new Date(dashboard.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Use refresh to try again.
            </p>
          ) : null}
          <label className="league-picker">
            <span className="sr-only">Choose league</span>
            <select value={league.id} onChange={(event) => chooseLeague(event.target.value)}>
              {dashboard.leagues.map((item) => <option key={item.id} value={item.id}>{shortLeagueName(item.name)}</option>)}
            </select>
          </label>
      </div>
      <header className="control-deck">
        <nav className="primary-tabs" aria-label="Fantasy sections">
          {([
            ["team", "Matchup"],
            ["players", "Players"],
            ["league", "League"],
            ["draft", "Draft"],
            ["tools", "Tools"],
          ] as const).map(([page, label]) => (
            <button
              key={page}
              className={primaryPage === page ? "active" : ""}
              onClick={() => choosePrimaryPage(page)}
              aria-current={primaryPage === page ? "page" : undefined}
            >
              <NavigationIcon page={page} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {primaryPage === "players" ? (
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="subview-tabs explorer-subview-tabs">
            <TabsList aria-label="Players views">
              <TabsTrigger value="rankings">Rankings</TabsTrigger>
              <TabsTrigger value="waivers">Waivers</TabsTrigger>
              <TabsTrigger value="comparison">Comparison</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {primaryPage === "league" ? (
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="subview-tabs league-subview-tabs">
            <TabsList aria-label="League views">
              <TabsTrigger value="power">Power</TabsTrigger>
              <TabsTrigger value="outcomes">Projected</TabsTrigger>
              <TabsTrigger value="trade">Trade</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {primaryPage === "draft" ? (
          <Tabs value={draftRoomShown} onValueChange={(value) => dashboardUrl.commit({ draftRoom: value === "board" ? null : (value as DraftRoom) })} className="subview-tabs draft-subview-tabs">
            <TabsList aria-label="Draft views">
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="myTeam">My team</TabsTrigger>
              {draftIsFinal ? <TabsTrigger value="altPicks">Hindsight</TabsTrigger> : null}
            </TabsList>
          </Tabs>
        ) : null}
        {primaryPage === "tools" ? (
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="subview-tabs tools-subview-tabs">
            <TabsList aria-label="Tools views">
              <TabsTrigger value="monitor">Game lines</TabsTrigger>
              <TabsTrigger value="team-stats">Team stats</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </header>

      <div className={`app-workspace${inspectorDocked ? " is-inspector-docked" : ""}`}>
        <main id="main-content" tabIndex={-1}>
          <h1 className="sr-only">{({
            team: "Fantasy matchup",
            rankings: "Player rankings",
            waivers: "Waiver wire",
            power: "League power rankings",
            outcomes: "Projected standings",
            draft: "Draft assistant",
            trade: "Trade",
            comparison: "Player comparison",
            monitor: "Game lines",
            "team-stats": "Team stats",
            analytics: "Analytics",
          } satisfies Record<Tab, string>)[tab]}</h1>
          <FeatureErrorBoundary title="This section didn’t load." resetKeys={[tab]}>
          {currentSectionLoading ? <SectionLoading label={`Loading ${({ team: "Matchup", players: "Players", league: "League", draft: "Draft", tools: "Tools" } as const)[primaryPage]}…`} />
            : (tab === "rankings" || tab === "waivers") && (playerSectionError || leagueSectionError || tradeSectionError) ? <SectionError title={tab === "rankings" ? "Rankings didn’t load." : "Waiver wire didn’t load."} onRetry={() => { if (playerSectionError) retrySection(playersQuery, "players"); if (leagueSectionError) retrySection(leagueQuery, "league"); if (tradeSectionError) { retrySection(tradeQuery, "trade"); if (tradeWaiverError) retrySection(tradeWaiverQuery, "trade-waiver"); } }} retrying={playersQuery.isFetching || leagueQuery.isFetching || tradeQuery.isFetching || tradeWaiverQuery.isFetching} />
            : tab === "comparison" && playerSectionError ? <SectionError title="Comparison didn’t load." onRetry={() => { retrySection(playersQuery, "players"); }} retrying={playersQuery.isFetching} />
            : tab === "comparison" && analyticsSectionError ? <SectionError title="Comparison didn’t load." onRetry={() => { retrySection(analyticsQuery, "analytics"); }} retrying={analyticsQuery.isFetching} />
            : tab === "team" && teamSectionError ? <SectionError title="Matchup didn’t load." onRetry={() => { retrySection(teamQuery, "team"); }} retrying={teamQuery.isFetching} />
            : (tab === "power" || tab === "outcomes") && leagueSectionError ? <SectionError title={tab === "outcomes" ? "Projected standings didn’t load." : "Power rankings didn’t load."} onRetry={() => { retrySection(leagueQuery, "league"); }} retrying={leagueQuery.isFetching} />
            : tab === "trade" && tradeSectionError ? <SectionError title="Trade data didn’t load." onRetry={() => { retrySection(tradeQuery, "trade"); if (tradeWaiverError) retrySection(tradeWaiverQuery, "trade-waiver"); }} retrying={tradeQuery.isFetching || tradeWaiverQuery.isFetching} />
            : tab === "analytics" && (playerSectionError || analyticsSectionError) ? <SectionError title="Analytics didn’t load." onRetry={() => { retrySection(playersQuery, "players"); retrySection(analyticsQuery, "analytics"); }} retrying={playersQuery.isFetching || analyticsQuery.isFetching} />
            : tab === "draft" && draftSectionError ? <SectionError title="Draft data didn’t load." onRetry={() => { void draftQuery.refetch(); }} retrying={draftQuery.isFetching} />
            : tab === "monitor" ? (
              <GameLinesPanel
                league={league}
                season={activeDashboard.season}
                week={activeDashboard.week}
                initialTeam={dashboardUrl.state.gameLinesTeam}
                onSelectionChange={dashboardUrl.commit}
                playerLink={toolPlayerLink}
                matchupLinkFor={(matchup) => ({
                  href: toolLinkSearch(dashboardUrl.state, { matchup }),
                  onOpen: () => setSelectedMatchup(matchup),
                })}
              />
            )
            : tab === "team-stats" ? (
              <TeamStatsPanel
                league={league}
                season={activeDashboard.season}
                week={activeDashboard.week}
                initial={{ team: dashboardUrl.state.teamStatsTeam, group: dashboardUrl.state.teamStatsGroup, stat: dashboardUrl.state.teamStatsStat }}
                onSelectionChange={dashboardUrl.commit}
                playerLink={toolPlayerLink}
              />
            )
            : tab === "analytics" ? (
              <Suspense fallback={<SectionLoading label="Loading analytics…" />}>
                <LazyChartsTool
                  dashboard={activeDashboard}
                  league={league}
                  dataset={dashboardUrl.state.chartDataset ?? "advanced"}
                  onDatasetChange={publishChartDataset}
                 
                  playerLink={toolPlayerLink}
                  focusPlayer={analyticsFocusPlayer}
                />
              </Suspense>
            )
            : tab === "team" ? <Lineup league={league} dashboard={activeDashboard} onOpenMatchup={setSelectedMatchup} onOpenLeagueTeam={(rosterId) => setRosterCardRosterId(rosterId)} linkedPlayerId={selectedPlayerId} onOpenLinkedPlayer={openLinkedPlayer} />
            : tab === "outcomes" ? <Suspense fallback={<SectionLoading label="Loading projected standings…" />}><LazyLeagueOutcomes leagueId={league.id} queryKey={personalQueryKey(viewer, "projected-standings", league.id)} /></Suspense>
            : tab === "power" ? <Suspense fallback={<SectionLoading label="Loading power rankings…" />}><LazyPowerRankings league={league} dashboard={activeDashboard} onPlayerIntent={prefetchDashboardPlayer} onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }} onOpenMatchup={setSelectedMatchup} playerCardOpen={playerHistory.isOpen} selectedPlayerId={selectedPlayerId} /></Suspense>
            : tab === "draft" ? <Suspense fallback={<SectionLoading label="Loading draft…" />}><LazyDraftCenter dashboard={activeDashboard} league={league} data={draftQuery.data} loading={draftQuery.isPending} onOpenMatchup={setSelectedMatchup} draftPosition={dashboardUrl.state.draftPosition} draftQuery={dashboardUrl.state.draftQuery} draftRoom={dashboardUrl.state.draftRoom} onDraftFiltersChange={publishDraftFilters} linkedPlayerId={selectedPlayerId} onOpenLinkedPlayer={openLinkedPlayer} /></Suspense>
            : tab === "trade" ? (
              <Suspense fallback={<SectionLoading label="Loading trade…" />}>
                <LazyTradeCalculator
                  dashboard={activeDashboard}
                  league={league}
                  tradeMode={effectiveTradeMode(dashboardUrl.state)}
                  onTradeModeChange={publishTradeMode}
                  onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }}
                  initialPartnerRosterId={parsePartnerRosterId(dashboardUrl.state.tradePartner)}
                  onPartnerSelect={(rosterId) => dashboardUrl.commit({ tradePartner: rosterId === null ? null : String(rosterId) })}
                />
              </Suspense>
            )
            : isExplorerMode(tab) ? (
              <Explorer
                mode={tab}
                dashboard={activeDashboard}
                league={league}
                onOpenMatchup={setSelectedMatchup}
                onOpenLeagueTeam={(rosterId) => setRosterCardRosterId(rosterId)}
                rankingPosition={dashboardUrl.state.position}
                rankingHorizon={dashboardUrl.state.horizon}
                rankingQuery={dashboardUrl.state.query}
                onRankingFiltersChange={publishRankingFilters}
                onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }}
                linkedPlayerId={selectedPlayerId}
                onOpenLinkedPlayer={openLinkedPlayer}
                comparePlayerId={tab === "comparison" ? dashboardUrl.state.comparePlayerId : null}
              />
            ) : null}
          </FeatureErrorBoundary>
        </main>
        {inspectorDocked ? <InspectorFrame>{playerSheet}</InspectorFrame> : null}
      </div>
      {!inspectorDocked ? playerSheet : null}
      {tickerNews ? <NewsCardModal item={tickerNews} onClose={() => setTickerNews(null)} /> : null}
      {selectedMatchup ? (
        <MatchupDataModal
          matchup={selectedMatchup}
          season={dashboard.season}
          week={dashboard.week}
          gameLines={dashboard.gameLines}
          onClose={() => setSelectedMatchup(null)}
          onOpenTeam={setTeamCardTeam}
          suspended={teamCardTeam !== null}
          gameLinesLink={{
            href: toolLinkSearch(dashboardUrl.state, { tab: "monitor", gameLinesTeam: selectedMatchup.team }),
            onOpen: () => {
              dashboardUrl.commit({
                ...CLEARED_TOOL_SELECTIONS,
                tab: "monitor",
                gameLinesTeam: selectedMatchup.team,
                matchup: null,
              });
            },
          }}
        />
      ) : null}
      {teamCardTeam ? <Suspense fallback={null}><LazyConnectedTeamCard team={teamCardTeam} dashboard={activeDashboard} leagueId={league.id} onOpenMatchup={openMatchupFromTeamCard} matchupHref={(matchup) => toolLinkSearch(dashboardUrl.state, { matchup })} onClose={() => setTeamCardTeam(null)} /></Suspense> : null}
      {rosterCardTeam ? (
        <LeagueTeamCard
          team={rosterCardTeam}
          league={league}
          dashboard={activeDashboard}
          scope="week"
          mode="seasonLong"
          powerRankings={league.powerRankingsWeek}
          playerCardOpen={!rosterCardOnTop}
          layer="above-player"
          selectedPlayerId={selectedPlayerId}
          onPlayerIntent={prefetchDashboardPlayer}
          onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }}
          onOpenMatchup={setSelectedMatchup}
          onClose={() => setRosterCardRosterId(null)}
        />
      ) : null}
      <CommandBar
        open={commandBarOpen}
        onOpenChange={setCommandBarOpen}
        leagues={commandLeagues}
        players={commandPlayers}
        onSelectPage={openCommandPage}
        onSelectPlayer={openTickerPlayer}
        onSelectLeague={chooseLeague}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
