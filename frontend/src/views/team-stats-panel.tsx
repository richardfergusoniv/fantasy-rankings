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
 * Player colors for the stacked bars, built from the app's three chart
 * families (amber chart-1, blue chart-5, slate chart-2). Each family spans
 * its full lightness range — pale tint, base, deep shade — and the rank
 * order cycles families while alternating ends, so a hue only ever repeats
 * at the opposite end of its scale (bright gold vs deep bronze, never two
 * mid-tones side by side). Green and red stay reserved for good/bad.
 */
const TEAM_STATS_PALETTE = [
  "var(--chart-1)",
  "color-mix(in srgb, var(--chart-5) 45%, black)",
  "color-mix(in srgb, var(--chart-2) 40%, white)",
  "color-mix(in srgb, var(--chart-1) 45%, black)",
  "var(--chart-5)",
  "color-mix(in srgb, var(--chart-2) 50%, black)",
  "var(--accent)",
  "color-mix(in srgb, var(--chart-5) 40%, white)",
  "var(--chart-2)",
  "color-mix(in srgb, var(--chart-5) 35%, var(--chart-2))",
];
const TEAM_STATS_OTHER_COLOR = "color-mix(in srgb, var(--chart-2) 65%, black)";

/** Legend averages keep one decimal (season totals in the chart stay whole). */
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
  const initialGroup = TEAM_STATS_GROUPS.find((group) => group.id === initial?.group)?.id ?? null;
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

  // Completed weeks the team actually produced in (excludes byes and the
  // in-progress week) — the denominator for the legend's per-week average.
  const playedWeeks = useMemo(
    () => Math.max(
      1,
      stacks.filter((stack) => stack.week < week && stack.hasActivity).length,
    ),
    [stacks, week],
  );

  const playerMeta = useMemo(() => {
    const meta = new Map<string, { color: string; rostered: boolean }>();
    rows.forEach((row, index) => {
      meta.set(row.key, {
        color: TEAM_STATS_PALETTE[index % TEAM_STATS_PALETTE.length]!,
        rostered: isRosteredPlayer(row, league),
      });
    });
    return meta;
  }, [league, rows]);

  const unavailable = dataQuery.isError;
  const loading = dataQuery.isPending;

  return (
    <section className="monitor-section monitor-team-stats-panel">
      <header className="section-heading">
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
        <div className="team-stats-chart-wrap">
          <div className="team-stats-chart">
            {stacks.map((stack) => (
              <div key={stack.week} className="team-stats-week">
                <div className="team-stats-bar">
                  {stack.segments.map((segment) => {
                    const meta = playerMeta.get(segment.key);
                    return (
                      <span
                        key={segment.key}
                        className="team-stats-seg"
                        style={{
                          height: `${segment.share * 100}%`,
                          backgroundColor: segment.key === "__other__"
                            ? TEAM_STATS_OTHER_COLOR
                            : meta?.color ?? TEAM_STATS_OTHER_COLOR,
                        }}
                        title={`${segment.name} · W${stack.week}: ${formatTeamStatsValue(statId, segment.value)} (${formatTeamStatsPercent(segment.share * 100)})`}
                      />
                    );
                  })}
                </div>
                <span className="team-stats-week-label">{`W${stack.week}`}</span>
                <span className="team-stats-week-total">
                  {stack.total > 0 ? formatTeamStatsValue(statId, stack.total) : "—"}
                </span>
              </div>
            ))}
          </div>
          <ul className="team-stats-legend">
            {rows.map((row) => {
              const meta = playerMeta.get(row.key);
              // Completed weeks only: a partial in-progress week would
              // otherwise leak into the average (CodeRabbit, PR #129).
              const completedEntries = Object.entries(row.weeks)
                .filter(([weekKey]) => Number(weekKey) < week);
              const completedTotal = completedEntries
                .reduce((sum, [, cell]) => sum + (cell?.value ?? 0), 0);
              const completedPercentTotal = completedEntries
                .reduce((sum, [, cell]) => sum + (cell?.percent ?? 0), 0);
              return (
                <li key={row.key} className={meta?.rostered ? "is-my-roster" : undefined}>
                  <i style={{ backgroundColor: meta?.color ?? TEAM_STATS_OTHER_COLOR }} />
                  <span className="team-stats-legend-name">
                    <PlayerNameLink
                      link={playerLink?.({ playerId: row.playerId, name: row.name, team: row.team, position: row.position }) ?? null}
                      label={`Open ${row.name}`}
                    >
                      {row.name}
                    </PlayerNameLink>
                  </span>
                  <span className="team-stats-legend-total">
                    {statId === "snaps" || statId === "targets"
                      ? formatTeamStatsPercent(completedPercentTotal / playedWeeks)
                      : formatTeamStatsAverage(completedTotal / playedWeeks)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
