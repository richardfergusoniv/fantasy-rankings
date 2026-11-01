import { Fragment, useMemo, useState } from "react";
import { useMinuteNow } from "./use-minute-now";
import { CrossToolBadge, ToolLinks, type CrossToolLink, type ToolLinkItem } from "./tool-links";
import { formatImpliedTotal } from "./lib/game-line-matchup-link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayedMatchupPoints } from "../../api/_lib/lineup-optimizer";
import { api } from "./api";
import type {
  BasePosition,
  BoomBustPosition,
  Dashboard,
  MatchupGrade,
  MatchupSelection,
  MatchupStatConfig,
  PlayerNews,
  PlayerNewsItem,
  PlayerSearchResult,
  PfnRow,
  PfnTable,
  PositionFilter,
  ProjectionComponent,
  RosterPlayer,
  TradeAsset,
} from "./dashboard-types";
import { EdgeStrip } from "./components/edge-strip";
import { RefreshIcon, SectionError } from "./section-error";
import { dashboardFreshness } from "./dashboard-freshness";
import { newsAbsoluteTimeLabel, newsItemTimeLabel, newsRelativeTimeLabel } from "./news-time";
import { NewsTypeBadges } from "./news-badges";
import { isHttpOrHttpsUrl } from "../../api/_lib/http-url";
import { formatDecimal, formatPercent, formatPoints } from "./lib/format-number";
import { gameLineSummary, type TeamGameLineLike } from "./game-line-summary";
import { GAME_LINES_STALE_MS, loadNflverseGameLines } from "../../api/_lib/nflverse-game-lines";
import { ModalCard } from "./components/modal-card";
import {
  TRADE_REMOVE_TOAST_ID,
  UNDO_DURATION_MS,
  popTradeRemoval,
  pushTradeRemoval,
  tradeRemovalsToastMessage,
  type TradePlayerRemoval,
} from "./undo";

import { supabase } from "./supabase";
import { ChevronGlyph, CloseGlyph } from "./components/glyphs";

export const BROWSER_DASHBOARD_CACHE_KEY = "fantasy-rankings-dashboard-v7";

export function signOutForPersonalData(error: unknown): void {
  const message = error instanceof Error ? error.message : "";
  if (!supabase) return;
  if (message !== "Sign in required." && !message.includes("API 401")) return;
  localStorage.removeItem(BROWSER_DASHBOARD_CACHE_KEY);
  void supabase.auth.signOut();
}

export function tradeTotal(assets: TradeAsset[]): number {
  return assets.reduce((total, asset) => total + asset.value, 0);
}

export { waiverAdjustments } from "./lib/trade-adjustment";
export { RefreshIcon, SectionError };

export function showUndoToast(message: string, onUndo: () => void) {
  toast(message, {
    duration: UNDO_DURATION_MS,
    action: { label: "Undo", onClick: onUndo },
  });
}

type TradeRemoveUndoStack = {
  entries: TradePlayerRemoval[];
  suppressDismissClear: boolean;
  restore: ((entry: TradePlayerRemoval) => void) | null;
};

const tradeRemoveUndoStack: TradeRemoveUndoStack = {
  entries: [],
  suppressDismissClear: false,
  restore: null,
};

function presentTradeRemoveUndoToast() {
  const count = tradeRemoveUndoStack.entries.length;
  const onRestore = tradeRemoveUndoStack.restore;
  if (count <= 0 || !onRestore) {
    toast.dismiss(TRADE_REMOVE_TOAST_ID);
    return;
  }
  toast(tradeRemovalsToastMessage(count), {
    id: TRADE_REMOVE_TOAST_ID,
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: () => {
        const { next, popped } = popTradeRemoval(tradeRemoveUndoStack.entries);
        tradeRemoveUndoStack.entries = next;
        if (popped) onRestore(popped);
        if (tradeRemoveUndoStack.entries.length === 0) {
          tradeRemoveUndoStack.restore = null;
          toast.dismiss(TRADE_REMOVE_TOAST_ID);
          return;
        }
        // Action clicks dismiss the toast; keep one card with remaining undos.
        tradeRemoveUndoStack.suppressDismissClear = true;
        presentTradeRemoveUndoToast();
      },
    },
    onDismiss: () => {
      if (tradeRemoveUndoStack.suppressDismissClear) {
        tradeRemoveUndoStack.suppressDismissClear = false;
        return;
      }
      tradeRemoveUndoStack.entries = [];
      tradeRemoveUndoStack.restore = null;
    },
    onAutoClose: () => {
      tradeRemoveUndoStack.entries = [];
      tradeRemoveUndoStack.restore = null;
    },
  });
}

