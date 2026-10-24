import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, chartTooltipStyle } from "@/components/ui/chart";
import {
  NFL_TEAM_CODES,
  TEAM_STATS_GROUP_POSITIONS,
  TEAM_STATS_GROUPS,
  TEAM_STATS_STAT_OPTIONS,
  TEAM_WEEK_STATS_STALE_MS,
  buildTeamStatsTable,
  canonicalNflTeam,
  defaultTeamStatsGroup,
  defaultTeamStatsTeam,
  normalizeTeamStatsPlayerName,
  parseTeamStatsGroup,
  teamStatsRecordedWeeks,
  teamStatsLegendCaption,
  type TeamStatsGroupId,
  type TeamStatsPlayerRow,
  type TeamStatsStatId,
} from "../../../api/_lib/nflverse-team-week-stats";
import { api } from "../api";
import { ChartDialog } from "../chart-dialog";
import { SectionError } from "../dashboard-shared";
import type { League } from "../dashboard-types";
import { buildTeamStatsChartSeries, type TeamStatsChartSeries } from "../lib/team-stats-chart";
import { formatPercent, formatPoints, formatWhole } from "../lib/format-number";
import { SegmentedControl } from "../shared";
import { PlayerNameLink } from "../tool-links";
import type { PlayerLinkResolver } from "../tool-player-link";

/**
 * Cell shading for the usage grid: one blue scale (green and red stay
 * reserved for good and bad), capped so text stays readable in both themes.
 */
const TEAM_STATS_SHADE_MAX = 55;

function cellShade(intensity: number): string | undefined {
  const clamped = Math.max(0, Math.min(1, intensity));
  if (clamped <= 0) return undefined;
  return `color-mix(in srgb, var(--chart-5) ${Math.round(4 + clamped * (TEAM_STATS_SHADE_MAX - 4))}%, transparent)`;
}

/** "Kenneth Walker III" → "K. Walker III", for the narrow phone column. */
function shortPlayerName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length > 0 && first ? `${first[0]}. ${rest.join(" ")}` : name;
}

function formatTeamStatsAverage(value: number): string {
  return formatPoints(value);
}

function displayTeamStatsValue(statId: TeamStatsStatId, value: number): string {
  if (statId === "fantasy_points") return formatPoints(value);
  return formatWhole(value);
}

function displayTeamStatsPercent(percent: number): string {
  return formatPercent(percent);
}

function isRosteredPlayer(
  player: { name: string; team: string; position: string },
  league: League,
): boolean {
  const entityName = normalizeTeamStatsPlayerName(player.name);
  return [...league.starters, ...league.bench].some((rostered) => (
    rostered.position === player.position
    && rostered.team != null
    && canonicalNflTeam(rostered.team) === player.team
    && normalizeTeamStatsPlayerName(rostered.name) === entityName
  ));
}

