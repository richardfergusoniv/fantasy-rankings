import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "./api";
import type {
  Dashboard,
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
import { effectiveTradeMode } from "./dashboard-url";
import { PlayerDetailSheet, usePlayerCardHistory } from "./player-detail";
import { SkipLink } from "./shared";
import { supabase } from "./supabase";
import { useDashboardUrl } from "./use-dashboard-url";
import { CommandBar } from "./shell/command-bar";
import { isTypingTarget, type CommandLeagueItem, type CommandPlayerItem } from "./shell/command-palette";
import { InspectorFrame, useInspectorDockViewport } from "./shell/inspector-frame";
import { ShortcutsDialog } from "./shell/shortcuts-dialog";
import { Explorer, isExplorerMode } from "./views/explorer";
import { Lineup } from "./views/lineup";
import { Monitor } from "./views/monitor";

const DOCKABLE_INSPECTOR_TABS = new Set<Tab>(["monitor", "team", "rankings", "waivers", "draft", "power"]);

const LazyPowerRankings = lazy(() => import("./PowerRankings").then((module) => ({ default: module.PowerRankings })));
const LazyDraftCenter = lazy(() => import("./views/draft-center").then((module) => ({ default: module.DraftCenter })));
const LazyTradeCalculator = lazy(() => import("./views/trade-calculator").then((module) => ({ default: module.TradeCalculator })));

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
    monitor: <><path d="M4 4h7v7H4zM13 4h7v4H13zM13 10h7v10H13zM4 13h7v7H4z" /></>,
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
  if (tab === "monitor") return "monitor";
  if (tab === "team") return "team";
  if (tab === "rankings" || tab === "waivers" || tab === "charts" || tab === "comparison") return "players";
  if (tab === "power") return "league";
  if (tab === "trade" || tab === "draft") return "tools";
  const unreachable: never = tab;
  return unreachable;
}

type TickerItem = {
  key: string;
  source: string;
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
  const isLeagueHeadline = item.playerId === "league" || /^league headline$/i.test(item.player);
  const subject = isLeagueHeadline ? (item.team && item.team !== "NFL" ? item.team : "NFL") : item.player;
  const escapedNames = [item.player, item.player.split(/\s+/).at(-1), item.team]
    .filter((value): value is string => Boolean(value) && !/^league headline$|^nfl$/i.test(value ?? ""))
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const subjectPattern = escapedNames.length > 0 ? new RegExp(`^(?:${escapedNames.join("|")})\\s*(?::|[-–—])?\\s*`, "i") : null;
  const detail = subjectPattern ? item.change.replace(subjectPattern, "") : item.change;
  return tickerLabel(subject, detail.replace(/^(?:is|are|has|have)\s+/i, ""));
}

function compactTickerCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value).toUpperCase();
}