/** One merged toast for successive market-trade player removals. */
export function showTradePlayerRemoveUndoToast(
  entry: TradePlayerRemoval,
  onRestore: (entry: TradePlayerRemoval) => void,
) {
  tradeRemoveUndoStack.restore = onRestore;
  tradeRemoveUndoStack.entries = pushTradeRemoval(tradeRemoveUndoStack.entries, entry);
  presentTradeRemoveUndoToast();
}

export function clearTradePlayerRemoveUndoToast() {
  tradeRemoveUndoStack.suppressDismissClear = true;
  tradeRemoveUndoStack.entries = [];
  tradeRemoveUndoStack.restore = null;
  toast.dismiss(TRADE_REMOVE_TOAST_ID);
}

export const basePositionOrder: BasePosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export function isBoomBustPosition(position: string): position is BoomBustPosition {
  return position === "QB" || position === "RB" || position === "WR" || position === "TE";
}

export function positionsForFilter(filter: PositionFilter): BasePosition[] {
  if (filter === "ALL") return ["QB", "RB", "WR", "TE"];
  if (filter === "FLEX") return ["RB", "WR", "TE"];
  if (filter === "SUPER") return ["QB", "RB", "WR", "TE"];
  if (filter === "ROOKIES") return ["QB", "RB", "WR", "TE"];
  return [filter];
}

export function shortLeagueName(name: string): string {
  return name
    .replace("Tits Out for The Ladz XII (TWELVE😤)", "Ladz XII")
    .replace("C2C. The real superconference", "C2C Superconference")
    .replace("Hoe Ass Dynasty League", "Hoe Ass Dynasty");
}

export function formatProjectionPoints(value: number | null, _source?: PlayerSearchResult["projectionSource"]): string {
  return formatPoints(value);
}

export const projectionComponentFields: Partial<Record<BasePosition, ReadonlyArray<{ key: string; label: string }>>> = {
  QB: [
    { key: "pass_yd", label: "Pass yds" },
    { key: "pass_td", label: "Pass TD" },
    { key: "pass_int", label: "INT" },
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
  ],
  RB: [
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Rec yds" },
    { key: "rec_td", label: "Rec TD" },
  ],
  WR: [
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Rec yds" },
    { key: "rec_td", label: "Rec TD" },
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
  ],
  TE: [
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Rec yds" },
    { key: "rec_td", label: "Rec TD" },
    { key: "rush_yd", label: "Rush yds" },
    { key: "rush_td", label: "Rush TD" },
  ],
};

export const kickerComponentLabels: Record<string, string> = {
  fgm: "Field goals made",
  fgmiss: "Field goals missed",
  fgm_0_19: "FG made · 0–19",
  fgm_20_29: "FG made · 20–29",
  fgm_30_39: "FG made · 30–39",
  fgm_40_49: "FG made · 40–49",
  fgm_50_59: "FG made · 50–59",
  fgm_60p: "FG made · 60+",
  fgm_50p: "FG made · 50+",
  fgmiss_0_19: "FG missed · 0–19",
  fgmiss_20_29: "FG missed · 20–29",
  fgmiss_30_39: "FG missed · 30–39",
  fgmiss_40_49: "FG missed · 40–49",
  fgmiss_50_59: "FG missed · 50–59",
  fgmiss_60p: "FG missed · 60+",
  xpm: "Extra points made",
  xpmiss: "Extra points missed",
};

export const defenseComponentLabels: Record<string, string> = {
  sack: "Sacks",
  int: "Interceptions",
  fum_rec: "Fumble recoveries",
  def_td: "Defensive TDs",
  safe: "Safeties",
  blk_kick: "Blocked kicks",
  def_2pt: "Defensive 2-pt",
  st_td: "Return TDs",
  st_fum_rec: "ST fumble recoveries",
  pr_yd: "Punt return yds",
  kr_yd: "Kick return yds",
  pr_td: "Punt return TDs",
  kr_td: "Kick return TDs",
  pts_allow: "Points allowed",
  yds_allow: "Yards allowed",
};

