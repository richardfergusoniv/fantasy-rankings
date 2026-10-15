import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  NFL_TEAM_CODES,
  TEAM_STATS_POSITIONS,
  TEAM_STATS_STAT_OPTIONS,
  TEAM_WEEK_STATS_STALE_MS,
  buildTeamStatsTable,
  buildTeamStatsWeekStacks,
  canonicalNflTeam,
  defaultTeamStatsPosition,
  defaultTeamStatsTeam,
  formatTeamStatsPercent,
  formatTeamStatsValue,
  normalizeTeamStatsPlayerName,
  type TeamStatsPosition,
  type TeamStatsStatId,
} from "../../../api/_lib/nflverse-team-week-stats";
import { api } from "../api";
import type { League } from "../dashboard-types";

/** Categorical player colors for the stacked bars (never the good/bad green/red). */
const TEAM_STATS_PALETTE = [
  "#f0b429", "#60a5fa", "#a78bfa", "#fb923c", "#22d3ee",
  "#f472b6", "#818cf8", "#facc15", "#9aa3b5", "#e879f9",
];
const TEAM_STATS_OTHER_COLOR = "#4b5563";

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

export function TeamStatsPanel({
  league,
  season,
  week,
}: {
  league: League;
  season: number;
  week: number;
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
  const [userTeam, setUserTeam] = useState<string | null>(null);
  const selectedTeam = userTeam && NFL_TEAM_CODES.includes(userTeam as typeof NFL_TEAM_CODES[number])
    ? userTeam
    : defaultTeam;

  const defaultPosition = useMemo(
    () => defaultTeamStatsPosition(rosterPlayers, selectedTeam),
    [rosterPlayers, selectedTeam],
  );
  const [userPosition, setUserPosition] = useState<TeamStatsPosition | null>(null);
  const selectedPosition = userPosition ?? defaultPosition;

  const [statId, setStatId] = useState<TeamStatsStatId>("snaps");

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
      position: selectedPosition,
      statId,
      throughWeek,
    });
  }, [dataQuery.data, selectedPosition, selectedTeam, statId, throughWeek]);

  const stacks = useMemo(() => buildTeamStatsWeekStacks(rows), [rows]);

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
    <article className="monitor-panel monitor-team-stats-panel">
      <header className="monitor-panel-header">
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
              setUserPosition(null);
            }}
          >
            {NFL_TEAM_CODES.map((team) => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
        </label>
        <label className="monitor-value-chart-field">
          <span>Position</span>
          <select
            aria-label="Position"
            value={selectedPosition}
            onChange={(event) => setUserPosition(event.target.value as TeamStatsPosition)}
          >
            {TEAM_STATS_POSITIONS.map((position) => (
              <option key={position} value={position}>{position}</option>
            ))}
          </select>
        </label>
        <label className="monitor-value-chart-field">
          <span>Stat</span>
          <select
            aria-label="Stat"
            value={statId}
            onChange={(event) => setStatId(event.target.value as TeamStatsStatId)}
          >
            {TEAM_STATS_STAT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {unavailable ? (
        <p className="monitor-empty">Unavailable</p>
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
                    const rostered = segment.key === "__other__" ? false : meta?.rostered ?? false;
                    return (
                      <span
                        key={segment.key}
                        className="team-stats-seg"
                        style={{
                          height: `${segment.share * 100}%`,
                          backgroundColor: segment.key === "__other__"
                            ? TEAM_STATS_OTHER_COLOR
                            : meta?.color ?? TEAM_STATS_OTHER_COLOR,
                          boxShadow: rostered ? "inset 0 0 0 2px var(--foreground)" : undefined,
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
              return (
                <li key={row.key} className={meta?.rostered ? "is-my-roster" : undefined}>
                  <i style={{ backgroundColor: meta?.color ?? TEAM_STATS_OTHER_COLOR }} />
                  <span className="team-stats-legend-name">{row.name}</span>
                  <span className="team-stats-legend-total">{formatTeamStatsValue(statId, row.total)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}
