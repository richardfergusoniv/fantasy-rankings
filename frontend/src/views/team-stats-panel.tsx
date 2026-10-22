import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  NFL_TEAM_CODES,
  TEAM_STATS_GROUP_POSITIONS,
  TEAM_STATS_GROUPS,
  TEAM_STATS_STAT_OPTIONS,
  TEAM_WEEK_STATS_STALE_MS,
  buildTeamStatsTable,
  buildTeamStatsWeekStacks,
  canonicalNflTeam,
  defaultTeamStatsGroup,
  defaultTeamStatsTeam,
  formatTeamStatsPercent,
  formatTeamStatsValue,
  normalizeTeamStatsPlayerName,
  parseTeamStatsGroup,
  teamStatsLegendCaption,
  type TeamStatsGroupId,
  type TeamStatsStatId,
} from "../../../api/_lib/nflverse-team-week-stats";
import { api } from "../api";
import { SectionError } from "../dashboard-shared";
import type { League } from "../dashboard-types";
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

/** Averages keep one decimal (weekly values stay whole). */
function formatTeamStatsAverage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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

  const stacks = useMemo(() => buildTeamStatsWeekStacks(rows), [rows]);

  const statLabel = TEAM_STATS_STAT_OPTIONS.find((option) => option.id === statId)?.label ?? "";
  // Snap counts mean little across players, so snaps read as each player's snap %.
  const isSnaps = statId === "snaps";
  // Weeks with recorded stats; byes and unplayed weeks get no column. A
  // recorded week where the whole group made zero (no TE touchdowns) still
  // counts: it shows its zeros and counts toward the averages.
  const gridWeeks = useMemo(
    () => stacks.filter((stack) => rows.some((row) => (
      row.weeks.some((cell) => cell.week === stack.week && cell.hasSourceRow)
    ))),
    [rows, stacks],
  );

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
      averageLabel: isSnaps ? formatTeamStatsPercent(value) : formatTeamStatsAverage(value),
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
  const groupAverage = groupTotal / playedWeeks;
  // Each player's slice of the group's season total: how the team splits the work.
  // Snaps have none; their Avg is already each player's own snap %.
  const shareLabel = (total: number) => (groupTotal > 0 ? formatTeamStatsPercent((Math.max(0, total) / groupTotal) * 100) : "—");

  const unavailable = dataQuery.isError;
  const loading = dataQuery.isPending;

  return (
    <section className="monitor-section monitor-team-stats-panel">
      <header className="sr-only">
        <h2>Team stats</h2>
      </header>

      <div className="monitor-value-chart-controls monitor-team-stats-controls">
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
        <div className="team-usage-scroll">
          <table className="team-usage">
            <caption className="sr-only">{`${statLabel} by player and week. ${teamStatsLegendCaption(statId)}`}</caption>
            <thead>
              <tr>
                <th scope="col" className="team-usage-player">Player</th>
                {isSnaps ? null : <th scope="col" className="team-usage-share">Share</th>}
                {gridWeeks.map((stack) => <th scope="col" key={stack.week}>{`W${stack.week}`}</th>)}
                <th scope="col" className="team-usage-average">Avg</th>
              </tr>
            </thead>
            <tbody>
              {isSnaps ? null : (
                <tr className="team-usage-total">
                  <th scope="row" className="team-usage-player">Total</th>
                  <td className="team-usage-share">{groupTotal > 0 ? "100%" : "—"}</td>
                  {gridWeeks.map((stack) => (
                    <td key={stack.week}>{formatTeamStatsValue(statId, stack.total)}</td>
                  ))}
                  <td className="team-usage-average">{formatTeamStatsAverage(groupAverage)}</td>
                </tr>
              )}
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
                        {isSnaps ? formatTeamStatsPercent(cell.percent ?? 0) : formatTeamStatsValue(statId, cell.value)}
                      </td>
                    );
                  })}
                  <td className="team-usage-average">{averageLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