export function projectionComponentsForPlayer(player: PlayerSearchResult): ProjectionComponent[] {
  const components = player.projectionComponents;
  if (!components || player.position === "DEF") return [];
  if (player.position === "K") {
    const preferredOrder = Object.keys(kickerComponentLabels);
    return Object.entries(components)
      .filter(([key, value]) => key in kickerComponentLabels && Number.isFinite(value))
      .sort(([a], [b]) => {
        const aIndex = preferredOrder.indexOf(a);
        const bIndex = preferredOrder.indexOf(b);
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex) || a.localeCompare(b);
      })
      .map(([key, value]) => ({
        key,
        label: kickerComponentLabels[key] ?? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value,
        isYards: /(?:^|_)yds?$/.test(key),
      }));
  }
  return (projectionComponentFields[player.position as BasePosition] ?? []).flatMap(({ key, label }) => {
    const value = components[key];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ key, label, value, isYards: key.endsWith("_yd") }]
      : [];
  });
}

export function matchupLabel(opponent: string | null, isAway: boolean | null | undefined): string {
  if (!opponent) return "";
  return `${isAway ? "@" : "vs"} ${opponent}`;
}

export function accessibleMatchupLabel(team: string | null, opponent: string | null, isAway: boolean | null | undefined, isBye: boolean): string {
  if (opponent) return `${team ?? "free agent"} ${isAway ? "at" : "versus"} ${opponent}`;
  return isBye ? `${team ?? "free agent"}, bye` : `${team ?? "free agent"}, matchup unavailable`;
}

export function decimalPlaces(value: number): number {
  const normalized = value.toString().toLowerCase();
  if (!normalized.includes("e")) return normalized.split(".")[1]?.length ?? 0;
  const [coefficient = "0", exponentText = "0"] = normalized.split("e");
  const exponent = Number(exponentText);
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  return Math.max(0, fractionLength - exponent);
}

export function forecastPoints(value: number | null, _players: RosterPlayer[]): string {
  return formatPoints(value);
}

export function comparablePlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function playerScore(player: RosterPlayer): { value: number | null; label: "PROJ" | "PTS" } {
  return displayedMatchupPoints(player);
}

export function matchupCell(player: RosterPlayer | undefined): RosterPlayer | undefined {
  if (!player || player.playerId === "0") return undefined;
  return player;
}

export function sleeperInjuryTag(status: string): string {
  const normalized = status.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  const labels: Record<string, string> = {
    questionable: "Q",
    doubtful: "D",
    out: "O",
    "injured reserve": "IR",
    ir: "IR",
    "physically unable to perform": "PUP",
    pup: "PUP",
    suspended: "SUS",
    suspension: "SUS",
    sus: "SUS",
    "non football injury": "NFI",
    "non football illness": "NFI",
    nfi: "NFI",
    inactive: "INA",
    covid: "COV",
    "covid 19": "COV",
  };
  return labels[normalized] ?? (status.length <= 4 ? status.toUpperCase() : status.slice(0, 1).toUpperCase());
}

