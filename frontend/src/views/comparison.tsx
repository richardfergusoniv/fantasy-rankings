import { useEffect, useMemo, useRef, useState } from "react";
import { RangeBar, rangeDomain, type ProjectionRange } from "../components/range-bar";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MatchupSelection } from "../dashboard-types";
import { GapBar } from "../components/gap-bar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RankStrip } from "../components/rank-strip";
import { handcuffStarter } from "../lib/handcuff";
import { positionTierLabel } from "../lib/position-tier";
import { useProfileTag } from "../lib/use-profile-tag";
import { formatCompactCount, formatDecimal } from "../lib/format-number";
import { comparisonShortName } from "../lib/short-name";
import { OutcomeBox, outcomeDomain, type OutcomeSummary } from "../components/outcome-box";
import { DepthChangeMark, depthChange, MatchupTag, ProfileChips, SegmentedControl, type StrengthOfScheduleEntryLike } from "../shared";
import { isHiddenHalfPointPropStat, propStatDef } from "../../../api/_lib/prop-line-reads";
import { EmptyState } from "../components/state-blocks";
import { CloseGlyph } from "../components/glyphs";
import {
  analyticsMetricsForLeague,
  basePositionOrder,
  buildWeeklyEntities,
  comparablePlayerName,
  isSamePlayer,
  metricDisplay,
  metricSourceValue,
  redundantComparisonProjectionKeys,
  teamContextMetrics,
  weeklyMetrics,
  type AnalyticsWindow,
  type BasePosition,
  type Dashboard,
  type League,
  type Metric,
  type PlayerSelection,
  type ToolDataset,
} from "../AnalyticsViews";
type ComparisonEntity = PlayerSelection & {
  id: string;
  opponent: string | null;
  isAway: boolean | null;
  isBye: boolean;
  gameTime: string | null;
  gamePhase: MatchupSelection["gamePhase"];
  values: Record<string, number>;
};

type ComparisonMetricValue = {
  value: number;
};

function comparisonValue(entity: ComparisonEntity | undefined, metric: Metric): ComparisonMetricValue | null {
  if (!entity) return null;
  const value = metricSourceValue(entity.values, metric);
  return typeof value === "number" && Number.isFinite(value) ? { value } : null;
}

type ComparisonRow = {
  metric: Metric;
  leftValue: ComparisonMetricValue | null;
  rightValue: ComparisonMetricValue | null;
};

// Display order for the comparison cards, grouped the way the card is
// read: headline numbers, the stat line behind them, team context, then
// market/value (projections); production, usage shares, then efficiency
// (advanced). Metrics not listed keep their catalog order at the end.
const comparisonRowOrder: Record<"projections" | "advanced", Record<BasePosition, string[]>> = {
  projections: {
    QB: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "expertProjection", "expertPositionRank",
      "stat_pass_yd", "stat_pass_td", "stat_pass_int", "stat_rush_yd", "stat_rush_td",
      "teamTotal", "teamOLineRank", "matchupPositionRank",
      "fantasyCalcValue",
    ],
    RB: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "expertProjection", "expertPositionRank",
      "stat_rush_yd", "stat_rush_td", "stat_rec", "stat_rec_yd", "stat_rec_td",
      "teamTotal", "teamOLineRank", "matchupPositionRank",
      "fantasyCalcValue",
    ],
    WR: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "expertProjection", "expertPositionRank",
      "stat_rec", "stat_rec_yd", "stat_rec_td", "stat_rush_yd", "stat_rush_td",
      "teamTotal", "teamOLineRank", "matchupPositionRank",
      "fantasyCalcValue",
    ],
    TE: [
      "league", "sleeperProjection", "leaguePositionRank", "boomCeiling", "bustFloor",
      "expertProjection", "expertPositionRank",
      "stat_rec", "stat_rec_yd", "stat_rec_td", "stat_rush_yd", "stat_rush_td",
      "teamTotal", "teamOLineRank", "matchupPositionRank",
      "fantasyCalcValue",
    ],
    K: [
      "league", "sleeperProjection", "leaguePositionRank",
      "expertProjection", "expertPositionRank",
      "teamTotal", "teamOLineRank", "matchupPositionRank",
      "fantasyCalcValue",
    ],
    DEF: ["projection", "expertProjection", "expertPositionRank", "opponentTotal"],
  },
  advanced: {
    QB: [
      "fantasy_league",
      "pass_attempts", "completions", "passing_yards", "passing_tds", "interceptions", "passing_air_yards",
      "carries", "rushing_yards", "rushing_tds",
      "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "completion_pct", "cpoe", "passing_epa", "epa_per_play",
      "expected_points", "points_over_expected",
      "time_to_throw", "aggressiveness",
    ],
    RB: [
      "fantasy_league",
      "touches", "carries", "rushing_yards", "rushing_tds",
      "targets", "receptions", "receiving_yards", "receiving_tds", "scrimmage_yards",
      "target_share", "carry_share", "rb_target_share", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "rushing_epa", "receiving_epa",
      "expected_points", "points_over_expected",
      "rush_yards_over_expected", "stacked_box_rate", "rush_efficiency",
    ],
    WR: [
      "fantasy_league",
      "targets", "receptions", "receiving_yards", "receiving_tds", "receiving_air_yards", "yards_after_catch",
      "target_share", "air_yards_share", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "receiving_epa",
      "expected_points", "points_over_expected",
      "separation", "yac_over_expected", "intended_air_share",
    ],
    TE: [
      "fantasy_league",
      "targets", "receptions", "receiving_yards", "receiving_tds", "receiving_air_yards", "yards_after_catch",
      "target_share", "air_yards_share", "opportunity_share", "snap_share", "rz_target_share", "rz_carry_share",
      "receiving_epa",
      "expected_points", "points_over_expected",
      "separation", "yac_over_expected", "intended_air_share",
    ],
    K: ["fg_attempts", "fg_made", "fg_pct", "fg_40_plus", "fg_50_plus", "pat_attempts", "pat_made", "kicks_made"],
    DEF: [
      "qb_hits", "takeaways", "sacks", "defensive_tds",
      "interceptions", "forced_fumbles", "fumble_recoveries", "tackles_for_loss", "passes_defended", "blocked_kicks", "safeties",
    ],
  },
};