function TeamStatsLineChart({
  series,
  weeks,
  statId,
  statLabel,
  isSnaps,
  ariaLabel,
}: {
  series: readonly TeamStatsChartSeries[];
  weeks: readonly number[];
  statId: TeamStatsStatId;
  statLabel: string;
  isSnaps: boolean;
  ariaLabel: string;
}) {
  const data = useMemo(() => weeks.map((week) => {
    const row: Record<string, number | string | null> = { week };
    for (const item of series) {
      const point = item.points.find((candidate) => candidate.week === week);
      row[item.id] = point?.value ?? null;
    }
    return row;
  }), [series, weeks]);

  return (
    <div className="scatter-frame team-stats-line-chart" role="img" aria-label={ariaLabel}>
      <ChartContainer
        config={Object.fromEntries(series.map((item) => [item.id, { label: item.label, color: item.color }]))}
        className="aspect-auto h-full"
      >
        <LineChart data={data} margin={{ top: 22, right: 10, bottom: 28, left: 2 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 5" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fill: "var(--dim)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            label={{ value: "Week", position: "insideBottom", offset: -12, fill: "var(--text)", fontSize: 10, fontWeight: 700 }}
          />
          <YAxis
            domain={isSnaps ? [0, 100] : ["auto", "auto"]}
            width={40}
            tick={{ fill: "var(--dim)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: isSnaps ? "Snap %" : statLabel,
              angle: -90,
              position: "insideLeft",
              fill: "var(--text)",
              fontSize: 10,
              fontWeight: 700,
            }}
          />
          <Tooltip
            formatter={(value, name) => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) return ["—", name];
              if (isSnaps) return [formatPercent(numeric), name];
              return [displayTeamStatsValue(statId, numeric), name];
            }}
            labelFormatter={(label) => `Week ${label}`}
            contentStyle={chartTooltipStyle}
          />
          {series.map((item) => (
            <Line
              key={item.id}
              type="monotone"
              dataKey={item.id}
              name={item.label}
              stroke={item.color}
              strokeWidth={item.rostered ? 2.5 : 1.5}
              strokeOpacity={item.rostered ? 1 : 0.45}
              dot={{ r: item.rostered ? 3 : 2 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

/** Outside the chart's button wrapper so assistive tech can read the player names. */
function TeamStatsLegend({ series }: { series: readonly TeamStatsChartSeries[] }) {
  return (
    <ul className="team-stats-legend" aria-label="Chart legend">
      {series.map((item) => (
        <li key={item.id} className={item.rostered ? "is-rostered" : undefined}>
          <i style={{ background: item.color, opacity: item.rostered ? 1 : 0.6 }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function TeamStatsWeekTable({
  gridRows,
  gridWeeks,
  isSnaps,
  statId,
  statLabel,
  selectedGroup,
  maxShare,
  shareLabel,
  playerLink,
}: {
  gridRows: Array<{
    row: TeamStatsPlayerRow;
    averageLabel: string;
    completedTotal: number;
    rostered: boolean;
    cells: Map<number, TeamStatsPlayerRow["weeks"][number]>;
  }>;
  gridWeeks: Array<{ week: number; total: number }>;
  isSnaps: boolean;
  statId: TeamStatsStatId;
  statLabel: string;
  selectedGroup: TeamStatsGroupId;
  maxShare: number;
  shareLabel: (total: number) => string;
  playerLink?: PlayerLinkResolver;
}) {
  return (
    <div className="team-usage-scroll">
      <table className="team-usage">
        <caption className="sr-only">{`${statLabel} by player and week. ${teamStatsLegendCaption(statId)}`}</caption>
        <thead>
          <tr>
            <th scope="col" className="team-usage-player">Player</th>
            {isSnaps ? null : <th scope="col" className="team-usage-share">Share</th>}
            <th scope="col" className="team-usage-average">Avg</th>
            {gridWeeks.map((stack) => <th scope="col" key={stack.week}>{`W${stack.week}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {gridRows.map(({ row, averageLabel, completedTotal, rostered, cells }) => (
            <tr key={row.key} className={rostered ? "is-my-roster" : undefined}>
              <th scope="row" className="team-usage-player">
                <PlayerNameLink
                  link={playerLink?.({ playerId: row.playerId, name: row.name, team: row.team, position: row.position }) ?? null}
                  label={`Open ${row.name}`}
                >
                  <span className="team-usage-name">
                    <span className="team-usage-name-full">{row.name}</span>
                    <span className="team-usage-name-short" aria-hidden="true">{shortPlayerName(row.name)}</span>
                  </span>
                </PlayerNameLink>
                {selectedGroup === "ALL" ? <span className="team-usage-position">{row.position}</span> : null}
              </th>
              {isSnaps ? null : <td className="team-usage-share">{shareLabel(completedTotal)}</td>}
              <td className="team-usage-average">{averageLabel}</td>
              {gridWeeks.map((stack) => {
                const cell = cells.get(stack.week);
                if (!cell?.hasSourceRow) {
                  return <td key={stack.week} className="is-empty">—</td>;
                }
                const intensity = isSnaps
                  ? (cell.percent ?? 0) / 100
                  : stack.total > 0 && maxShare > 0 ? cell.value / stack.total / maxShare : 0;
                return (
                  <td key={stack.week} style={{ backgroundColor: cellShade(intensity) }}>
                    {isSnaps ? displayTeamStatsPercent(cell.percent ?? 0) : displayTeamStatsValue(statId, cell.value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TeamStatsSummaryItem = { label: string; value: string; detail?: string };

function TeamStatsSummary({ items }: { items: readonly TeamStatsSummaryItem[] }) {
  return (
    <dl className="team-stats-summary">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>
            <strong>{item.value}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Summary first, then the week-by-week grid, then how to read it. */
function TeamStatsDialogBody({
  summary,
  note,
  isSnaps,
  table,
}: {
  summary: readonly TeamStatsSummaryItem[];
  note: string;
  isSnaps: boolean;
  table: Parameters<typeof TeamStatsWeekTable>[0];
}) {
  return (
    <div className="team-stats-dialog">
      <TeamStatsSummary items={summary} />
      <section className="team-stats-dialog-section" aria-label="Week by week">
        <div className="team-stats-dialog-heading">
          <h3>Week by week</h3>
          <span className="team-stats-shade-key" aria-hidden="true">
            <span>{isSnaps ? "Fewer snaps" : "Smaller share"}</span>
            <i />
            <span>{isSnaps ? "More snaps" : "Bigger share"}</span>
          </span>
        </div>
        <TeamStatsWeekTable {...table} />
      </section>
      <p className="team-stats-dialog-note">{note}</p>
    </div>
  );
}

export type TeamStatsSelection = {
  teamStatsTeam?: string | null;
  teamStatsGroup?: string | null;
  teamStatsStat?: string | null;
};

export function TeamStatsPanel({
  league,
  season,
  week,
  initial,
  onSelectionChange,
  playerLink,
}: {
  league: League;
  season: number;
  week: number;
  /** Selection from the URL (a link into this tool); invalid values are ignored. */
  initial?: { team: string | null; group: string | null; stat: string | null };
  /** Called when the user changes a control, so the URL can follow. */
  onSelectionChange?: (patch: TeamStatsSelection) => void;
  /** Resolves a legend player to their card; players that don't resolve stay plain text. */
  playerLink?: PlayerLinkResolver;
}) {
  const rosterPlayers = useMemo(
    () => [...league.starters, ...league.bench],
    [league.bench, league.starters],
  );
  const rosterTeams = useMemo(
    () => rosterPlayers.map((player) => player.team),
    [rosterPlayers],
  );

  const defaultTeam = useMemo(() => defaultTeamStatsTeam(rosterTeams), [rosterTeams]);
  const initialTeam = initial?.team && NFL_TEAM_CODES.includes(initial.team as typeof NFL_TEAM_CODES[number])
    ? initial.team
    : null;
  const initialGroup = parseTeamStatsGroup(initial?.group);
  const initialStat = TEAM_STATS_STAT_OPTIONS.find((option) => option.id === initial?.stat)?.id ?? null;
  const [userTeam, setUserTeam] = useState<string | null>(initialTeam);
  const selectedTeam = userTeam && NFL_TEAM_CODES.includes(userTeam as typeof NFL_TEAM_CODES[number])
    ? userTeam
    : defaultTeam;

  const defaultGroup = useMemo(
    () => defaultTeamStatsGroup(rosterPlayers, selectedTeam),
    [rosterPlayers, selectedTeam],
  );
  const [userGroup, setUserGroup] = useState<TeamStatsGroupId | null>(initialGroup);
  const selectedGroup = userGroup ?? defaultGroup;

  const [statId, setStatId] = useState<TeamStatsStatId>(initialStat ?? "snaps");
  const [tableOpen, setTableOpen] = useState(false);

  // The URL is the source of truth while this tool is open: a link that drops
  // a parameter returns that control to its default instead of keeping the
  // previous link's value.
  useEffect(() => { setUserTeam(initialTeam); }, [initialTeam]);
  useEffect(() => { setUserGroup(initialGroup); }, [initialGroup]);
  useEffect(() => { setStatId(initialStat ?? "snaps"); }, [initialStat]);

  const throughWeek = Math.max(1, week);

  const dataQuery = useQuery({
    queryKey: ["nflverse-team-week-stats", season],
    // Parsed server-side via /api/pfn-tables: the nflverse CSVs live on
    // GitHub release assets, which send no CORS headers for browser fetch.
    queryFn: () => api.getTeamWeekStats({ season }),
    staleTime: TEAM_WEEK_STATS_STALE_MS,
    gcTime: TEAM_WEEK_STATS_STALE_MS * 2,
    retry: 1,
  });

  const rows = useMemo(() => {
    if (!dataQuery.data) return [];
    return buildTeamStatsTable({
      stats: dataQuery.data.stats,
      snaps: dataQuery.data.snaps,
      team: selectedTeam,
      positions: TEAM_STATS_GROUP_POSITIONS[selectedGroup],
      statId,
      throughWeek,
      scoringSettings: league.scoringSettings,
    });
  }, [dataQuery.data, league.scoringSettings, selectedGroup, selectedTeam, statId, throughWeek]);

  const statLabel = TEAM_STATS_STAT_OPTIONS.find((option) => option.id === statId)?.label ?? "";
  // Snap counts mean little across players, so snaps read as each player's snap %.
  const isSnaps = statId === "snaps";
  // Weeks with recorded stats for the team and group, read from the source rows
  // before the table drops players with no season activity: a week only they
  // played (no TE touchdowns) keeps its column and counts toward the averages.
  // Byes and unplayed weeks get no column. Each week's total sums the signed
  // values, so a quarterback's negative fantasy week counts against it.
  const gridWeeks = useMemo(() => {
    if (!dataQuery.data) return [];
    return teamStatsRecordedWeeks({
      stats: dataQuery.data.stats,
      snaps: dataQuery.data.snaps,
      team: selectedTeam,
      positions: TEAM_STATS_GROUP_POSITIONS[selectedGroup],
      statId,
      throughWeek,
    }).map((weekNumber) => ({
      week: weekNumber,
      total: rows.reduce((sum, row) => sum + (row.weeks.find((cell) => cell.week === weekNumber)?.value ?? 0), 0),
    }));
  }, [dataQuery.data, rows, selectedGroup, selectedTeam, statId, throughWeek]);

  // Completed recorded weeks (excludes byes and the in-progress week) — the
  // denominator for each player's per-game average.
  const completedWeeks = useMemo(() => gridWeeks.filter((stack) => stack.week < week), [gridWeeks, week]);
  const playedWeeks = Math.max(1, completedWeeks.length);

  // Per-game averages over completed weeks only: a partial in-progress week
  // would otherwise leak in (CodeRabbit, PR #129). Rows sort by this average.
  const gridRows = useMemo(() => rows.map((row) => {
    const completedCells = row.weeks.filter((cell) => cell.week < week);
    const completedTotal = completedCells.reduce((sum, cell) => sum + cell.value, 0);
    const value = isSnaps
      ? completedCells.reduce((sum, cell) => sum + (cell.percent ?? 0), 0) / playedWeeks
      : completedTotal / playedWeeks;
    return {
      row,
      average: value,
      completedTotal,
      averageLabel: isSnaps ? displayTeamStatsPercent(value) : formatTeamStatsAverage(value),
      rostered: isRosteredPlayer(row, league),
      cells: new Map(row.weeks.map((cell) => [cell.week, cell])),
    };
  }).sort((left, right) => right.average - left.average), [isSnaps, league, playedWeeks, rows, week]);

  // Count stats tint by each player's share of that week, scaled so the
  // largest share in the grid is the darkest cell (a group of ten rarely
  // has anyone near 100%). Snaps tint by the snap % itself.
  const maxShare = useMemo(() => Math.max(0, ...gridWeeks.flatMap((stack) => (
    stack.total > 0 ? rows.map((row) => (row.weeks.find((cell) => cell.week === stack.week)?.value ?? 0) / stack.total) : []
  ))), [gridWeeks, rows]);

  const groupTotal = completedWeeks.reduce((sum, stack) => sum + stack.total, 0);
  // Each player's slice of the group's season total: how the team splits the work.
  // Snaps have none; their Avg is already each player's own snap %.
  // Signed, like the weekly totals: a negative fantasy player shows a negative
  // share, so the Share column still adds to 100%.
  const shareLabel = (total: number) => (groupTotal > 0 ? displayTeamStatsPercent((total / groupTotal) * 100) : "—");

  const chartSeries = useMemo(
    () => buildTeamStatsChartSeries(rows, gridWeeks.map((stack) => stack.week), isSnaps, league),
    [gridWeeks, isSnaps, league, rows],
  );

  const unavailable = dataQuery.isError;
  const loading = dataQuery.isPending;

  const tableProps = {
    gridRows,
    gridWeeks,
    isSnaps,
    statId,
    statLabel,
    selectedGroup,
    maxShare,
    shareLabel,
    playerLink,
  };

  const groupLabel = TEAM_STATS_GROUPS.find((group) => group.id === selectedGroup)?.label ?? selectedGroup;
  const firstWeek = completedWeeks[0]?.week;
  const lastWeek = completedWeeks[completedWeeks.length - 1]?.week;
  const dialogSubtitle = [
    groupLabel,
    firstWeek === undefined ? null : firstWeek === lastWeek ? `Week ${firstWeek}` : `Weeks ${firstWeek}–${lastWeek}`,
  ].filter(Boolean).join(" · ");
  const leader = gridRows[0];
  const summary: TeamStatsSummaryItem[] = isSnaps
    ? [
      { label: "Top snap share", value: leader ? displayTeamStatsPercent(leader.average) : "—", detail: leader ? shortPlayerName(leader.row.name) : undefined },
      { label: "Players", value: formatWhole(gridRows.length) },
      { label: "Games", value: formatWhole(completedWeeks.length) },
    ]
    : [
      { label: "Leader", value: leader ? shareLabel(leader.completedTotal) : "—", detail: leader ? shortPlayerName(leader.row.name) : undefined },
      { label: "Team per game", value: groupTotal === 0 ? "—" : statId === "fantasy_points" ? formatPoints(groupTotal / playedWeeks) : formatTeamStatsAverage(groupTotal / playedWeeks) },
      { label: "Games", value: formatWhole(completedWeeks.length) },
    ];
  const dialogNote = isSnaps
    ? `${teamStatsLegendCaption(statId)} Shading follows each player's snap %.`
    : `${teamStatsLegendCaption(statId)} Share is each player's slice of the group's season total; shading is their share of that week.`;

  return (
    <section className="monitor-section monitor-team-stats-panel">
      <header className="sr-only">
        <h2>Team stats</h2>
      </header>

      <div className="monitor-value-chart-controls monitor-team-stats-controls">
        <SegmentedControl
          className="monitor-team-stats-group"
          value={selectedGroup}
          onChange={(value) => {
            setUserGroup(value);
            onSelectionChange?.({ teamStatsGroup: value });
          }}
          label="Position"
          options={TEAM_STATS_GROUPS.map((group) => ({ value: group.id, label: group.label }))}
        />
        <label className="monitor-value-chart-field">
          <span>Team</span>
          <select
            aria-label="Team"
            value={selectedTeam}
            onChange={(event) => {
              setUserTeam(event.target.value);
              setUserGroup(null);
              onSelectionChange?.({ teamStatsTeam: event.target.value, teamStatsGroup: null });
            }}
          >
            {NFL_TEAM_CODES.map((team) => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
        </label>
        <label className="monitor-value-chart-field">
          <span>Stat</span>
          <select
            aria-label="Stat"
            value={statId}
            onChange={(event) => {
              setStatId(event.target.value as TeamStatsStatId);
              onSelectionChange?.({ teamStatsStat: event.target.value });
            }}
          >
            {TEAM_STATS_STAT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {unavailable ? (
        <SectionError
          title="Team stats didn’t load."
          onRetry={() => void dataQuery.refetch()}
          retrying={dataQuery.isFetching}
          compact
        />
      ) : loading ? (
        <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading Team stats…">
          <span>Loading…</span>
        </section>
      ) : rows.length === 0 ? (
        <p className="monitor-empty">No players</p>
      ) : (
        <>
          <div className="team-stats-chart-card">
            <div
              className="team-stats-chart-open"
              role="button"
              tabIndex={0}
              aria-label={`Open ${statLabel} week-by-week table`}
              onClick={() => setTableOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setTableOpen(true);
                }
              }}
            >
              <TeamStatsLineChart
                series={chartSeries}
                weeks={gridWeeks.map((stack) => stack.week)}
                statId={statId}
                statLabel={statLabel}
                isSnaps={isSnaps}
                ariaLabel={`${selectedTeam} ${statLabel} by week`}
              />
            </div>
            <TeamStatsLegend series={chartSeries} />
          </div>
          <ChartDialog
            isOpen={tableOpen}
            onClose={() => setTableOpen(false)}
            title={`${selectedTeam} · ${statLabel}`}
            subtitle={dialogSubtitle}
            showCount={false}
            closeLabel="Close team stats table"
            className="monitor-chart-expand-card team-stats-table-dialog"
          >
            <TeamStatsDialogBody summary={summary} note={dialogNote} isSnaps={isSnaps} table={tableProps} />
          </ChartDialog>
        </>
      )}
    </section>
  );
}