export function DesignationBadge({
  code,
  label,
  title,
  tone = "neutral",
}: {
  code: string;
  label: string;
  title: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  return (
    <Badge variant={tone === "positive" ? "positive" : tone === "warning" ? "warning" : "secondary"} size="compact" className="status-badge" aria-label={label} title={title}>
      {code}
    </Badge>
  );
}

export const newsTimeLabel = newsAbsoluteTimeLabel;
export { newsItemTimeLabel, newsRelativeTimeLabel };

export function groupNewsItemsByPlayer(news: PlayerNews | undefined): Map<string, PlayerNewsItem[]> {
  const itemsByPlayer = new Map<string, PlayerNewsItem[]>();
  for (const run of news?.runs ?? []) {
    for (const item of run.items) {
      // Team/league X rows have null player_id — never attach to player cards.
      if (!item.playerId || item.scope === "team" || item.scope === "league") continue;
      const items = itemsByPlayer.get(item.playerId);
      if (items) items.push(item);
      else itemsByPlayer.set(item.playerId, [item]);
    }
  }
  return itemsByPlayer;
}


export function movementPercent(value: number, change: number | null): number | null {
  if (change === null) return null;
  const priorValue = value - change;
  if (priorValue <= 0) return change > 0 ? Number.POSITIVE_INFINITY : 0;
  return (change / priorValue) * 100;
}

export function movementLabel(percent: number | null): string {
  if (percent === null) return "No 30-day history";
  if (!Number.isFinite(percent)) return "Up from zero over 30 days";
  return `${formatPercent(percent, { sign: "exceptZero" })} over 30 days`;
}

/**
 * Compact freshness/status strip for the dashboard header: our build time
 * ("Updated …"), the underlying source times (rankings / market values), the
 * "* est" legend for fallback projections, and — when the build was partial —
 * an expandable list naming exactly what is unavailable.
 */
/* Expandable "what's unavailable" list rendered as its own block under the week
 * line so it never competes for width inside the flex header. */
export function DashboardPartialNotes({ dashboard }: { dashboard: Dashboard }) {
  const info = useMemo(() => dashboardFreshness(dashboard, Date.now()), [dashboard]);
  if (!info.partial) return null;
  return (
    <details className="data-notes">
      <summary>Part of this view is unavailable</summary>
      <ul>{info.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </details>
  );
}

export function canonicalNflTeam(team: string | null): string | null {
  if (!team) return null;
  const normalized = team.trim().toUpperCase();
  if (normalized === "JAC") return "JAX";
  if (normalized === "WSH") return "WAS";
  if (normalized === "LA") return "LAR";
  return normalized;
}

export function pfnNumber(row: PfnRow | undefined, key: string): number | null {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function pfnSortedMetricValues(table: PfnTable | null, key: string, higherIsBetter = true): number[] | null {
  if (!table) return null;
  return table.rows
    .map((row) => pfnNumber(row, key))
    .filter((value): value is number => value !== null)
    .sort((a, b) => higherIsBetter ? b - a : a - b);
}

export function pfnRankForRow(table: PfnTable | null, row: PfnRow | undefined, key: string, higherIsBetter = true): number | null {
  const value = pfnNumber(row, key);
  if (value === null) return null;
  const values = pfnSortedMetricValues(table, key, higherIsBetter);
  if (!values) return null;
  const index = values.findIndex((candidate) => candidate === value);
  return index < 0 ? null : index + 1;
}

export function pfnDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/** The six rows on the matchup card: PFN's grade and scoring, the pass and run grades, and the two efficiency rates. */
export const matchupStatConfigs: ReadonlyArray<MatchupStatConfig> = [
  { label: "Grade", offKey: "grade", defKey: "grade", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: true },
  { label: "Points / G", offKey: "ppg", defKey: "pts_allowed_per_game", format: (value) => formatPoints(value), offHigher: true, defHigher: false },
  { label: "Pass grade", offKey: "pass", defKey: "pass", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: true },
  { label: "Run grade", offKey: "run", defKey: "run", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: true },
  { label: "EPA / play", offKey: "epa_per_play", defKey: "epa_per_play", format: (value) => formatDecimal(value, 2, { sign: "always" }), offHigher: true, defHigher: false },
  { label: "Success rate", offKey: "success_pct", defKey: "success_pct", format: (value) => formatPercent(value), offHigher: true, defHigher: false },
];

export function matchupGrade(table: PfnTable | null, row: PfnRow | undefined, key = "grade", higherIsBetter = true): MatchupGrade {
  return {
    value: pfnNumber(row, key),
    rank: key === "grade" ? row?.rank ?? null : pfnRankForRow(table, row, key, higherIsBetter),
  };
}

type MatchupPairing = { leftUnit: string; rightUnit: string; leftLabel: string; rightLabel: string };

/** How far one side leads the other in league rank: positive when the left side is ahead. */
function matchupEdge(left: MatchupGrade, right: MatchupGrade): number | null {
  return left.rank !== null && right.rank !== null ? right.rank - left.rank : null;
}

/** One stat: the two units' ranks on one #1-to-32 line, with the edge in ranks beside the name. */
function MatchupStatRow({ stat, pairing, left, right }: { stat: MatchupStatConfig; pairing: MatchupPairing; left: MatchupGrade; right: MatchupGrade }) {
  const leftValue = left.value === null ? "—" : stat.format(left.value);
  const rightValue = right.value === null ? "—" : stat.format(right.value);
  const edge = matchupEdge(left, right);
  const allowed = (unit: string) => (stat.label === "Points / G" && unit === "DEF" ? " allowed" : "");
  return (
    <div className="matchup-stat-row">
      <div className="matchup-stat-row-head">
        <strong>{stat.label}</strong>
        {edge !== null && edge !== 0 ? <strong className={`matchup-stat-gap ${edge > 0 ? "is-for" : "is-against"}`}>{edge > 0 ? "+" : "−"}{Math.abs(edge)}</strong> : null}
      </div>
      {left.rank !== null && right.rank !== null ? (
        <EdgeStrip
          first={{ label: `${pairing.leftUnit} #${left.rank} · ${leftValue}${allowed(pairing.leftUnit)}`, rank: left.rank }}
          second={{ label: `${pairing.rightUnit} #${right.rank} · ${rightValue}${allowed(pairing.rightUnit)}`, rank: right.rank }}
          ariaLabel={`${stat.label}: ${pairing.leftLabel} ranks ${left.rank} (${leftValue}), ${pairing.rightLabel} ranks ${right.rank} (${rightValue})${edge ? `, ${edge > 0 ? pairing.leftLabel : pairing.rightLabel} has the edge by ${Math.abs(edge)} ranks` : ""}`}
        />
      ) : (
        <div className="matchup-stat-unranked">{pairing.leftUnit} {leftValue} · {pairing.rightUnit} {rightValue}</div>
      )}
    </div>
  );
}

/** Weekday + date from the schedule row's raw strings ("Sun, Oct 26").
 * Fallback for games whose kickoff time cannot be parsed: the game card's
 * own label degrades to "—" in exactly that case, so it cannot be reused. */
function kickoffDateLabel(row: { weekday: string; gameday: string }): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.gameday);
  if (!match || !row.weekday) return null;
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  return `${row.weekday.slice(0, 3)}, ${date}`;
}

export function MatchupDataModal({ matchup, season, week, onClose, onOpenTeam, toolLinks, gameLines, gameLinesLink, suspended = false }: { matchup: MatchupSelection; season: number; week: number; onClose: () => void; onOpenTeam?: (team: string) => void; toolLinks?: ToolLinkItem[]; gameLines?: readonly TeamGameLineLike[]; /** Badge that opens this game in Tools → Game lines. */ gameLinesLink?: CrossToolLink | null; suspended?: boolean }) {
  const [pairingTab, setPairingTab] = useState<"team-offense" | "team-defense">("team-offense");
  const tablesQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const gamesQuery = useQuery({
    queryKey: ["nflverse-game-lines", season, week],
    queryFn: () => loadNflverseGameLines(season, week),
    staleTime: GAME_LINES_STALE_MS,
    gcTime: GAME_LINES_STALE_MS * 2,
    retry: false,
  });
  const tables = tablesQuery.data?.tables;
  const offense = tables?.offense ?? null;
  const defense = tables?.defense ?? null;
  const teamCode = canonicalNflTeam(matchup.team);
  const opponentCode = canonicalNflTeam(matchup.opponent);
  const teamCodeLabel = teamCode && teamCode.length <= 4 ? teamCode : matchup.team;
  const opponentCodeLabel = opponentCode && opponentCode.length <= 4 ? opponentCode : matchup.opponent;
  const gameCard = teamCode && opponentCode
    ? (gamesQuery.data?.cards ?? []).find((card) => {
        const away = canonicalNflTeam(card.awayTeam);
        const home = canonicalNflTeam(card.homeTeam);
        return (away === teamCode && home === opponentCode) || (away === opponentCode && home === teamCode);
      }) ?? null
    : null;
  const gameRow = gameCard
    ? (gamesQuery.data?.weekRows ?? []).find((row) => row.gameId === gameCard.gameId) ?? null
    : null;
  const kickoffLabel = gameCard
    ? gameCard.kickoffAtMs !== null
      ? `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(gameCard.kickoffAtMs))} PT`
      : gameRow
        ? kickoffDateLabel(gameRow)
        : null
    : null;
  // Several surfaces build matchup selections without a phase. The
  // nflverse card knows whether the game is final, so derive finality
  // here and every entry point renders the same card for the same game.
  const isFinalGame = matchup.gamePhase === "final" || gameCard?.isFinal === true;
  const gameStatusLabel = isFinalGame ? "Final" : matchup.gamePhase === "live" ? "Live" : matchup.gamePhase === "pregame" ? "Not started" : null;
  const scoreQuery = useQuery({
    queryKey: ["nfl-matchup-box-score", matchup.team, matchup.opponent, season, week],
    queryFn: () => api.getMatchupBoxScore({ team: matchup.team, opponent: matchup.opponent, season, week }),
    enabled: isFinalGame,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const lineSummary = teamCode && opponentCode && !isFinalGame
    ? gameLineSummary(gameLines ?? [], teamCode, opponentCode)
    : null;
  const myLine = teamCode && opponentCode
    ? (gameLines ?? []).find((line) => line.team === teamCode && line.opponent === opponentCode) ?? null
    : null;
  const theirLine = teamCode && opponentCode
    ? (gameLines ?? []).find((line) => line.team === opponentCode && line.opponent === teamCode) ?? null
    : null;
  const showImpliedStrip = !isFinalGame && (
    myLine?.impliedPoints != null || theirLine?.impliedPoints != null || myLine?.spread != null || myLine?.total != null
  );
  const impliedTotal = (myLine?.impliedPoints ?? 0) + (theirLine?.impliedPoints ?? 0);
  const impliedSplit = myLine?.impliedPoints != null && theirLine?.impliedPoints != null && impliedTotal > 0
    ? { team: Math.round((myLine.impliedPoints / impliedTotal) * 100), opponent: 100 - Math.round((myLine.impliedPoints / impliedTotal) * 100) }
    : null;
  const findRow = (table: PfnTable | null, code: string | null) => table?.rows.find((row) => canonicalNflTeam(row.team) === code);
  const teamRows = {
    offense: findRow(offense, teamCode),
    defense: findRow(defense, teamCode),
  };
  const opponentRows = {
    offense: findRow(offense, opponentCode),
    defense: findRow(defense, opponentCode),
  };
  const matchupPairings = [
    {
      id: "team-offense",
      leftUnit: "OFF",
      rightUnit: "DEF",
      leftLabel: `${matchup.team} offense`,
      rightLabel: `${matchup.opponent} defense`,
      leftRow: teamRows.offense,
      rightRow: opponentRows.defense,
      leftSide: "offense" as const,
      rightSide: "defense" as const,
    },
    {
      id: "team-defense",
      leftUnit: "DEF",
      rightUnit: "OFF",
      leftLabel: `${matchup.team} defense`,
      rightLabel: `${matchup.opponent} offense`,
      leftRow: teamRows.defense,
      rightRow: opponentRows.offense,
      leftSide: "defense" as const,
      rightSide: "offense" as const,
    },
  ];
  const score = scoreQuery.data;

  return (
    <ModalCard onClose={onClose} enabled={!suspended} labelledBy="matchup-card-title" backdropClassName="matchup-card-backdrop" className="matchup-data-card">
          <div className="matchup-data-header matchup-data-header-minimal">
            <h2 id="matchup-card-title" className="sr-only">{matchup.team} {matchup.isAway ? "@" : "vs"} {matchup.opponent}</h2>
            <button type="button" onClick={onClose} aria-label="Close matchup data"><CloseGlyph /></button>
          </div>
          <p className="matchup-eyebrow">Week {week} · NFL</p>
          <div className="matchup-title-row" role="group" aria-label={`${matchup.team} versus ${matchup.opponent}`}>
            {[matchup.team, matchup.opponent].map((name, index) => (
              <Fragment key={name}>
                {index === 1 ? <span className="matchup-title-at" aria-hidden="true">{matchup.isAway ? "@" : "vs"}</span> : null}
                {onOpenTeam ? (
                  <button type="button" className="matchup-team-title" aria-label={`View ${name} team data`} aria-haspopup="dialog" onClick={() => onOpenTeam(name)}>
                    {name}<i aria-hidden="true"><ChevronGlyph /></i>
                  </button>
                ) : <strong className="matchup-team-title">{name}</strong>}
              </Fragment>
            ))}
          </div>
          <div className="matchup-chip-row">
            {gameLinesLink ? (
              <CrossToolBadge
                link={gameLinesLink}
                label={kickoffLabel ? `Game lines · ${kickoffLabel}` : "Game lines"}
                ariaLabel={`Open ${matchup.team} vs ${matchup.opponent} in Game lines`}
                className="matchup-game-lines-badge"
              />
            ) : kickoffLabel ? <span className="depth-chart-tag">{kickoffLabel}</span> : null}
            {gameStatusLabel ? <Badge variant="secondary" size="compact" className="status-badge">{gameStatusLabel}</Badge> : null}
          </div>
          {showImpliedStrip ? (
            <section className="matchup-implied" aria-label="Weekly implied totals">
              <div className="matchup-implied-grid">
                <div className="matchup-implied-team">
                  <span>{matchup.team} implied</span>
                  <strong>{formatImpliedTotal(myLine?.impliedPoints ?? null)}</strong>
                </div>
                <div className="matchup-implied-market">
                  {myLine?.spread != null ? (
                    <span>
                      {myLine.spread === 0
                        ? "PK"
                        : `${myLine.spread < 0 ? matchup.team : matchup.opponent} −${formatImpliedTotal(Math.abs(myLine.spread))}`}
                    </span>
                  ) : null}
                  {myLine?.total != null ? <span>O/U {formatImpliedTotal(myLine.total)}</span> : null}
                </div>
                <div className="matchup-implied-team is-opponent">
                  <span>{matchup.opponent} implied</span>
                  <strong>{formatImpliedTotal(theirLine?.impliedPoints ?? null)}</strong>
                </div>
              </div>
              {impliedSplit ? (
                <>
                  <div className="matchup-implied-split" role="img" aria-label={`Implied points split, ${impliedSplit.team} percent ${matchup.team}`}>
                    <i style={{ flex: impliedSplit.team }} />
                    <i style={{ flex: impliedSplit.opponent }} />
                  </div>
                  <p className="matchup-implied-caption">Implied points split <b>{impliedSplit.team} / {impliedSplit.opponent}</b></p>
                </>
              ) : null}
            </section>
          ) : null}
          {toolLinks ? <ToolLinks ariaLabel={`Open ${matchup.team} and ${matchup.opponent} in a tool`} links={toolLinks} /> : null}
          {lineSummary && !showImpliedStrip ? <p className="matchup-game-line"><span>Line</span> {lineSummary}</p> : null}

          {isFinalGame ? (
            scoreQuery.isPending ? <div className="matchup-card-status" role="status"><RefreshIcon spinning /> Loading box score…</div>
              : score?.status === "owner_required" ? (
                <div className="matchup-card-status" role="status">Live box scores are available when the owner opens this matchup.</div>
              ) : scoreQuery.isError || score?.status !== "available" || !score.game ? (
                <SectionError title="Final box score didn’t load." onRetry={() => { void scoreQuery.refetch(); }} retrying={scoreQuery.isFetching} compact />
              ) : (
                <section className="matchup-box-score" aria-label="Final box score">
                  <span>Final</span>
                  <strong>{score.game.score}</strong>
                  <small>{score.game.title}</small>
                  {score.game.lineScore.length === 2 && score.game.lineScore[0].periods.length > 0 ? (
                    <table className="matchup-box-score-table">
                      <thead>
                        <tr>
                          <th scope="col"><span className="sr-only">Team</span></th>
                          {score.game.lineScore[0].periods.map((_, periodIndex) => (
                            <th key={periodIndex} scope="col">{periodIndex < 4 ? `Q${periodIndex + 1}` : periodIndex === 4 ? "OT" : `${periodIndex - 3}OT`}</th>
                          ))}
                          <th scope="col">T</th>
                        </tr>
                      </thead>
                      <tbody>
                        {score.game.lineScore.map((line) => (
                          <tr key={line.team} className={line.winner ? "is-winner" : undefined}>
                            <th scope="row">{line.team}</th>
                            {line.periods.map((points, periodIndex) => <td key={periodIndex}>{points}</td>)}
                            <td className="matchup-box-score-total">{line.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </section>
              )
          ) : null}
          {tablesQuery.isPending ? (
            <div className="matchup-card-status" role="status"><RefreshIcon spinning /> Loading PFN grades…</div>
          ) : tablesQuery.isError ? (
            <SectionError title="PFN matchup data didn’t load." onRetry={() => { void tablesQuery.refetch(); }} retrying={tablesQuery.isFetching} compact />
          ) : (
            <>
              {/* With neither table there is nothing to rank; show only the notice below, not six rows of dashes. */}
              {offense || defense ? (
              <section className="matchup-grade-section" aria-label="Matchups">
                <div className="matchup-stat-groups" aria-label={`${matchup.team} and ${matchup.opponent} PFN offense versus defense matchups`}>
                  <Tabs value={pairingTab} onValueChange={(value) => setPairingTab(value as "team-offense" | "team-defense")} className="matchup-pairing-tabs">
                    <TabsList aria-label="Matchup side">
                      <TabsTrigger id="matchup-team-offense-tab" value="team-offense" aria-controls="matchup-team-offense-panel">{teamCodeLabel} {matchupPairings[0].leftUnit} vs {opponentCodeLabel} {matchupPairings[0].rightUnit}</TabsTrigger>
                      <TabsTrigger id="matchup-team-defense-tab" value="team-defense" aria-controls="matchup-team-defense-panel">{teamCodeLabel} {matchupPairings[1].leftUnit} vs {opponentCodeLabel} {matchupPairings[1].rightUnit}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {matchupPairings.filter((pairing) => pairing.id === pairingTab).map((pairing) => {
                    const rows = matchupStatConfigs.map((stat) => ({
                      stat,
                      left: pairing.leftSide === "offense"
                        ? matchupGrade(offense, pairing.leftRow, stat.offKey, stat.offHigher)
                        : matchupGrade(defense, pairing.leftRow, stat.defKey, stat.defHigher),
                      right: pairing.rightSide === "offense"
                        ? matchupGrade(offense, pairing.rightRow, stat.offKey, stat.offHigher)
                        : matchupGrade(defense, pairing.rightRow, stat.defKey, stat.defHigher),
                    }));
                    const edges = rows.map((row) => matchupEdge(row.left, row.right)).filter((edge): edge is number => edge !== null);
                    const leftEdges = edges.filter((edge) => edge > 0).length;
                    const rightEdges = edges.filter((edge) => edge < 0).length;
                    return (
                      <section className="matchup-pairing" key={pairing.id} id={`matchup-${pairing.id}-panel`} role="tabpanel" aria-labelledby={`matchup-${pairing.id}-tab`}>
                        {edges.length > 0 ? (
                          <div className="matchup-edge-summary">
                            <strong className="matchup-edge-count">{leftEdges}<span>–</span>{rightEdges}</strong>
                            <div>
                              <p>{pairing.leftLabel} has the edge in {leftEdges} of {edges.length}</p>
                              <div className="matchup-edge-segments" role="img" aria-label={`${leftEdges} edges to ${pairing.leftLabel}, ${rightEdges} to ${pairing.rightLabel}`}>
                                {edges.map((edge, index) => <i key={index} className={edge > 0 ? "is-for" : edge < 0 ? "is-against" : "is-even"} />)}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        <p className="matchup-edge-legend">
                          <span><i className="is-first" aria-hidden="true" />{pairing.leftLabel}, label above</span>
                          <span><i className="is-second" aria-hidden="true" />{pairing.rightLabel}, label below</span>
                        </p>
                        {rows.map(({ stat, left, right }) => (
                          <MatchupStatRow key={stat.label} stat={stat} pairing={pairing} left={left} right={right} />
                        ))}
                        <div className="matchup-edge-scale" aria-hidden="true"><span>#1 · better</span><span>League rank of 32</span><span>#32</span></div>
                      </section>
                    );
                  })}
                </div>
              </section>
              ) : null}
              {!offense || !defense ? <SectionError title="PFN matchup data is incomplete." onRetry={() => { void tablesQuery.refetch(); }} retrying={tablesQuery.isFetching} compact /> : null}
            </>
          )}
    </ModalCard>
  );
}

export function NewsCardModal({ item, onClose }: { item: PlayerNewsItem; onClose: () => void }) {
  const isArticle = item.source === "article";
  const nowMs = useMinuteNow(isArticle);
  const outletLabel = item.author && !isArticle
    ? `${item.sourceLabel} · ${item.author}`
    : item.sourceLabel;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="news-card-modal"
        {...(!item.roleContext ? { "aria-describedby": undefined } : {})}
      >
        <DialogCloseButton label="Close news card" />
        <DialogHeader className="news-card-header pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <NewsTypeBadges item={item} />
            <time className="text-xs text-muted-foreground">{newsItemTimeLabel(item, nowMs)}</time>
          </div>
        </DialogHeader>
        <DialogTitle id="ticker-news-headline" className="news-card-headline">{item.change}</DialogTitle>
        {item.roleContext ? (
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">{item.roleContext}</DialogDescription>
        ) : null}
        {isHttpOrHttpsUrl(item.sourceUrl) ? (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">{outletLabel}<span className="sr-only"> (opens in a new tab)</span></a>
        ) : (
          <span>{outletLabel}</span>
        )}
      </DialogContent>
    </Dialog>
  );
}