/** Rows removed from comparison only; metric defs stay in AnalyticsViews for other tools. */
const hiddenComparisonKeys = new Set([
  "expertBestRank", "expertWorstRank", "boomBustRange", "fantasyCalcPositionRank", "tierCliff",
  "teamOffenseRank", "opponentDefenseRank",
  "opportunity", "wopr", "racr", "cushion", "air_yards_differential",
]);

// The card's lead number: league fantasy points (advanced) or the league projection.
const comparisonHeadlineKeys = new Set(["fantasy_league", "league", "projection"]);

type ComparisonGroup = "Projection" | "Props" | "Stat line" | "Team context" | "Market" | "Production" | "Expected points" | "Usage" | "Efficiency" | "Next Gen";

const comparisonUsageKeys = new Set([
  "touches", "carries", "targets", "pass_attempts", "opportunity_share", "snap_share",
  "rz_target_share", "rz_carry_share", "target_share", "carry_share", "rb_target_share", "air_yards_share",
  "fg_attempts", "pat_attempts",
]);
const comparisonEfficiencyKeys = new Set(["completion_pct", "cpoe", "passing_epa", "rushing_epa", "receiving_epa", "epa_per_play", "fg_pct"]);
const comparisonTeamContextKeys = new Set(["teamTotal", "teamOLineRank", "matchupPositionRank", "opponentTotal"]);
const comparisonMarketKeys = new Set(["fantasyCalcValue"]);
const comparisonExpectedKeys = new Set(["expected_points", "points_over_expected"]);
const comparisonNextGenKeys = new Set([
  "separation", "yac_over_expected", "intended_air_share",
  "rush_yards_over_expected", "stacked_box_rate", "rush_efficiency",
  "time_to_throw", "aggressiveness",
]);

function comparisonGroup(dataset: ToolDataset, key: string): ComparisonGroup {
  if (dataset === "advanced") {
    if (comparisonExpectedKeys.has(key)) return "Expected points";
    if (comparisonNextGenKeys.has(key)) return "Next Gen";
    return comparisonUsageKeys.has(key) ? "Usage" : comparisonEfficiencyKeys.has(key) ? "Efficiency" : "Production";
  }
  if (key.startsWith("prop_")) return "Props";
  if (key.startsWith("stat_")) return "Stat line";
  if (comparisonTeamContextKeys.has(key)) return "Team context";
  if (comparisonMarketKeys.has(key)) return "Market";
  return "Projection";
}

const comparisonGroupOrder: Record<ToolDataset, ComparisonGroup[]> = {
  projections: ["Projection", "Props", "Stat line", "Team context", "Market"],
  advanced: ["Production", "Expected points", "Usage", "Efficiency", "Next Gen"],
};

/**
 * Start/sit: one box per player for this season's weekly scores (floor to ceiling,
 * the middle half of his weeks boxed, median ticked), both on one scale. The
 * higher median takes the winner gold, like the leading side of a bar.
 */
function ComparisonOutcomes({ outcomes, names }: { outcomes: readonly [OutcomeSummary, OutcomeSummary]; names: readonly [string, string] }) {
  const domain = outcomeDomain(outcomes);
  const leader = outcomes[0].median === outcomes[1].median ? null : outcomes[0].median > outcomes[1].median ? 0 : 1;
  return (
    <div className="comparison-outcomes" role="list" aria-label="Weekly points this season, floor to ceiling">
      {outcomes.map((summary, index) => (
        <div className="comparison-outcome" role="listitem" key={names[index]} aria-label={`${names[index]}: floor ${formatDecimal(summary.floor, 1)}, median ${formatDecimal(summary.median, 1)}, ceiling ${formatDecimal(summary.ceiling, 1)}`}>
          <span className="comparison-outcome-name" aria-hidden="true">{names[index]}</span>
          <OutcomeBox summary={summary} domain={domain} leads={leader === index} />
          <span className={`comparison-outcome-median${leader === index ? " is-winner" : ""}`} aria-hidden="true">{formatDecimal(summary.median, 1)}</span>
        </div>
      ))}
    </div>
  );
}