function TickerStrip({ data, news, onPlayer, onNews }: {
  data: DraftCenterData | undefined;
  news: PlayerNews | undefined;
  onPlayer: (playerId: string) => void;
  onNews: (item: PlayerNewsItem) => void;
}) {
  const items = useMemo<TickerItem[]>(() => {
    const trendItems: TickerItem[] = (data?.trending ?? []).slice(0, 4).map((trend) => ({
      key: `trend:${trend.playerId}`,
      source: "SLEEPER",
      label: tickerLabel(trend.name, `+${compactTickerCount(trend.count)} adds${trend.position ? ` · ${trend.position}` : ""}`),
      quote: null,
      move: null,
      tone: "up",
      playerId: trend.playerId,
    }));
    const trendDropItems: TickerItem[] = (data?.trendingDrops ?? []).slice(0, 4).map((trend) => ({
      key: `trend-drop:${trend.playerId}`,
      source: "SLEEPER",
      label: tickerLabel(trend.name, `−${compactTickerCount(trend.count)} drops${trend.position ? ` · ${trend.position}` : ""}`),
      quote: null,
      move: null,
      tone: "down",
      playerId: trend.playerId,
    }));

    const seenHeadlines = new Set<string>();
    const headlineItems: TickerItem[] = (news?.runs ?? []).flatMap((run) => run.items).flatMap((item) => {
      // The top strip is league-wide: roster-scoped entries remain available in player detail views.
      if (item.newsType === "roster" || seenHeadlines.has(item.change)) return [];
      seenHeadlines.add(item.change);
      return [{
        key: `news:${item.id}`,
        source: item.newsType === "headline" && item.playerId === "league" ? "BREAKING" : "NEWS",
        label: tickerNewsLabel(item),
        quote: null,
        move: null,
        tone: "neutral" as const,
        newsItem: item,
      }];
    }).slice(0, 5);

    if (trendItems.length > 0 || trendDropItems.length > 0) return [...trendItems, ...trendDropItems, ...headlineItems];

    const adpFallback: TickerItem[] = (data?.adp ?? [])
      .filter((row) => row.pool === "all" && row.mflAdp !== null)
      .map((row) => ({ row, edge: (row.mflAdp ?? row.adp) - row.adp }))
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
      .slice(0, 7)
      .map(({ row, edge }) => ({
        key: `adp:${row.format}:${row.playerId ?? row.name}`,
        source: "ADP",
        label: tickerLabel(row.name, `ADP ${formatDecimal(row.adp, 1)} · ${formatDecimal(edge, 1, { sign: "always" })} vs MFL`),
        quote: null,
        move: edge,
        tone: Math.abs(edge) < 0.05 ? "neutral" : edge > 0 ? "up" : "down",
        ...(row.playerId ? { playerId: row.playerId } : {}),
      }));
    return [...adpFallback, ...headlineItems];
  }, [data, news]);

  const visibleItems = items.length > 0 ? items : [{ key: "waiting", source: "NFL", label: "Awaiting the next update", quote: null, move: null, tone: "neutral" as const }];
  const repeatedItems = visibleItems.length > 1 ? [...visibleItems, ...visibleItems] : visibleItems;
  const isStatic = visibleItems.length === 1;

  const content = (item: TickerItem) => (
    <>
      <span className={`ticker-source ${item.source === "BREAKING" ? "breaking" : ""}`}>{item.source}</span>
      <span className="ticker-label">{item.label}</span>
      {item.quote ? <strong>{item.quote}</strong> : null}
      {item.move !== null && Math.abs(item.move) >= 0.05 ? <span className={`ticker-move ${item.tone}`}>{item.move > 0 ? "▲" : "▼"}{formatDecimal(Math.abs(item.move), 1)}</span> : null}
    </>
  );

  return (
    <section className="ticker-strip" aria-label="Live fantasy and NFL ticker">
      <div className="ticker-viewport">
        <div className={`ticker-track${isStatic ? " is-static" : ""}`}>
          {repeatedItems.map((item, index) => {
            const isCopy = index >= visibleItems.length;
            return item.newsItem ? (
              <button
                type="button"
                className={`ticker-item${isCopy ? " ticker-copy" : ""}`}
                key={`${item.key}:${index}`}
                onClick={() => item.newsItem ? onNews(item.newsItem) : undefined}
                aria-label={isCopy ? undefined : `${item.source}: ${item.label}`}
                aria-hidden={isCopy || undefined}
                tabIndex={isCopy ? -1 : undefined}
              >{content(item)}</button>
            ) : item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer" className={`ticker-item${isCopy ? " ticker-copy" : ""}`} key={`${item.key}:${index}`} aria-label={isCopy ? undefined : `${item.source}: ${item.label} (opens in a new tab)`} aria-hidden={isCopy || undefined} tabIndex={isCopy ? -1 : undefined}>{content(item)}</a>
            ) : (
              <button
                type="button"
                className={`ticker-item${isCopy ? " ticker-copy" : ""}`}
                key={`${item.key}:${index}`}
                onClick={() => item.playerId ? onPlayer(item.playerId) : undefined}
                aria-label={isCopy ? undefined : `${item.source}: ${item.label}`}
                aria-hidden={isCopy || undefined}
                tabIndex={isCopy ? -1 : undefined}
              >{content(item)}</button>
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
function pollWhileSectionBuilding(query: { state: { data?: unknown } }): number | false {
  const data = query.state.data as { data?: unknown } | undefined;
  return data !== undefined && data.data == null ? SECTION_BUILD_POLL_MS : false;
}

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

function readBrowserDashboard(userId: string | null): Dashboard | undefined {
  if (!userId) {
    dropUnsignedBrowserDashboard();
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BROWSER_DASHBOARD_CACHE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || !("dashboard" in parsed) || !("userId" in parsed)) return undefined;
    if (parsed.userId !== userId) return undefined;
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

function saveBrowserDashboard(userId: string | null, dashboard: Dashboard): void {
  if (!userId) return;
  try {
    localStorage.setItem(BROWSER_DASHBOARD_CACHE_KEY, JSON.stringify({ userId, dashboard }));
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

function assembleStreamedDashboard(
  meta: MetaSection["data"],
  team: TeamSection["data"],
  players: PlayersSection["data"],
  power: LeagueSection["data"],
  analytics: AnalyticsSection["data"],
): Dashboard | undefined {
  if (!meta) return undefined;
  const teamByLeague = new Map((team?.leagues ?? []).map((league) => [league.id, league]));
  const powerByLeague = new Map((power?.leagues ?? []).map((league) => [league.id, league]));
  const leagues: Dashboard["leagues"] = meta.leagues.map((identity) => {
    const teamData = teamByLeague.get(identity.id);
    const powerData = powerByLeague.get(identity.id);
    return {
      ...identity,
      record: teamData?.record ?? { wins: 0, losses: 0, ties: 0 },
      teamActual: teamData?.teamActual ?? null,
      teamProjection: teamData?.teamProjection ?? null,
      starters: teamData?.starters ?? [],
      bench: teamData?.bench ?? [],
      opponentTeam: teamData?.opponentTeam ?? null,
      suggestion: teamData?.suggestion ?? null,
      tradeTeams: teamData?.tradeTeams ?? [],
      tradeWaiverPool: teamData?.tradeWaiverPool ?? [],
      tradeStarterSlots: teamData?.tradeStarterSlots ?? [],
      powerRankingsWeek: powerData?.powerRankingsWeek ?? [],
      powerRankingsSeasonLong: powerData?.powerRankingsSeasonLong ?? [],
      powerRankingsDynasty: powerData?.powerRankingsDynasty ?? [],
    };
  });
  return {
    ...meta,
    leagues,
    rankings: players?.rankings ?? [],
    weeklyChartRankings: players?.weeklyChartRankings ?? [],
    seasonLongRankings: players?.seasonLongRankings ?? [],
    defenses: players?.defenses ?? [],
    strengthOfSchedule: players?.strengthOfSchedule ?? [],
    analytics: analytics?.analytics ?? { asOf: null, throughWeek: null, sourceUrl: "", entities: [], teamUsage: [], teamRecords: [] },
  };
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
    ["monitor", "Monitor", "monitor"],
    ["team", "Matchup", "team"],
    ["players", "Players", "rankings"],
    ["league", "League", "power"],
    ["tools", "Tools", "trade"],
  ];
  return (
    <div className="app-shell progressive-shell">
      <SkipLink />
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="league-sticky progressive-sticky">
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

export function App() {
  const queryClient = useQueryClient();
  const dashboardUrl = useDashboardUrl();
  const tab = dashboardUrl.state.tab;
  const setTab = useCallback((next: Tab) => {
    dashboardUrl.commit({ tab: next, playerId: null });
  }, [dashboardUrl.commit]);
  const openCommandPage = useCallback((next: Tab, options?: { tradeMode?: TradeMode }) => {
    if (next === "trade") {
      dashboardUrl.commit({
        tab: "trade",
        playerId: null,
        tradeMode: options?.tradeMode && options.tradeMode !== "league" ? options.tradeMode : null,
      });
      return;
    }
    dashboardUrl.commit({ tab: next, playerId: null });
  }, [dashboardUrl.commit]);
  const appliedAppPlayerId = useRef<string | null>(null);
  const inspectorDockViewport = useInspectorDockViewport();
  useEffect(() => {
    const titles: Record<Tab, string> = {
      monitor: "Monitor",
      team: "Matchup",
      rankings: "Players",
      waivers: "Players",
      power: "League",
      draft: "Tools",
      trade: "Tools",
      charts: "Players",
      comparison: "Players",
    };
    document.title = `${titles[tab]} · Fantasy Rankings`;
  }, [tab]);
  const playerHistory = usePlayerCardHistory();
  const [tickerNews, setTickerNews] = useState<PlayerNewsItem | null>(null);
  const [selectedMatchup, setSelectedMatchup] = useState<MatchupSelection | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState(() => dashboardUrl.state.league ?? localStorage.getItem("fantasy-rankings-league") ?? "");
  const [browserViewerId, setBrowserViewerId] = useState<string | null | undefined>(undefined);
  const [browserDashboard, setBrowserDashboard] = useState<Dashboard | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void currentViewerId().then((userId) => {
      if (cancelled) return;
      setBrowserViewerId(userId);
      setBrowserDashboard(readBrowserDashboard(userId));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const metaQuery = useQuery({
    queryKey: ["dashboard-section", "meta"],
    queryFn: () => withSignIn(withClientDeadline(api.getDashboardSection({ section: "meta" }), 8_000)),
    staleTime: 90_000,
    retry: false,
    refetchInterval: pollWhileSectionBuilding,
  });
  const teamQuery = useQuery({
    queryKey: ["dashboard-section", "team"],
    queryFn: () => withSignIn(withClientDeadline(api.getDashboardSection({ section: "team" }), 8_000)),
    staleTime: 90_000,
    retry: false,
    refetchInterval: pollWhileSectionBuilding,
  });
  // Matchup player cards need fantasy SOS for Team context ranks.
  const playerSectionActive = tab === "team" || tab === "rankings" || tab === "waivers" || tab === "draft" || tab === "trade" || tab === "power" || tab === "charts" || tab === "comparison";
  const playersQuery = useQuery({
    queryKey: ["dashboard-section", "players"],
    queryFn: () => withSignIn(withClientDeadline(api.getDashboardSection({ section: "players" }), 8_000)),
    staleTime: 90_000,
    retry: false,
    enabled: playerSectionActive,
    refetchInterval: pollWhileSectionBuilding,
  });
  const leagueQuery = useQuery({
    queryKey: ["dashboard-section", "league"],
    queryFn: () => withSignIn(withClientDeadline(api.getDashboardSection({ section: "league" }), 8_000)),
    staleTime: 90_000,
    retry: false,
    enabled: tab === "power" || tab === "monitor",
    refetchInterval: pollWhileSectionBuilding,
  });
  const analyticsQuery = useQuery({
    queryKey: ["dashboard-section", "analytics"],
    queryFn: () => withSignIn(withClientDeadline(api.getDashboardSection({ section: "analytics" }), 8_000)),
    staleTime: 90_000,
    retry: false,
    enabled: tab === "rankings" || tab === "waivers" || tab === "charts" || tab === "comparison",
    refetchInterval: pollWhileSectionBuilding,
  });
  const dashboardQuery = useQuery({
    queryKey: ["fantasy-dashboard"],
    queryFn: () => withSignIn(withClientDeadline(api.getDashboard({ force: false }), DASHBOARD_DEADLINE_MS)),
    staleTime: 90_000,
    initialData: browserDashboard,
    initialDataUpdatedAt: 0,
    retry: false,
    enabled: false,
  });
  const refresh = useMutation({
    mutationFn: async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("Sign in required.");
      }
      return withClientDeadline(api.getDashboard({ force: true }), DASHBOARD_DEADLINE_MS);
    },
    onSuccess: (data) => {
      void currentViewerId().then((userId) => saveBrowserDashboard(userId, data));
      queryClient.setQueryData(["fantasy-dashboard"], data);
      queryClient.invalidateQueries({ queryKey: ["dashboard-section"] });
    },
    onError: (error: unknown) => {
      signOutForPersonalData(error);
    },
  });
  const newsQuery = useQuery({
    queryKey: ["player-news"],
    queryFn: async () => {
      try {
        return await withClientDeadline(api.getPlayerNews({}), 8_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const draftQuery = useQuery({
    queryKey: ["draft-center"],
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
    mutationFn: async () => {
      try {
        return await withClientDeadline(api.getDraftCenter({ force: true }), 24_000);
      } catch (error) {
        signOutForPersonalData(error);
        throw error;
      }
    },
    onSuccess: (data) => queryClient.setQueryData(["draft-center"], data),
  });
  const newsItemsByPlayer = useMemo(() => groupNewsItemsByPlayer(newsQuery.data), [newsQuery.data]);
  const tickerPlayerNews = playerHistory.current ? newsItemsByPlayer.get(playerHistory.current.playerId) ?? [] : [];

  const streamedDashboard = useMemo(() => assembleStreamedDashboard(
    metaQuery.data?.section === "meta" ? metaQuery.data.data : null,
    teamQuery.data?.section === "team" ? teamQuery.data.data : null,
    playersQuery.data?.section === "players" ? playersQuery.data.data : null,
    leagueQuery.data?.section === "league" ? leagueQuery.data.data : null,
    analyticsQuery.data?.section === "analytics" ? analyticsQuery.data.data : null,
  ), [analyticsQuery.data, leagueQuery.data, metaQuery.data, playersQuery.data, teamQuery.data]);
  // Every section is projected from the same saved dashboard snapshot; no
  // render-time source refresh or projection merge occurs.
  const dashboard = freshestDashboard(dashboardQuery.data, streamedDashboard, browserDashboard);

  const league = dashboard?.leagues.find((item) => item.id === selectedLeagueId) ?? dashboard?.leagues[0];
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

  useEffect(() => {
    if (!dashboard || !browserViewerId) return;
    saveBrowserDashboard(browserViewerId, dashboard);
    if (document.documentElement.dataset.fantasyFirstContentMs) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const elapsed = Math.round(performance.now());
      document.documentElement.dataset.fantasyFirstContentMs = String(elapsed);
      performance.mark("fantasy-first-content");
    }));
  }, [dashboard, browserViewerId]);

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
    dashboardUrl.commit({ league: id, playerId: null });
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
      monitor: "monitor",
      team: "team",
      players: "rankings",
      league: "power",
      tools: "trade",
    };
    setTab(defaultTabs[page]);
  }

  function dashboardPlayerDetail(playerId: string): PlayerSearchResult | null {
    const currentDashboard = leagueDashboard ?? dashboard;
    if (!currentDashboard || !league) return null;
    const weekly = currentDashboard.rankings.find((row) => row.playerId === playerId);
    const season = currentDashboard.seasonLongRankings.find((row) => row.playerId === playerId && row.formatKey === league.seasonLongFormat.key);
    const rosterPlayer = league.tradeTeams.flatMap((team) => team.players).find((row) => row.playerId === playerId)
      ?? [...league.starters, ...league.bench, ...(league.opponentTeam?.starters ?? []), ...(league.opponentTeam?.bench ?? [])].find((row) => row.playerId === playerId);
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
      weeklyRank: weekly ? (weekly.leagueProjection === null ? null : league.rankingField === "ppr" ? weekly.pprRank : weekly.halfPprRank) : defense?.rank ?? rosterPlayer?.rank ?? null,
      weeklyProjection: weekly
        ? (league.rankingField === "ppr" ? weekly.ppr : weekly.halfPpr)
        : defense?.displayProjection ?? (rosterPlayer?.gamePhase === "final" ? rosterPlayer.actual : rosterPlayer?.projection) ?? null,
      projectionSource: weekly?.projectionSource ?? defense?.projectionSource ?? rosterPlayer?.projectionSource ?? null,
      seasonRank: season?.positionRank ?? null,
      seasonValue: season?.value ?? null,
      movement30Day: season ? movementPercent(season.value, season.trend30Day) : null,
      isRostered: league.rosteredPlayerIds.includes(playerId),
      gamePhase: defense?.gamePhase ?? rosterPlayer?.gamePhase,
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
      queryClient.invalidateQueries({ queryKey: ["player-news"] });
    }
  };

  const hasCompleteDashboard = Boolean(dashboardQuery.data || browserDashboard);
  const hasPlayerSectionData = hasCompleteDashboard || playersQuery.data?.section === "players";
  const playerSectionError = !hasPlayerSectionData && playersQuery.isError;
  const draftSectionError = draftQuery.isError && !draftQuery.data;
  const newsLoading = newsQuery.isPending && !newsQuery.data;
  const newsError = newsQuery.isError && !newsQuery.data;
  const retryNews = () => { void newsQuery.refetch(); };
  const currentSectionLoading = !hasCompleteDashboard && (
    (tab === "team" && teamQuery.isPending)
    || (tab === "monitor" && (teamQuery.isPending || leagueQuery.isPending))
    || ((tab === "rankings" || tab === "waivers" || tab === "draft") && playersQuery.isPending)
    || (tab === "trade" && (playersQuery.isPending || teamQuery.isPending))
    || (tab === "power" && (leagueQuery.isPending || teamQuery.isPending || playersQuery.isPending))
    || ((tab === "charts" || tab === "comparison") && (analyticsQuery.isPending || playersQuery.isPending))
  );

  // A signed-in user's first-ever dashboard builds in the background
  // (~30s) while sections answer `data: null`. Hold the loading shell and
  // let the section queries poll until it lands; only surface the error
  // state if nothing arrives after a generous wait.
  const waitingForFirstBuild =
    metaQuery.isSuccess
    && metaQuery.data?.section === "meta"
    && metaQuery.data.data == null;
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
      appliedAppPlayerId.current = null;
      if (playerHistory.isOpen) playerHistory.close();
      return;
    }
    if (appliedAppPlayerId.current === playerId && playerHistory.current?.playerId === playerId) return;
    const player = dashboardPlayerDetail(playerId);
    if (!player) return;
    appliedAppPlayerId.current = playerId;
    if (playerHistory.current?.playerId !== playerId) playerHistory.open(player);
  }, [dashboard, dashboardUrl.state.playerId, league, leagueDashboard, tab]);

  if (!dashboard && (metaQuery.isPending || teamQuery.isPending || (waitingForFirstBuild && !firstBuildTimedOut))) {
    return <ProgressiveShell tab={tab} onTab={setTab} />;
  }

  if (!dashboard || !league) {
    const noLeagues = Boolean(dashboard);
    return (
      <main id="main-content" tabIndex={-1} className="empty-state">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <div className="empty-mark">4TH</div>
        <h1>{noLeagues ? "No leagues for this season." : "Data didn’t make it through."}</h1>
        <p>{noLeagues ? "This Sleeper account isn’t in any NFL league for the current season. Join or create a league on Sleeper, then refresh." : "Fantasy data didn’t load. Try again."}</p>
        <Button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshIcon spinning={refresh.isPending} /> {noLeagues ? "Refresh" : "Try again"}</Button>
      </main>
    );
  }

  const activeDashboard = leagueDashboard ?? dashboard;
  const selectedPlayerId = dashboardUrl.state.playerId;
  const inspectorPresentation: "modal" | "docked" =
    playerHistory.current
    && DOCKABLE_INSPECTOR_TABS.has(tab)
    && inspectorDockViewport
      ? "docked"
      : "modal";
  const inspectorDocked = inspectorPresentation === "docked" && Boolean(playerHistory.current);
  const playerSheet = playerHistory.current ? (
    <PlayerDetailSheet
      player={playerHistory.current}
      week={dashboard.week}
      leagueId={league.id}
      formatKey={league.seasonLongFormat.key}
      mode="details"
      analytics={dashboard.analytics}
      sosEntry={dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id)}
      newsItems={tickerPlayerNews}
      newsLoading={newsLoading}
      newsError={newsError}
      onRetryNews={retryNews}
      onOpenMatchup={setSelectedMatchup}
      onBack={playerHistory.back}
      canGoBack={playerHistory.canGoBack}
      onClose={() => { playerHistory.close(); closeLinkedPlayer(); }}
      presentation={inspectorPresentation}
    />
  ) : null;

  return (
    <div className={`app-shell${primaryPage === "team" ? " matchup-page" : ""}${inspectorDocked ? " is-inspector-docked" : ""}`}>
      <SkipLink />
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="league-sticky">
          <TickerStrip data={draftQuery.data} news={newsQuery.data} onPlayer={openTickerPlayer} onNews={setTickerNews} />
          <div className="week-line">
            <div><span className="live-dot" /> NFL {dashboard.season} · WEEK {dashboard.week}</div>
            <button className="refresh-button" onClick={refreshCurrentView} disabled={isRefreshing} aria-label={tab === "draft" ? "Refresh draft data" : "Refresh scores and rankings"}><RefreshIcon spinning={isRefreshing} /></button>
          </div>
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
            ["monitor", "Monitor"],
            ["team", "Matchup"],
            ["players", "Players"],
            ["league", "League"],
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
              <TabsTrigger value="charts">Charts</TabsTrigger>
              <TabsTrigger value="comparison">Comparison</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {primaryPage === "tools" ? (
          <Tabs value={tab === "draft" ? "draft" : "trade"} onValueChange={(value) => setTab(value as Tab)} className="subview-tabs tools-subview-tabs">
            <TabsList aria-label="Tools views">
              <TabsTrigger value="trade">Trade</TabsTrigger>
              <TabsTrigger value="draft">Draft</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </header>

      <div className={`app-workspace${inspectorDocked ? " is-inspector-docked" : ""}`}>
        <main id="main-content" tabIndex={-1}>
          <h1 className="sr-only">{({
            monitor: "Monitor",
            team: "Fantasy matchup",
            rankings: "Player rankings",
            waivers: "Waiver wire",
            power: "League power rankings",
            draft: "Draft assistant",
            trade: "Trade",
            charts: "Fantasy charts",
            comparison: "Player comparison",
          } satisfies Record<Tab, string>)[tab]}</h1>
          {currentSectionLoading ? <SectionLoading label={`Loading ${({ monitor: "Monitor", team: "Matchup", players: "Players", league: "League", tools: "Tools" } as const)[primaryPage]}…`} />
            : (tab === "rankings" || tab === "waivers") && playerSectionError ? <SectionError title={tab === "rankings" ? "Rankings didn’t load." : "Waiver wire didn’t load."} onRetry={() => { void playersQuery.refetch(); }} retrying={playersQuery.isFetching} />
            : tab === "draft" && draftSectionError ? <SectionError title="Draft data didn’t load." onRetry={() => { void draftQuery.refetch(); }} retrying={draftQuery.isFetching} />
            : tab === "monitor" ? <Monitor league={league} dashboard={activeDashboard} draftData={draftQuery.data} news={newsQuery.data} onOpenPlayer={openTickerPlayer} onOpenMatchup={setSelectedMatchup} />
            : tab === "team" ? <Lineup league={league} dashboard={activeDashboard} onOpenMatchup={setSelectedMatchup} linkedPlayerId={selectedPlayerId} onOpenLinkedPlayer={openLinkedPlayer} />
            : tab === "power" ? <Suspense fallback={<SectionLoading label="Loading power rankings…" />}><LazyPowerRankings league={league} dashboard={activeDashboard} onPlayerIntent={prefetchDashboardPlayer} onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }} playerCardOpen={playerHistory.isOpen} selectedPlayerId={selectedPlayerId} /></Suspense>
            : tab === "draft" ? <Suspense fallback={<SectionLoading label="Loading draft…" />}><LazyDraftCenter dashboard={activeDashboard} league={league} data={draftQuery.data} loading={draftQuery.isPending} onRefresh={() => draftRefresh.mutate()} refreshing={draftRefresh.isPending} onOpenMatchup={setSelectedMatchup} draftPosition={dashboardUrl.state.draftPosition} draftQuery={dashboardUrl.state.draftQuery} draftRoom={dashboardUrl.state.draftRoom} onDraftFiltersChange={publishDraftFilters} linkedPlayerId={selectedPlayerId} onOpenLinkedPlayer={openLinkedPlayer} /></Suspense>
            : tab === "trade" ? (
              <Suspense fallback={<SectionLoading label="Loading trade…" />}>
                <LazyTradeCalculator
                  dashboard={activeDashboard}
                  league={league}
                  tradeMode={effectiveTradeMode(dashboardUrl.state)}
                  onTradeModeChange={publishTradeMode}
                  onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }}
                />
              </Suspense>
            )
            : isExplorerMode(tab) ? (
              <Explorer
                mode={tab}
                dashboard={activeDashboard}
                league={league}
                onOpenMatchup={setSelectedMatchup}
                rankingPosition={dashboardUrl.state.position}
                rankingHorizon={dashboardUrl.state.horizon}
                rankingQuery={dashboardUrl.state.query}
                onRankingFiltersChange={publishRankingFilters}
                chartDataset={dashboardUrl.state.chartDataset ?? "advanced"}
                onChartDatasetChange={publishChartDataset}
                onOpenPlayer={(playerId) => { openDashboardPlayer(playerId); }}
                linkedPlayerId={selectedPlayerId}
                onOpenLinkedPlayer={openLinkedPlayer}
              />
            ) : null}
        </main>
        {inspectorDocked ? <InspectorFrame>{playerSheet}</InspectorFrame> : null}
      </div>
      {!inspectorDocked ? playerSheet : null}
      {tickerNews ? <NewsCardModal item={tickerNews} onClose={() => setTickerNews(null)} /> : null}
      {selectedMatchup ? <MatchupDataModal matchup={selectedMatchup} season={dashboard.season} week={dashboard.week} onClose={() => setSelectedMatchup(null)} /> : null}
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
