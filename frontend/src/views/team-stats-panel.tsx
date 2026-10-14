import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  NFL_TEAM_CODES,
  TEAM_STATS_POSITIONS,
  TEAM_STATS_STAT_OPTIONS,
  TEAM_WEEK_STATS_STALE_MS,
  buildTeamStatsTable,
  canonicalNflTeam,
  defaultTeamStatsPosition,
  defaultTeamStatsTeam,
  formatTeamStatsPercent,
  formatTeamStatsValue,
  nflversePlayerWeekStatsUrl,
  nflverseSnapCountsUrl,
  normalizeTeamStatsPlayerName,
  parsePlayerWeekStatsCsv,
  parseTeamWeekSnapCountsCsv,
  teamStatsStatDef,
  type TeamStatsPosition,
  type TeamStatsStatId,
} from "../../../api/_lib/nflverse-team-week-stats";
import type { League } from "../dashboard-types";

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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`team stats HTTP ${response.status}`);
  return response.text();
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
  const statDef = teamStatsStatDef(statId);

  const throughWeek = Math.max(1, week);

  const dataQuery = useQuery({
    queryKey: ["nflverse-team-week-stats", season],
    queryFn: async () => {
      const [statsCsv, snapsCsv] = await Promise.all([
        fetchText(nflversePlayerWeekStatsUrl(season)),
        fetchText(nflverseSnapCountsUrl(season)),
      ]);
      const stats = parsePlayerWeekStatsCsv(statsCsv);
      const snaps = parseTeamWeekSnapCountsCsv(snapsCsv);
      if (stats.length === 0 && snaps.length === 0) {
        throw new Error("team stats parse failed");
      }
      return { stats, snaps };
    },
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

  const weekColumns = useMemo(
    () => Array.from({ length: throughWeek }, (_, index) => index + 1),
    [throughWeek],
  );

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
        <div className="team-stats-scroll">
          <table className="team-stats-table">
            <thead>
              <tr>
                <th scope="col" className="team-stats-player-col">{selectedPosition}</th>
                {weekColumns.map((weekNumber) => (
                  <th key={weekNumber} scope="col">{`Wk ${weekNumber}`}</th>
                ))}
                <th scope="col" className="team-stats-total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rostered = isRosteredPlayer(row, league);
                return (
                  <tr key={row.key} className={rostered ? "is-my-roster" : undefined}>
                    <th scope="row" className="team-stats-player-col">
                      <span className="team-stats-player-name">{row.name}</span>
                    </th>
                    {row.weeks.map((cell) => {
                      const percent = cell.percent;
                      const showStack = Boolean(statDef.percentOf) && percent !== null;
                      return (
                        <td key={cell.week}>
                          {showStack && percent !== null ? (
                            <span className="team-stats-stack">
                              <span className="team-stats-count">{formatTeamStatsValue(statId, cell.value)}</span>
                              <strong className="team-stats-pct">{formatTeamStatsPercent(percent)}</strong>
                            </span>
                          ) : (
                            <span className="team-stats-value">
                              {formatTeamStatsValue(statId, cell.value)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="team-stats-total-col">
                      <span className="team-stats-value">{formatTeamStatsValue(statId, row.total)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