function ComparisonMetricRow({ row, leftName, rightName, headline = false, ranges }: { row: ComparisonRow; leftName: string; rightName: string; headline?: boolean; ranges?: readonly [ProjectionRange | null, ProjectionRange | null] }) {
  const { metric, leftValue, rightValue } = row;
  const leftWins = Boolean(!metric.neutral && leftValue && rightValue && (metric.lowerIsBetter ? leftValue.value < rightValue.value : leftValue.value > rightValue.value));
  const rightWins = Boolean(!metric.neutral && leftValue && rightValue && (metric.lowerIsBetter ? rightValue.value < leftValue.value : rightValue.value > leftValue.value));
  const tied = Boolean(leftValue && rightValue && leftValue.value === rightValue.value);
  const leftDisplay = leftValue ? metricDisplay(leftValue.value, metric) : "—";
  const rightDisplay = rightValue ? metricDisplay(rightValue.value, metric) : "—";
  const valueClass = (value: ComparisonMetricValue | null, wins: boolean, loses: boolean) =>
    `comparison-row-value${wins ? " is-winner" : ""}${!value ? " is-unavailable" : loses ? " is-loser" : ""}`;
  const gap = leftValue && rightValue && (leftWins || rightWins) ? metricDisplay(Math.abs(leftValue.value - rightValue.value), metric) : null;
  // Ranks sit on one #1-to-last line, each with its own label; every other metric gets the gap bar.
  const rankStrip = metric.key.endsWith("Rank") && leftValue && rightValue;
  const rankTotal = rankStrip ? Math.max(32, leftValue.value, rightValue.value) : 32;

  return (
    <div
      className={`comparison-row${headline ? " is-headline" : ""}${rankStrip ? " is-rank" : ""}`}
      role="group"
      aria-label={`${metric.label}. ${leftName}: ${leftDisplay}${leftWins ? ", leads" : tied ? ", tied" : ""}. ${rightName}: ${rightDisplay}${rightWins ? ", leads" : tied ? ", tied" : ""}.`}
    >
      <span className="comparison-row-label" aria-hidden="true">
        {metric.label}
        {gap ? <strong className="comparison-row-delta">+{gap}</strong> : null}
      </span>
      {rankStrip ? (
        <RankStrip
          first={{ label: `${comparisonShortName(leftName, rightName)} #${leftDisplay}`, rank: leftValue.value }}
          second={{ label: `${comparisonShortName(rightName, leftName)} #${rightDisplay}`, rank: rightValue.value }}
          total={rankTotal}
          ariaLabel={`${metric.label}: ${leftName} ${leftDisplay}, ${rightName} ${rightDisplay}`}
        />
      ) : (
        <>
          <strong className={valueClass(leftValue, leftWins, rightWins)} aria-hidden="true">{leftDisplay}</strong>
          <GapBar left={leftValue?.value} right={rightValue?.value} lowerIsBetter={metric.lowerIsBetter} neutral={metric.neutral} />
          <strong className={valueClass(rightValue, rightWins, leftWins)} aria-hidden="true">{rightDisplay}</strong>
          {ranges && (ranges[0] || ranges[1]) ? (
            <>
              {/* Each player's book range under his projection, both on one scale. */}
              <span className="comparison-range is-left">{ranges[0] ? <RangeBar range={ranges[0]} value={leftValue?.value ?? null} domain={rangeDomain(ranges)} /> : null}</span>
              <span className="comparison-range is-right">{ranges[1] ? <RangeBar range={ranges[1]} value={rightValue?.value ?? null} domain={rangeDomain(ranges)} /> : null}</span>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function comparisonMatchupLabel(player: ComparisonEntity): string {
  if (player.isBye) return "Bye week";
  if (!player.opponent) return "Matchup TBD";
  return `${player.isAway ? "@" : "vs"} ${player.opponent}`;
}

/** Position, team and opponent in one short line; unknowns are left out rather than spelled out. */
function comparisonPickMeta(player: ComparisonEntity): string {
  const position = player.position === "DEF" ? "DST" : player.position;
  if (!player.team) return position;
  if (player.isBye) return `${position} · ${player.team} · Bye`;
  return player.opponent ? `${position} · ${player.team} ${player.isAway ? "@" : "vs"} ${player.opponent}` : `${position} · ${player.team}`;
}

/** Floor/ceiling and handcuff chips for one player in the comparison header. */
function ComparisonPlayerChips({ leagueId, playerId, position, team, weeklyRank, leagueSize, depth, playerLists }: { leagueId: string; playerId?: string; position: string; team: string | null; weeklyRank: number | null; leagueSize: number; depth: Dashboard["playerInsights"]["depth"]; playerLists: ReadonlyArray<ReadonlyArray<{ playerId: string; name: string; team: string | null }>> }) {
  const profile = useProfileTag(leagueId, playerId, position);
  const handcuffTo = playerId ? handcuffStarter({ playerId, position, team, weeklyRank, leagueSize, depth, playerLists }) : null;
  return <ProfileChips profile={profile} handcuffTo={handcuffTo} />;
}

function ComparisonBoardHeader({ left, right, leftPlayerId, rightPlayerId, trending, depth, depthPrevious, leagueSize, leagueId, playerLists, sosEntry, onOpenPlayer, onOpenMatchup }: { left: ComparisonEntity; right: ComparisonEntity; leftPlayerId?: string; rightPlayerId?: string; trending: Dashboard["playerTrending"]; depth: Dashboard["playerInsights"]["depth"]; depthPrevious: Dashboard["playerInsights"]["depthPrevious"]; leagueSize: number; leagueId: string; playerLists: ReadonlyArray<ReadonlyArray<{ playerId: string; name: string; team: string | null }>>; sosEntry?: StrengthOfScheduleEntryLike; onOpenPlayer?: (playerId: string) => void; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  return (
    <header className="comparison-board-head" aria-label={`${left.name} versus ${right.name}`}>
      {[{ player: left, playerId: leftPlayerId }, { player: right, playerId: rightPlayerId }].map(({ player, playerId }, index) => {
        const trend = playerId ? trending?.[playerId] : undefined;
        const depthMove = depthChange(playerId ? depth[playerId] : undefined, playerId ? depthPrevious[playerId] : undefined);
        const tier = positionTierLabel(player.position, player.values.leaguePositionRank, leagueSize);
        return (
          <div className={`comparison-board-player${index === 0 ? " is-left" : " is-right"}`} key={player.id}>
            {playerId && onOpenPlayer
              ? <button type="button" className="comparison-board-name" onClick={() => onOpenPlayer(playerId)} aria-label={`View ${player.name} details and news`}>{player.name}</button>
              : <strong className="comparison-board-name">{player.name}</strong>}
            <span className="comparison-board-meta">
              {player.team && player.opponent && !player.isBye
                ? <MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase ?? null }) : undefined} />
                : <span>{player.team || "Team TBD"} · {comparisonMatchupLabel(player)}</span>}
              {tier ? <span className="depth-chart-tag" title="Where this week's rank falls at the position">{tier}</span> : null}
              <ComparisonPlayerChips leagueId={leagueId} playerId={playerId} position={player.position} team={player.team} weeklyRank={player.values.leaguePositionRank} leagueSize={leagueSize} depth={depth} playerLists={playerLists} />
              {depthMove ? <DepthChangeMark change={depthMove} /> : null}
            </span>
            {trend && (trend.adds !== null || trend.drops !== null) ? (
              <span className="comparison-trending">
                {trend.adds !== null ? <>Adds <strong>{formatCompactCount(trend.adds)}</strong></> : null}
                {trend.adds !== null && trend.drops !== null ? " · " : null}
                {trend.drops !== null ? <>Drops <strong>{formatCompactCount(trend.drops)}</strong></> : null}
              </span>
            ) : null}
          </div>
        );
      })}
    </header>
  );
}

function ComparisonPicker({ slot, player, options, onChoose, onClear }: {
  slot: 1 | 2;
  player: ComparisonEntity | undefined;
  options: ComparisonEntity[];
  onChoose: (entity: ComparisonEntity) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const swapRef = useRef<HTMLButtonElement>(null);
  // Picking, Escape and clear unmount the focused control; say where focus goes next.
  const restoreFocus = useRef<"swap" | "input" | null>(null);
  const inputId = `comparison-position-player-${slot}`;
  const needle = comparablePlayerName(query.trim());
  const showSearch = !player || isEditing;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    } else if (restoreFocus.current === "swap" && player) {
      swapRef.current?.focus();
    } else if (restoreFocus.current === "input" && !player) {
      inputRef.current?.focus();
    }
    if (!isEditing) restoreFocus.current = null;
  }, [isEditing, player]);

  const matches = useMemo(() => options
    .filter((entity) => needle && comparablePlayerName(entity.name).includes(needle))
    .sort((a, b) => {
      const aName = comparablePlayerName(a.name);
      const bName = comparablePlayerName(b.name);
      const aPriority = needle && aName === needle ? 0 : needle && aName.startsWith(needle) ? 1 : 2;
      const bPriority = needle && bName === needle ? 0 : needle && bName.startsWith(needle) ? 1 : 2;
      return aPriority - bPriority || a.name.localeCompare(b.name);
    })
    .slice(0, 40), [needle, options]);

  function choose(entity: ComparisonEntity, fromKeyboard = false) {
    // A keyboard pick keeps focus on the slot; a tap shouldn't leave a focus ring behind.
    if (fromKeyboard) restoreFocus.current = "swap";
    onChoose(entity);
    setQuery("");
    setIsEditing(false);
  }

  function stopEditing() {
    setQuery("");
    setIsEditing(false);
  }

  return (
    <div className={`comparison-pick slot-${slot}${player ? " is-picked" : ""}`}>
      {showSearch ? (
        <>
          <label className="sr-only" htmlFor={inputId}>{player ? `Replace player ${slot}` : `Search for player ${slot}`}</label>
          <div className="search-field comparison-pick-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              aria-label={player ? `Search to replace player ${slot}` : `Search players for comparison slot ${slot}`}
              name={`comparison-player-${slot}`}
              placeholder={player ? `Replace ${player.name}…` : `Add player ${slot}…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onBlur={(event) => {
                // Leaving the search without picking keeps the current player.
                if (player && !event.currentTarget.closest(".comparison-pick")?.contains(event.relatedTarget)) stopEditing();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const firstMatch = matches[0];
                  if (firstMatch) { event.preventDefault(); choose(firstMatch, true); }
                } else if (event.key === "Escape") {
                  if (player) {
                    restoreFocus.current = "swap";
                    stopEditing();
                  } else setQuery("");
                }
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label={`Clear player ${slot} search`}><CloseGlyph /></button> : null}
          </div>
        </>
      ) : player ? (
        <div className="comparison-pick-chosen">
          <button ref={swapRef} type="button" className="comparison-pick-swap" onClick={() => setIsEditing(true)} aria-label={`Replace player ${slot}, ${player.name}`}>
            <strong>{player.name}</strong>
            <span>{comparisonPickMeta(player)}</span>
          </button>
          <button type="button" className="comparison-pick-clear" onClick={() => { restoreFocus.current = "input"; onClear(); stopEditing(); }} aria-label={`Clear player ${slot}`}><CloseGlyph /></button>
        </div>
      ) : null}
      {showSearch && needle ? (
        <div className="comparison-pick-results" aria-label={`Players available for comparison slot ${slot}`} aria-live="polite">
          {matches.map((entity) => (
            <button
              type="button"
              aria-current={player?.id === entity.id ? "true" : undefined}
              className={player?.id === entity.id ? "is-selected" : ""}
              key={entity.id}
              // Keep focus in the search so picking a result doesn't count as leaving it.
              onMouseDown={(event) => event.preventDefault()}
              // detail 0 means Enter or Space on the button, not a pointer click.
              onClick={(event) => choose(entity, event.detail === 0)}
            >
              <span className="comparison-result-primary"><strong>{entity.name}</strong></span>
              <span className="comparison-result-meta">
                <span>{comparisonPickMeta(entity)}</span>
              </span>
            </button>
          ))}
          {matches.length === 0 ? <EmptyState title={`No players match “${query.trim()}”`} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One key per real player across both sources; defenses are keyed by team. */
function comparisonIdentity(player: PlayerSelection): string {
  return `${player.position}:${player.position === "DEF" ? player.team : comparablePlayerName(player.name)}`;
}

type ComparisonSection = {
  dataset: ToolDataset;
  headline: ComparisonRow | undefined;
  groups: { group: ComparisonGroup; rows: ComparisonRow[] }[];
};

function comparisonSection(dataset: ToolDataset, position: BasePosition, league: League, left: ComparisonEntity | undefined, right: ComparisonEntity | undefined, extraRows: ComparisonRow[] = []): ComparisonSection {
  const metricList = (dataset === "advanced"
    ? analyticsMetricsForLeague(position, league)
    : (() => {
      const projectionMetrics = weeklyMetrics[position].filter((metric) => !redundantComparisonProjectionKeys.has(metric.key));
      return position === "DEF" ? projectionMetrics : [...projectionMetrics, ...teamContextMetrics];
    })()).filter((metric) => !hiddenComparisonKeys.has(metric.key));
  const rows: ComparisonRow[] = metricList.flatMap((metric) => {
    const leftValue = comparisonValue(left, metric);
    const rightValue = comparisonValue(right, metric);
    return leftValue || rightValue ? [{ metric, leftValue, rightValue }] : [];
  });
  const orderIndex = new Map(comparisonRowOrder[dataset][position].map((key, index) => [key, index]));
  const ordered = [...rows, ...extraRows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.get(a.row.metric.key) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = orderIndex.get(b.row.metric.key) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.index - b.index;
    })
    .map(({ row }) => row);
  const headline = ordered.find((row) => comparisonHeadlineKeys.has(row.metric.key));
  const groups = comparisonGroupOrder[dataset]
    .map((group) => ({ group, rows: ordered.filter((row) => row !== headline && comparisonGroup(dataset, row.metric.key) === group) }))
    .filter((entry) => entry.rows.length > 0);
  return { dataset, headline, groups };
}

function ComparisonView({ dashboard, league, window, onWindowChange, validPositions, initialPlayer, initialSecondPlayer, initialKey, onOpenPlayer, onOpenMatchup }: {
  dashboard: Dashboard;
  league: League;
  window: AnalyticsWindow;
  onWindowChange: (window: AnalyticsWindow) => void;
  validPositions: BasePosition[];
  initialPlayer: PlayerSelection | null;
  initialSecondPlayer: PlayerSelection | null;
  initialKey: number;
  onOpenPlayer?: (playerId: string) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
}) {
  const pfnQuery = useQuery({
    queryKey: ["pfn-tables"],
    queryFn: () => api.getPfnTables({}),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const weeklyEntities = useMemo(() => buildWeeklyEntities(dashboard, league, pfnQuery.data?.tables), [dashboard, league.id, pfnQuery.data?.tables]);
  const weeklyByIdentity = useMemo(() => new Map(weeklyEntities.map((entity) => [comparisonIdentity(entity), entity])), [weeklyEntities]);
  // This week's projections and the season's advanced stats, for every position the league ranks.
  const projectionEntities = useMemo(
    () => weeklyEntities.filter((entity) => validPositions.includes(entity.position)),
    [validPositions, weeklyEntities],
  );
  const advancedEntities = useMemo<ComparisonEntity[]>(() => dashboard.analytics.entities.flatMap((entity) => {
    if (!(validPositions as string[]).includes(entity.position)) return [];
    const game = weeklyByIdentity.get(comparisonIdentity(entity as PlayerSelection));
    return [{
      id: entity.id,
      name: entity.name,
      team: entity.team,
      position: entity.position as BasePosition,
      opponent: game?.opponent ?? null,
      isAway: game?.isAway ?? null,
      isBye: game?.isBye ?? false,
      gameTime: game?.gameTime ?? null,
      gamePhase: game?.gamePhase ?? null,
      values: window === "season" ? entity.season : entity.rolling17,
    }];
  }), [dashboard.analytics.entities, validPositions, weeklyByIdentity, window]);
  const advancedByIdentity = useMemo(() => new Map(advancedEntities.map((entity) => [comparisonIdentity(entity), entity])), [advancedEntities]);
  // Pickers search everyone with either projections or stats; a player in both appears once.
  const candidates = useMemo(() => {
    const byIdentity = new Map<string, ComparisonEntity>(projectionEntities.map((entity) => [comparisonIdentity(entity), entity]));
    for (const entity of advancedEntities) {
      if (!byIdentity.has(comparisonIdentity(entity))) byIdentity.set(comparisonIdentity(entity), entity);
    }
    return [...byIdentity.values()];
  }, [advancedEntities, projectionEntities]);

  const [selectedPlayers, setSelectedPlayers] = useState<[PlayerSelection | null, PlayerSelection | null]>([null, null]);
  const [sectionTab, setSectionTab] = useState<"projections" | "advanced">("projections");
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const initialSeedKey = useRef<number | null>(null);

  // Both slots start empty. The initialPlayer seed (a player card's "Compare"
  // link) is applied only when initialKey changes, so the window toggle never
  // wipes the user's picks.
  useEffect(() => {
    if (!initialPlayer || !validPositions.includes(initialPlayer.position)) return;
    if (initialSeedKey.current === initialKey) return;
    const requested = candidates.find((entity) => isSamePlayer(entity, initialPlayer));
    if (!requested) return;
    // A second seed (a Matchup Advantage row) fills the other slot with the opponent's starter.
    // Both slots stay one position, as the pickers require: a FLEX row pairing an RB with a WR
    // seeds only your player, since ranges and stat rows are scored for one position.
    const second = initialSecondPlayer && initialSecondPlayer.position === requested.position
      ? candidates.find((entity) => isSamePlayer(entity, initialSecondPlayer) && !isSamePlayer(entity, requested)) ?? null
      : null;
    setSelectedPlayers([requested, second]);
    initialSeedKey.current = initialKey;
  }, [candidates, initialKey, initialPlayer, initialSecondPlayer, validPositions]);

  // Drop picks whose position the league no longer ranks.
  useEffect(() => {
    if (selectedPlayers.every((player) => !player || validPositions.includes(player.position))) return;
    setSelectedPlayers(([first, second]) => [
      first && validPositions.includes(first.position) ? first : null,
      second && validPositions.includes(second.position) ? second : null,
    ]);
  }, [selectedPlayers, validPositions]);

  // Resolve each pick against both sources by identity: they use different row
  // IDs for the same player, and either can be missing a player.
  const resolved = selectedPlayers.map((player) => {
    if (!player) return undefined;
    const projection = projectionEntities.find((entity) => isSamePlayer(entity, player))
      ?? weeklyByIdentity.get(comparisonIdentity(player));
    const advanced = advancedByIdentity.get(comparisonIdentity(player)) ?? advancedEntities.find((entity) => isSamePlayer(entity, player));
    const display: ComparisonEntity = projection ?? advanced ?? {
      ...player,
      id: player.playerId ?? comparisonIdentity(player),
      opponent: null,
      isAway: null,
      isBye: false,
      gameTime: null,
      gamePhase: null,
      values: {},
    };
    return { display, projection, advanced };
  });
  const left = resolved[0]?.display;
  const right = resolved[1]?.display;
  const position = (left ?? right)?.position ?? null;
  const playerDetailId = (player: ComparisonEntity | undefined): string | undefined => player
    ? player.playerId ?? weeklyByIdentity.get(comparisonIdentity(player))?.playerId
    : undefined;
  const leftPlayerId = playerDetailId(left);
  const rightPlayerId = playerDetailId(right);
  // Book ranges for the Week headline, only while each player's pregame projection stands.
  const rangeFor = (playerId: string | undefined | null): ProjectionRange | null => {
    if (!playerId) return null;
    const row = dashboard.rankings.find((item) => item.leagueId === league.id && item.playerId === playerId);
    return row && (row.gamePhase === "pregame" || row.gamePhase === null) ? row.projectionRange ?? null : null;
  };
  const projectionRanges = [rangeFor(leftPlayerId), rangeFor(rightPlayerId)] as const;
  const boomBustPlayerIds = [leftPlayerId, rightPlayerId].filter((playerId): playerId is string => Boolean(playerId));
  const supportsBoomBust = position === "QB" || position === "RB" || position === "WR" || position === "TE";
  const boomBustQuery = useQuery({
    queryKey: ["comparison-boom-bust-ranges", league.id, position, ...boomBustPlayerIds],
    queryFn: () => api.getBoomBustRanges({ leagueId: league.id, position: position as "QB" | "RB" | "WR" | "TE", playerIds: boomBustPlayerIds }),
    enabled: supportsBoomBust && boomBustPlayerIds.length === 2,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const makeRowValue = (value: number | null | undefined): ComparisonMetricValue | null => typeof value === "number" && Number.isFinite(value) ? { value } : null;
  // Consensus prop lines, one row per stat either player has.
  const propRows = (() => {
    const propLines = pfnQuery.data?.propLines;
    // A cached response from before the weekly rollover holds last week's lines.
    const lines = propLines && propLines.season === dashboard.season && propLines.week === dashboard.week ? propLines.lines : [];
    const leftLines = new Map(lines.filter((line) => leftPlayerId && line.playerId === leftPlayerId).map((line) => [line.stat, line.line]));
    const rightLines = new Map(lines.filter((line) => rightPlayerId && line.playerId === rightPlayerId).map((line) => [line.stat, line.line]));
    const stats = [...new Set([...leftLines.keys(), ...rightLines.keys()])].filter((stat) => !isHiddenHalfPointPropStat(stat));
    return stats.flatMap((stat): ComparisonRow[] => {
      const def = propStatDef(stat);
      if (!def) return [];
      return [{
        metric: { key: `prop_${stat}`, label: `${def.label} line`, short: def.short, lowerIsBetter: false },
        leftValue: makeRowValue(leftLines.get(stat)),
        rightValue: makeRowValue(rightLines.get(stat)),
      }];
    });
  })();
  const boomBustRows = (() => {
    if (!leftPlayerId || !rightPlayerId) return [];
    const ranges = new Map((boomBustQuery.data?.rows ?? []).map((range) => [range.playerId, range]));
    const leftRange = ranges.get(leftPlayerId);
    const rightRange = ranges.get(rightPlayerId);
    const makeValue = (value: number | undefined): ComparisonMetricValue | null => typeof value === "number" && Number.isFinite(value) ? { value } : null;
    const rangeRows: ComparisonRow[] = [
      {
        metric: { key: "boomCeiling", label: "Boom ceiling", short: "Boom", unit: " pts" },
        leftValue: makeValue(leftRange?.ceiling),
        rightValue: makeValue(rightRange?.ceiling),
      },
      {
        metric: { key: "bustFloor", label: "Bust floor", short: "Bust", unit: " pts" },
        leftValue: makeValue(leftRange?.floor),
        rightValue: makeValue(rightRange?.floor),
      },
    ];
    return rangeRows.filter((row) => row.leftValue || row.rightValue);
  })();
  // Start/sit boxes: each player's weekly scores this season, floor to ceiling, on one scale.
  const outcomes = (() => {
    if (!leftPlayerId || !rightPlayerId) return null;
    const ranges = new Map((boomBustQuery.data?.rows ?? []).map((range) => [range.playerId, range]));
    const pick = (id: string): OutcomeSummary | null => {
      const range = ranges.get(id);
      return range ? { floor: range.floor, p25: range.p25, median: range.median, p75: range.p75, ceiling: range.ceiling } : null;
    };
    const first = pick(leftPlayerId);
    const second = pick(rightPlayerId);
    return first && second ? [first, second] as const : null;
  })();
  const sections = left && right && position ? [
    comparisonSection("projections", position, league, resolved[0]?.projection, resolved[1]?.projection, [...boomBustRows, ...propRows]),
    comparisonSection("advanced", position, league, resolved[0]?.advanced, resolved[1]?.advanced),
  ] : [];
  const selectionStateClass = left && right ? " is-ready" : left || right ? " has-selection" : " is-empty";
  const optionsBeside = (other: ComparisonEntity | undefined) => other
    ? candidates.filter((entity) => entity.position === other.position && !isSamePlayer(entity, other))
    : candidates;

  return (
    <section className={`comparison-view${selectionStateClass}`}>
      <div className="comparison-pickers" aria-label="Players being compared">
        <ComparisonPicker slot={1} player={left} options={optionsBeside(right)} onChoose={(entity) => setSelectedPlayers((current) => [entity, current[1]])} onClear={() => setSelectedPlayers((current) => [null, current[1]])} />
        <ComparisonPicker slot={2} player={right} options={optionsBeside(left)} onChoose={(entity) => setSelectedPlayers((current) => [current[0], entity])} onClear={() => setSelectedPlayers((current) => [current[0], null])} />
      </div>

      {candidates.length === 0 ? (
        <div className="analytics-empty"><strong>No player data yet.</strong><span>Refresh to check the latest Vegas lines and nflverse data.</span></div>
      ) : left && right ? (
        <section className="comparison-board" aria-label={`${left.name} and ${right.name} comparison`}>
          <ComparisonBoardHeader left={left} right={right} leftPlayerId={leftPlayerId} rightPlayerId={rightPlayerId} trending={dashboard.playerTrending ?? {}} depth={dashboard.playerInsights?.depth ?? {}} depthPrevious={dashboard.playerInsights?.depthPrevious ?? {}} leagueSize={league.seasonLongFormat.numTeams} leagueId={league.id} playerLists={[dashboard.rankings, dashboard.seasonLongRankings]} sosEntry={sosEntry} onOpenPlayer={onOpenPlayer} onOpenMatchup={onOpenMatchup} />
          <Tabs value={sectionTab} onValueChange={(value) => setSectionTab(value as "projections" | "advanced")} className="comparison-section-tabs">
            <TabsList aria-label="Comparison data">
              <TabsTrigger id="comparison-projections-tab" value="projections" aria-controls="comparison-projections-panel">Week {dashboard.week}</TabsTrigger>
              <TabsTrigger id="comparison-advanced-tab" value="advanced" aria-controls="comparison-advanced-panel">Season</TabsTrigger>
            </TabsList>
          </Tabs>
          {sections.filter((section) => section.dataset === sectionTab).map((section) => (
            <section className="comparison-section" key={section.dataset} id={`comparison-${section.dataset}-panel`} role="tabpanel" aria-labelledby={`comparison-${section.dataset}-tab`}>
              {section.dataset === "advanced" ? (
                <header className="comparison-section-head">
                  <SegmentedControl className="compact-control" value={window} onChange={onWindowChange} label="Season stat window" options={[{ value: "season", label: "This season" }, { value: "rolling17", label: "Rolling 17 games" }]} />
                </header>
              ) : null}
              {section.headline ? <ComparisonMetricRow row={section.headline} leftName={left.name} rightName={right.name} headline ranges={section.dataset === "projections" ? projectionRanges : undefined} /> : null}
              {section.dataset === "projections" && outcomes ? <ComparisonOutcomes outcomes={outcomes} names={[comparisonShortName(left.name, right.name), comparisonShortName(right.name, left.name)]} /> : null}
              {section.groups.map(({ group, rows: groupRows }) => (
                <section className="comparison-group" key={group} aria-label={group}>
                  <div className="section-heading"><h3>{group}</h3></div>
                  {groupRows.map((row) => <ComparisonMetricRow key={row.metric.key} row={row} leftName={left.name} rightName={right.name} />)}
                </section>
              ))}
              {!section.headline && section.groups.length === 0
                ? <div className="empty-inline">{section.dataset === "projections" ? "No projections for these players yet." : "No season stats for these players yet."}</div>
                : null}
            </section>
          ))}
        </section>
      ) : <EmptyState title="Choose two players to compare" detail="Both slots search the same position." />}
    </section>
  );
}

export function ComparisonTool({ dashboard, league, initialPlayer = null, initialSecondPlayer = null, initialKey = 0, onOpenPlayer, onOpenMatchup }: { dashboard: Dashboard; league: League; initialPlayer?: PlayerSelection | null; initialSecondPlayer?: PlayerSelection | null; initialKey?: number; onOpenPlayer?: (playerId: string) => void; onOpenMatchup?: (matchup: MatchupSelection) => void }) {
  const validPositions = useMemo(() => basePositionOrder.filter((item) => league.rankingPositions.includes(item)), [league.rankingPositions]);
  const [window, setWindow] = useState<AnalyticsWindow>("season");

  return (
    <div className="comparison-tool">
      <ComparisonView
        dashboard={dashboard}
        league={league}
        window={window}
        onWindowChange={setWindow}
        validPositions={validPositions}
        initialPlayer={initialPlayer}
        initialSecondPlayer={initialSecondPlayer}
        initialKey={initialKey}
        onOpenPlayer={onOpenPlayer}
        onOpenMatchup={onOpenMatchup}
      />
    </div>
  );
}
