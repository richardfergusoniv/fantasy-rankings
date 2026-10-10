import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayedMatchupPoints } from "../../api/_lib/lineup-optimizer";
import { api } from "./api";
import type {
  BasePosition,
  BoomBustPosition,
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
import { formatDecimal, formatPercent } from "./lib/format-number";
import { ModalPortal, useDialogFocusTrap } from "./shared";
import { UNDO_DURATION_MS } from "./undo";

import { supabase } from "./supabase";

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

export function showUndoToast(message: string, onUndo: () => void) {
  toast(message, {
    duration: UNDO_DURATION_MS,
    action: { label: "Undo", onClick: onUndo },
  });
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

export function formatProjectionPoints(value: number | null, source?: PlayerSearchResult["projectionSource"]): string {
  if (value === null) return "—";
  return source === "vegas" ? value.toString() : formatDecimal(value, 1);
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

export function forecastPoints(value: number | null, players: RosterPlayer[]): string {
  if (value === null) return "—";
  const vegasPrecision = players.reduce((precision, player) => (
    player.gamePhase !== "final" && player.projectionSource === "vegas" && player.projection !== null
      ? Math.max(precision, decimalPlaces(player.projection))
      : precision
  ), 0);
  return vegasPrecision > 0 ? formatDecimal(value, vegasPrecision) : formatProjectionPoints(value);
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
  tone?: "neutral" | "positive";
}) {
  return (
    <Badge variant={tone === "positive" ? "positive" : "secondary"} size="compact" className="injury" aria-label={label} title={title}>
      {code}
    </Badge>
  );
}

export function newsTimeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function groupNewsItemsByPlayer(news: PlayerNews | undefined): Map<string, PlayerNewsItem[]> {
  const itemsByPlayer = new Map<string, PlayerNewsItem[]>();
  for (const run of news?.runs ?? []) {
    for (const item of run.items) {
      const items = itemsByPlayer.get(item.playerId);
      if (items) items.push(item);
      else itemsByPlayer.set(item.playerId, [item]);
    }
  }
  return itemsByPlayer;
}

export function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg className={spinning ? "spin" : ""} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.3 9A7 7 0 0 0 6.5 6.5L4 9m16 6-2.5 2.5A7 7 0 0 1 5.7 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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
  const rounded = Math.round(percent);
  return `${rounded > 0 ? "+" : ""}${rounded}% over 30 days`;
}

export function SectionError({ title, onRetry, retrying = false, compact = false }: { title: string; onRetry: () => void; retrying?: boolean; compact?: boolean }) {
  return (
    <div className={`section-error${compact ? " compact" : ""}`} role="alert">
      <strong>{title}</strong>
      <Button type="button" variant="outline" onClick={onRetry} disabled={retrying}>
        <RefreshIcon spinning={retrying} /> Retry
      </Button>
    </div>
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

export const matchupStatConfigs: ReadonlyArray<MatchupStatConfig> = [
  { label: "Grade", offKey: "grade", defKey: "grade", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: true },
  { label: "Scoring", offKey: "ppg", defKey: "pts_allowed_per_game", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: false },
  { label: "Pass", offKey: "pass", defKey: "pass", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: true },
  { label: "Run", offKey: "run", defKey: "run", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: true },
  { label: "EPA/Play", offKey: "epa_per_play", defKey: "epa_per_play", format: (value) => formatDecimal(value, 2, { sign: "always" }), offHigher: true, defHigher: false },
  { label: "Yds/Play", offKey: "yds_per_play", defKey: "yds_per_play", format: (value) => formatDecimal(value, 1), offHigher: true, defHigher: false },
  { label: "Success%", offKey: "success_pct", defKey: "success_pct", format: (value) => formatPercent(value, 1), offHigher: true, defHigher: false },
  { label: "Expl%", offKey: "expl_pct", defKey: "expl_pct", format: (value) => formatPercent(value, 1), offHigher: true, defHigher: false },
];

export function matchupGrade(table: PfnTable | null, row: PfnRow | undefined, key = "grade", higherIsBetter = true): MatchupGrade {
  return {
    value: pfnNumber(row, key),
    rank: key === "grade" ? row?.rank ?? null : pfnRankForRow(table, row, key, higherIsBetter),
  };
}

export function MatchupDataModal({ matchup, season, week, onClose }: { matchup: MatchupSelection; season: number; week: number; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);
  const tablesQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const scoreQuery = useQuery({
    queryKey: ["nfl-matchup-box-score", matchup.team, matchup.opponent, season, week],
    queryFn: () => api.getMatchupBoxScore({ team: matchup.team, opponent: matchup.opponent, season, week }),
    enabled: matchup.gamePhase === "final",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const tables = tablesQuery.data?.tables;
  const offense = tables?.offense ?? null;
  const defense = tables?.defense ?? null;
  const offensiveLine = tables?.["offensive-line"] ?? null;
  const teamCode = canonicalNflTeam(matchup.team);
  const opponentCode = canonicalNflTeam(matchup.opponent);
  const findRow = (table: PfnTable | null, code: string | null) => table?.rows.find((row) => canonicalNflTeam(row.team) === code);
  const teamRows = {
    offense: findRow(offense, teamCode),
    defense: findRow(defense, teamCode),
  };
  const opponentRows = {
    offense: findRow(offense, opponentCode),
    defense: findRow(defense, opponentCode),
  };
  const teamOffSos = pfnNumber(teamRows.offense, "sos");
  const teamDefSos = pfnNumber(teamRows.defense, "sos");
  const oppOffSos = pfnNumber(opponentRows.offense, "sos");
  const oppDefSos = pfnNumber(opponentRows.defense, "sos");
  const teamOffSosRank = pfnRankForRow(offense, teamRows.offense, "sos");
  const teamDefSosRank = pfnRankForRow(defense, teamRows.defense, "sos");
  const oppOffSosRank = pfnRankForRow(offense, opponentRows.offense, "sos");
  const oppDefSosRank = pfnRankForRow(defense, opponentRows.defense, "sos");
  const sosBadgeClass = (rank: number | null): string => (
    rank !== null && rank <= 10 ? " sos-tough" : rank !== null && rank >= 23 ? " sos-soft" : ""
  );
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
  const matchupStatGroups = matchupStatConfigs.map((stat) => ({
    ...stat,
    pairings: matchupPairings.map((pairing) => ({
      ...pairing,
      left: pairing.leftSide === "offense"
        ? matchupGrade(offense, pairing.leftRow, stat.offKey, stat.offHigher)
        : matchupGrade(defense, pairing.leftRow, stat.defKey, stat.defHigher),
      right: pairing.rightSide === "offense"
        ? matchupGrade(offense, pairing.rightRow, stat.offKey, stat.offHigher)
        : matchupGrade(defense, pairing.rightRow, stat.defKey, stat.defHigher),
    })),
  }));
  const fetchedAt = offensiveLine?.fetched_at ?? offense?.fetched_at ?? defense?.fetched_at ?? null;
  const score = scoreQuery.data;

  return (
    <ModalPortal>
      <div className="matchup-card-backdrop" onClick={onClose}>
        <article ref={dialogRef} className="matchup-data-card" role="dialog" aria-modal="true" aria-labelledby="matchup-card-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <header className="matchup-data-header">
            <div>
              <h2 id="matchup-card-title">{matchup.team} {matchup.isAway ? "@" : "vs"} {matchup.opponent}</h2>
              <span>{fetchedAt ? `PFN grades · ${pfnDateLabel(fetchedAt)}` : "PFN matchup grades"}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close matchup data">×</button>
          </header>

          {matchup.gamePhase === "final" ? (
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
                  {score.game.sourceUrl ? <a href={score.game.sourceUrl} target="_blank" rel="noreferrer">{score.game.sourceLabel ?? "Box score source"}<span className="sr-only"> (opens in a new tab)</span></a> : null}
                </section>
              )
          ) : tablesQuery.isPending ? (
            <div className="matchup-card-status" role="status"><RefreshIcon spinning /> Loading PFN grades…</div>
          ) : tablesQuery.isError ? (
            <SectionError title="PFN matchup data didn’t load." onRetry={() => { void tablesQuery.refetch(); }} retrying={tablesQuery.isFetching} compact />
          ) : (
            <>
              <section className="matchup-grade-section" aria-labelledby="offense-defense-heading">
                <h3 id="offense-defense-heading">Matchups</h3>
                <div className="matchup-stat-groups" aria-label={`${matchup.team} and ${matchup.opponent} PFN offense versus defense matchups`}>
                  <div className="matchup-stat-columns" aria-label={`Left column ${matchup.team}; right column ${matchup.opponent}`}>
                    <div className="matchup-stat-team">
                      <strong>{matchup.team}</strong>
                      <span className={`matchup-reference-tag${sosBadgeClass(teamOffSosRank)}`}>OFF SOS: {teamOffSos === null ? "—" : formatDecimal(teamOffSos, 1)}</span>
                      <span className={`matchup-reference-tag${sosBadgeClass(teamDefSosRank)}`}>DEF SOS: {teamDefSos === null ? "—" : formatDecimal(teamDefSos, 1)}</span>
                    </div>
                    <div className="matchup-stat-team">
                      <strong>{matchup.opponent}</strong>
                      <span className={`matchup-reference-tag${sosBadgeClass(oppOffSosRank)}`}>OFF SOS: {oppOffSos === null ? "—" : formatDecimal(oppOffSos, 1)}</span>
                      <span className={`matchup-reference-tag${sosBadgeClass(oppDefSosRank)}`}>DEF SOS: {oppDefSos === null ? "—" : formatDecimal(oppDefSos, 1)}</span>
                    </div>
                  </div>
                  {matchupStatGroups.map((stat) => (
                    <div className="matchup-stat-group" key={stat.label}>
                      <div className="comparison-metric-label"><strong>{stat.label}</strong></div>
                      {stat.pairings.map((pairing) => {
                        const leftWins = pairing.left.rank !== null && pairing.right.rank !== null && pairing.left.rank < pairing.right.rank;
                        const rightWins = pairing.left.rank !== null && pairing.right.rank !== null && pairing.right.rank < pairing.left.rank;
                        const leftPoints = pairing.left.rank === null ? null : 33 - pairing.left.rank;
                        const rightPoints = pairing.right.rank === null ? null : 33 - pairing.right.rank;
                        const pointsTotal = leftPoints !== null && rightPoints !== null ? leftPoints + rightPoints : 0;
                        const leftShare = leftPoints !== null && rightPoints !== null && pointsTotal > 0
                          ? (leftPoints / pointsTotal) * 100
                          : 50;
                        const rightShare = 100 - leftShare;
                        const leftValue = pairing.left.value === null ? "—" : stat.format(pairing.left.value);
                        const rightValue = pairing.right.value === null ? "—" : stat.format(pairing.right.value);
                        const leftRank = pairing.left.rank === null ? "rank unavailable" : `rank #${pairing.left.rank}`;
                        const rightRank = pairing.right.rank === null ? "rank unavailable" : `rank #${pairing.right.rank}`;
                        const edgeLabel = leftWins
                          ? `${pairing.leftLabel} has the edge`
                          : rightWins
                            ? `${pairing.rightLabel} has the edge`
                            : pairing.left.rank === null || pairing.right.rank === null
                              ? "the edge is unavailable"
                              : "neither side has the edge";
                        return (
                          <div className="comparison-bar-group" key={`${stat.label}-${pairing.id}`}>
                            <div className="comparison-values" aria-hidden="true">
                              <span>
                                <span className="matchup-unit-label">{pairing.leftUnit}</span>
                                <strong className="matchup-stat-value">{leftValue}</strong>
                                {pairing.left.rank === null ? null : <small>#{pairing.left.rank}</small>}
                              </span>
                              <span>
                                <span className="matchup-unit-label">{pairing.rightUnit}</span>
                                <strong className="matchup-stat-value">{rightValue}</strong>
                                {pairing.right.rank === null ? null : <small>#{pairing.right.rank}</small>}
                              </span>
                            </div>
                            <div className="comparison-stacked-bar" role="img" aria-label={`${stat.label}, ${pairing.leftSide} versus ${pairing.rightSide}: ${pairing.leftLabel}, ${leftValue}, ${leftRank}; ${pairing.rightLabel}, ${rightValue}, ${rightRank}; ${edgeLabel}.`}>
                              <i className={`comparison-segment left${leftWins ? " winner" : ""}`} style={{ width: `${leftShare}%` }} aria-hidden="true" />
                              <i className={`comparison-segment right${rightWins ? " winner" : ""}`} style={{ width: `${rightShare}%` }} aria-hidden="true" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>
              {!offense || !defense ? <SectionError title="PFN matchup data is incomplete." onRetry={() => { void tablesQuery.refetch(); }} retrying={tablesQuery.isFetching} compact /> : null}
            </>
          )}
        </article>
      </div>
    </ModalPortal>
  );
}

export function NewsCardModal({ item, onClose }: { item: PlayerNewsItem; onClose: () => void }) {
  const severity = item.newsType === "headline"
    ? item.playerId === "league" ? "Breaking" : "League news"
    : item.newsType === "waiver" ? "Waiver signal" : "Roster update";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="news-card-modal">
        <DialogCloseButton label="Close news card" />
        <DialogHeader className="news-card-header pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.newsType === "headline" ? "negative" : "secondary"}>{severity}</Badge>
            <time className="text-xs text-muted-foreground">{item.sourcePublishedAt ? newsTimeLabel(item.sourcePublishedAt) : "Recent"}</time>
          </div>
        </DialogHeader>
        <DialogTitle id="ticker-news-headline" className="news-card-headline">{item.change}</DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-muted-foreground">{item.roleContext}</DialogDescription>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel}<span className="sr-only"> (opens in a new tab)</span></a>
      </DialogContent>
    </Dialog>
  );
}

