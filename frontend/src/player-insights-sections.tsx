import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AnalyticsEntity, PlayerSearchResult } from "./dashboard-types";
import { formatDecimal, formatPercent, formatPoints } from "./lib/format-number";
import { TEAM_WEEK_STATS_STALE_MS } from "../../api/_lib/nflverse-team-week-stats";
import {
  buildPropHistory,
  indexWeekStatsByPlayer,
  isHiddenHalfPointPropStat,
  propPlayerMatchKey,
  propStatDef,
} from "../../api/_lib/prop-line-reads";

function formatLine(value: number): string {
  return Number.isInteger(value) ? String(value) : formatDecimal(value, 2);
}

function formatOdds(odds: number | null): string {
  if (odds === null || !Number.isFinite(odds) || odds === 0) return "—";
  const rounded = Math.round(odds);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** This week's consensus prop lines for one player, with each prior game against the line. */
export function PlayerPropsSection({ player, season, week }: { player: PlayerSearchResult; season: number; week: number }) {
  const pfnQuery = useQuery({
    // Ask for the card's own week; the server's default is the NFL week, which can differ.
    queryKey: ["pfn-tables", season, week],
    queryFn: () => api.getPfnTables({ season, week }),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const propLines = pfnQuery.data?.propLines;
  const lines = useMemo(() => {
    // A degraded response carries no lines and season/week 0.
    if (!propLines || propLines.season !== season || propLines.week !== week) return [];
    return propLines.lines.filter((line) => (
      line.playerId === player.playerId
      && propStatDef(line.stat)
      && !isHiddenHalfPointPropStat(line.stat)
    ));
  }, [propLines, player.playerId, season, week]);
  const historyQuery = useQuery({
    queryKey: ["nflverse-team-week-stats", season],
    queryFn: () => api.getTeamWeekStats({ season }),
    staleTime: TEAM_WEEK_STATS_STALE_MS,
    gcTime: TEAM_WEEK_STATS_STALE_MS * 2,
    retry: 1,
    enabled: lines.length > 0,
  });
  // Until the game logs load (or if they fail), show no bars rather than "no game" weeks.
  const historyReady = historyQuery.isSuccess;
  const weekRows = useMemo(() => {
    const prior = (historyQuery.data?.stats ?? []).filter((row) => row.week >= 1 && row.week < week);
    return indexWeekStatsByPlayer(prior).get(propPlayerMatchKey(player.name, player.team, player.position)) ?? [];
  }, [historyQuery.data?.stats, player.name, player.position, player.team, week]);
  // The five most recent weeks, oldest first.
  const recentWeeks = useMemo(() => Array.from({ length: Math.min(5, Math.max(0, week - 1)) }, (_, index) => week - Math.min(5, week - 1) + index), [week]);

  if (lines.length === 0) {
    if (pfnQuery.isPending) return <div className="player-tab-empty"><strong>Loading props…</strong></div>;
    if (pfnQuery.isError) return <div className="player-tab-empty"><strong>Props didn’t load</strong><span>Try again in a minute.</span></div>;
    return <div className="player-tab-empty"><strong>No props posted</strong><span>{player.name} has no lines for week {week} yet.</span></div>;
  }
  return (
    <section className="player-props-section" aria-label={`${player.name} props`}>
      <div className="section-heading"><h3>Props</h3><span>Week {week}</span></div>
      <div className="player-props-grid" role="table" aria-label={`${player.name} prop lines`}>
        <div className="player-props-row is-head" role="row">
          <span role="columnheader">Stat</span>
          <span role="columnheader">Line</span>
          <span role="columnheader">Odds</span>
          <span role="columnheader">Books</span>
          <span role="columnheader">Last {recentWeeks.length}</span>
        </div>
        {lines.map((line) => {
          const def = propStatDef(line.stat);
          const history = buildPropHistory(line.stat, line.line, weekRows);
          const byWeek = new Map(history.cells.map((cell) => [cell.week, cell]));
          const scaleMax = Math.max(line.line, ...history.cells.map((cell) => cell.actual), 0) || 1;
          return (
            <div className="player-props-row" role="row" key={line.stat}>
              <span role="cell">{def?.label ?? line.stat}</span>
              <strong role="cell">{formatLine(line.line)}</strong>
              <span role="cell">{formatOdds(line.overOdds)}</span>
              <span role="cell">{line.bookCount > 0 ? line.bookCount : "—"}</span>
              <span role="cell">
                <span
                  className="props-history player-props-history"
                  role="img"
                  aria-label={!historyReady ? (historyQuery.isError ? "Game history unavailable" : "Loading game history") : recentWeeks.map((weekNumber) => {
                    const cell = byWeek.get(weekNumber);
                    return cell ? `W${weekNumber} ${formatLine(cell.actual)} (${cell.result})` : `W${weekNumber} no game`;
                  }).join(", ") || "No prior games"}
                >
                  {historyReady && recentWeeks.map((weekNumber) => {
                    const cell = byWeek.get(weekNumber);
                    if (!cell) return <span key={weekNumber} className="props-bar is-empty" />;
                    return <span key={weekNumber} className={`props-bar is-${cell.result}`} style={{ height: `${Math.max(4, (cell.actual / scaleMax) * 100)}%` }} />;
                  })}
                  <span className="props-history-line" style={{ bottom: `${(line.line / scaleMax) * 100}%` }} />
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Expected vs actual PPR points (ffopportunity): per-game averages and a weekly pair of bars. */
export function PlayerExpectedPoints({ entity }: { entity: AnalyticsEntity | undefined }) {
  const expected = entity?.season.expected_points;
  const over = entity?.season.points_over_expected;
  const weeks = entity?.weeklyExpected ?? [];
  if (typeof expected !== "number" || typeof over !== "number") return null;
  const scaleMax = Math.max(1, ...weeks.flatMap((point) => [point.expected, point.actual]));
  return (
    <section className="player-expected-section" aria-labelledby="player-expected-heading">
      <div className="section-heading"><h3 id="player-expected-heading">Expected points</h3><span>{weeks.length} games · PPR</span></div>
      <div className="player-advanced-grid">
        <div><span>Expected / game</span><strong>{formatPoints(expected)}</strong></div>
        <div><span>Actual / game</span><strong>{formatPoints(expected + over)}</strong></div>
        <div><span>Difference</span><strong>{formatPoints(over, { sign: "exceptZero" })}</strong></div>
      </div>
      {weeks.length > 0 ? (
        <>
          <div
            className="player-expected-chart"
            role="img"
            aria-label={weeks.map((point) => `Week ${point.week}: expected ${formatPoints(point.expected)}, actual ${formatPoints(point.actual)}`).join("; ")}
          >
            {weeks.map((point) => (
              <div key={point.week} className="player-expected-week">
                <div className="player-expected-bars">
                  <span className="is-expected" style={{ height: `${(point.expected / scaleMax) * 100}%` }} />
                  <span className="is-actual" style={{ height: `${(point.actual / scaleMax) * 100}%` }} />
                </div>
                <span>W{point.week}</span>
              </div>
            ))}
          </div>
          <div className="player-expected-legend" aria-hidden="true">
            <span><i className="is-expected" />Expected</span>
            <span><i className="is-actual" />Actual</span>
          </div>
        </>
      ) : null}
      <p className="player-tab-source">ffverse expected fantasy points</p>
    </section>
  );
}

const NEXT_GEN_FIELDS: Array<{ key: string; label: string; format: (value: number) => string }> = [
  { key: "separation", label: "Separation", format: (value) => `${formatDecimal(value, 2)} yd` },
  { key: "cushion", label: "Cushion", format: (value) => `${formatDecimal(value, 2)} yd` },
  { key: "yac_over_expected", label: "YAC over expected", format: (value) => formatDecimal(value, 2, { sign: "exceptZero" }) },
  { key: "intended_air_share", label: "Air-yard share", format: (value) => formatPercent(value) },
  { key: "rush_yards_over_expected", label: "Rush yds over exp / carry", format: (value) => formatDecimal(value, 2, { sign: "exceptZero" }) },
  { key: "stacked_box_rate", label: "Carries vs 8+ box", format: (value) => formatPercent(value) },
  { key: "time_to_throw", label: "Time to throw", format: (value) => `${formatDecimal(value, 2)}s` },
  { key: "aggressiveness", label: "Aggressive throws", format: (value) => formatPercent(value) },
  { key: "air_yards_differential", label: "Air-yards differential", format: (value) => formatDecimal(value, 2, { sign: "exceptZero" }) },
];

/** NFL Next Gen Stats season figures; only players with enough snaps qualify. */
export function PlayerNextGen({ entity }: { entity: AnalyticsEntity | undefined }) {
  const values = entity?.season ?? {};
  const fields = NEXT_GEN_FIELDS.filter((field) => typeof values[field.key] === "number");
  if (fields.length === 0) return null;
  return (
    <section className="player-nextgen-section" aria-labelledby="player-nextgen-heading">
      <div className="section-heading"><h3 id="player-nextgen-heading">Next Gen Stats</h3><span>Season</span></div>
      <div className="player-advanced-grid">
        {fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.format(values[field.key] as number)}</strong></div>)}
      </div>
      <p className="player-tab-source">NFL Next Gen Stats via nflverse</p>
    </section>
  );
}
