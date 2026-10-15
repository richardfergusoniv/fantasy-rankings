import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ALL_GAMES_PICKER_ID,
  GAME_LINES_STALE_MS,
  NFLVERSE_GAMES_CSV_URL,
  buildTeamSeasonRatings,
  defaultGameLineCardId,
  formatCoverRecord,
  formatSpreadFavorite,
  formatTotalLine,
  gamesForSeasonWeek,
  normalizeGameLineTeam,
  parseGamesCsv,
  projectGameLine,
  toGameLineCard,
  type GameLineCard,
  type GameLineProjection,
  type NflverseGameRow,
} from "../../../api/_lib/nflverse-game-lines";
import {
  TEAM_WEEK_STATS_STALE_MS,
  canonicalNflTeam,
} from "../../../api/_lib/nflverse-team-week-stats";
import {
  PROP_POSITIONS,
  PROP_STAT_OPTIONS,
  buildOpponentTopAllowances,
  buildPropEdgeHistory,
  indexWeekStatsByPlayer,
  isPropStatId,
  opponentAllowanceKey,
  propPlayerMatchKey,
  propStatDef,
  type PropGameResult,
  type PropPosition,
} from "../../../api/_lib/prop-line-reads";
import { api } from "../api";
import type { League } from "../dashboard-types";
import { formatDecimal } from "../lib/format-number";

type ScopeFilter = "mine" | "all";

type PropTableRow = {
  key: string;
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  stat: string;
  statLabel: string;
  line: number;
  move: number | null;
  hitRate: number | null;
  overs: number;
  unders: number;
  cells: Array<{ week: number; actual: number; result: PropGameResult }>;
  projection: number | null;
  edge: number | null;
  opponent: string | null;
  /** What the opponent has allowed the top opposing player at this position, per game. */
  oppAllowed: number | null;
  oppGames: number;
  /** projection − oppAllowed; positive favors the player. */
  vsOpp: number | null;
  absEdge: number;
  rostered: boolean;
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`game lines HTTP ${response.status}`);
  return response.text();
}

function formatPropNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return formatDecimal(value, digits);
}

function formatMove(move: number | null): string {
  if (move === null || !Number.isFinite(move) || move === 0) return "—";
  return formatDecimal(move, 1, { sign: "exceptZero" });
}

function formatHitRate(overs: number, unders: number, hitRate: number | null): string {
  if (hitRate === null) return "—";
  const decided = overs + unders;
  return `${overs}/${decided}`;
}

function hitRateTone(overs: number, unders: number): "over" | "under" | "push" | undefined {
  if (overs > unders) return "over";
  if (unders > overs) return "under";
  if (overs + unders > 0) return "push";
  return undefined;
}

function asPropPosition(value: string | null | undefined): PropPosition | null {
  if (!value) return null;
  return (PROP_POSITIONS as readonly string[]).includes(value) ? value as PropPosition : null;
}

function rosterIdSet(league: League): Set<string> {
  const ids = new Set<string>();
  for (const player of [...league.starters, ...league.bench]) {
    if (player.playerId) ids.add(player.playerId);
  }
  return ids;
}

function rosterMatchKeys(league: League): Set<string> {
  const keys = new Set<string>();
  for (const player of [...league.starters, ...league.bench]) {
    if (!player.name || !player.position) continue;
    keys.add(propPlayerMatchKey(player.name, player.team, player.position));
  }
  return keys;
}

function GameProjectionBlock({
  card,
  projection,
}: {
  card: GameLineCard;
  projection: GameLineProjection | null;
}) {
  const spreadProj = projection?.projectedHomeMargin == null
    ? "—"
    : formatSpreadFavorite(card.awayTeam, card.homeTeam, projection.projectedHomeMargin);
  const totalProj = projection?.projectedTotal == null
    ? "—"
    : formatTotalLine(Number(projection.projectedTotal.toFixed(1)));

  return (
    <div className="monitor-game-line-card">
      <strong className="monitor-game-line-matchup">{card.matchup}</strong>
      <span className="monitor-game-line-kickoff">{card.kickoffPt}</span>

      <div className="monitor-game-line-market">
        <span className="monitor-game-line-market-label">Spread</span>
        <span>{card.spread}</span>
        <span className="monitor-game-line-market-proj">{spreadProj}</span>
        <span className="monitor-game-line-market-edge">{formatPropNumber(projection?.spreadEdge ?? null, 1)}</span>
      </div>
      <div className="monitor-game-line-records">
        <span>{card.awayTeam} ATS {formatCoverRecord(projection?.awayAts ?? { wins: 0, losses: 0, pushes: 0 })}</span>
        <span>{card.homeTeam} ATS {formatCoverRecord(projection?.homeAts ?? { wins: 0, losses: 0, pushes: 0 })}</span>
      </div>

      <div className="monitor-game-line-market">
        <span className="monitor-game-line-market-label">Total</span>
        <span>{card.total}</span>
        <span className="monitor-game-line-market-proj">{totalProj}</span>
        <span className="monitor-game-line-market-edge">{formatPropNumber(projection?.totalEdge ?? null, 1)}</span>
      </div>
      <div className="monitor-game-line-records">
        <span>{card.awayTeam} O/U {formatCoverRecord(projection?.awayOu ?? { wins: 0, losses: 0, pushes: 0 })}</span>
        <span>{card.homeTeam} O/U {formatCoverRecord(projection?.homeOu ?? { wins: 0, losses: 0, pushes: 0 })}</span>
      </div>
    </div>
  );
}

export function GameLinesPanel({
  league,
  season,
  week,
}: {
  league: League;
  season: number;
  week: number;
}) {
  const [position, setPosition] = useState<PropPosition | "ALL">("ALL");
  const [statId, setStatId] = useState<string>("ALL");
  const [scope, setScope] = useState<ScopeFilter>("mine");
  const [userGameId, setUserGameId] = useState<string | null>(null);

  const gamesQuery = useQuery({
    queryKey: ["nflverse-game-lines", season, week],
    queryFn: async () => {
      const csv = await fetchText(NFLVERSE_GAMES_CSV_URL);
      const rows = parseGamesCsv(csv);
      if (rows.length === 0) throw new Error("game lines parse failed");
      const weekRows = gamesForSeasonWeek(rows, season, week);
      const cards = weekRows.map(toGameLineCard);
      return { rows, weekRows, cards };
    },
    staleTime: GAME_LINES_STALE_MS,
    gcTime: GAME_LINES_STALE_MS * 2,
    retry: 1,
  });

  const propLinesQuery = useQuery({
    queryKey: ["pfn-tables", season, week],
    queryFn: () => api.getPfnTables({ season, week }),
    staleTime: TEAM_WEEK_STATS_STALE_MS,
    gcTime: TEAM_WEEK_STATS_STALE_MS * 2,
    retry: 1,
  });

  const historyQuery = useQuery({
    queryKey: ["nflverse-team-week-stats", season],
    // Same server-parsed payload as the Team stats panel (shared query
    // key): GitHub release assets send no CORS headers for browser fetch.
    queryFn: () => api.getTeamWeekStats({ season }),
    staleTime: TEAM_WEEK_STATS_STALE_MS,
    gcTime: TEAM_WEEK_STATS_STALE_MS * 2,
    retry: 1,
  });

  const gameLineCards = gamesQuery.data?.cards ?? [];
  const weekRows: NflverseGameRow[] = gamesQuery.data?.weekRows ?? [];

  const rosterPlayers = useMemo(
    () => [...league.starters, ...league.bench],
    [league.bench, league.starters],
  );
  const rosterTeams = useMemo(
    () => rosterPlayers.map((player) => player.team).filter((team): team is string => Boolean(team)),
    [rosterPlayers],
  );
  const liveTeams = useMemo(
    () => rosterPlayers
      .filter((player) => player.gamePhase === "live" && player.team)
      .map((player) => player.team)
      .filter((team): team is string => Boolean(team)),
    [rosterPlayers],
  );
  const defaultGameId = useMemo(
    () => defaultGameLineCardId(gameLineCards, rosterTeams, liveTeams, Date.now()),
    [gameLineCards, liveTeams, rosterTeams],
  );

  const selectedGameId = userGameId === ALL_GAMES_PICKER_ID
    ? ALL_GAMES_PICKER_ID
    : userGameId && gameLineCards.some((card) => card.gameId === userGameId)
      ? userGameId
      : defaultGameId ?? ALL_GAMES_PICKER_ID;
  const selectedGame = selectedGameId === ALL_GAMES_PICKER_ID
    ? null
    : gameLineCards.find((card) => card.gameId === selectedGameId) ?? null;
  const selectedWeekRow = selectedGame
    ? weekRows.find((row) => row.gameId === selectedGame.gameId) ?? null
    : null;

  const ratings = useMemo(() => {
    if (!gamesQuery.data) return new Map();
    return buildTeamSeasonRatings(gamesQuery.data.rows, season, week);
  }, [gamesQuery.data, season, week]);

  const projection = useMemo(() => {
    if (!selectedWeekRow) return null;
    return projectGameLine(selectedWeekRow, ratings);
  }, [ratings, selectedWeekRow]);

  const rosterIds = useMemo(() => rosterIdSet(league), [league]);
  const rosterKeys = useMemo(() => rosterMatchKeys(league), [league]);

  const priorStats = useMemo(() => {
    const stats = historyQuery.data?.stats ?? [];
    // Prior completed weeks only — never include the slate week itself.
    const throughWeek = week - 1;
    return stats.filter((row) => row.week >= 1 && row.week <= throughWeek);
  }, [historyQuery.data?.stats, week]);

  const weekStatsByPlayer = useMemo(
    () => indexWeekStatsByPlayer(priorStats),
    [priorStats],
  );

  const opponentAllowances = useMemo(
    () => buildOpponentTopAllowances(priorStats),
    [priorStats],
  );

  // This week's opponent for each team on the slate.
  const slateOpponents = useMemo(() => {
    const opponents = new Map<string, string>();
    for (const game of weekRows) {
      opponents.set(normalizeGameLineTeam(game.awayTeam), normalizeGameLineTeam(game.homeTeam));
      opponents.set(normalizeGameLineTeam(game.homeTeam), normalizeGameLineTeam(game.awayTeam));
    }
    return opponents;
  }, [weekRows]);

  const historyWeeks = useMemo(
    () => Array.from({ length: Math.max(0, week - 1) }, (_, index) => index + 1),
    [week],
  );

  const gameTeamFilter = useMemo(() => {
    if (!selectedGame) return null;
    return new Set([
      normalizeGameLineTeam(selectedGame.awayTeam),
      normalizeGameLineTeam(selectedGame.homeTeam),
    ]);
  }, [selectedGame]);

  const propRows = useMemo(() => {
    const lines = propLinesQuery.data?.propLines.lines ?? [];
    const built: PropTableRow[] = [];

    for (const line of lines) {
      if (!isPropStatId(line.stat)) continue;
      const positionCode = asPropPosition(line.position) ?? "WR";
      if (position !== "ALL" && positionCode !== position) continue;
      if (statId !== "ALL" && line.stat !== statId) continue;

      const team = line.team ? canonicalNflTeam(line.team) : null;
      if (gameTeamFilter && (!team || !gameTeamFilter.has(normalizeGameLineTeam(team)))) {
        continue;
      }

      const matchKey = propPlayerMatchKey(line.name, team, positionCode);
      const rostered = rosterIds.has(line.playerId) || rosterKeys.has(matchKey);
      if (scope === "mine" && !rostered) continue;

      const weekRowsForPlayer = weekStatsByPlayer.get(matchKey)
        ?? weekStatsByPlayer.get(propPlayerMatchKey(line.name, line.team, positionCode))
        ?? [];
      const history = buildPropEdgeHistory(line.stat, line.line, weekRowsForPlayer);
      const def = propStatDef(line.stat);
      const opponent = team ? slateOpponents.get(normalizeGameLineTeam(team)) ?? null : null;
      const allowance = opponent
        ? opponentAllowances.get(opponentAllowanceKey(opponent, positionCode, line.stat))
        : undefined;
      built.push({
        key: `${line.playerId}|${line.stat}`,
        playerId: line.playerId,
        name: line.name,
        team,
        position: positionCode,
        stat: line.stat,
        statLabel: def?.short ?? line.stat,
        line: line.line,
        move: line.move,
        hitRate: history.hitRate,
        overs: history.overs,
        unders: history.unders,
        cells: history.cells,
        projection: history.projection,
        edge: history.edge,
        opponent,
        oppAllowed: allowance?.allowed ?? null,
        oppGames: allowance?.games ?? 0,
        vsOpp: history.projection !== null && allowance
          ? Number((history.projection - allowance.allowed).toFixed(3))
          : null,
        absEdge: history.edge === null ? -1 : Math.abs(history.edge),
        rostered,
      });
    }

    built.sort((left, right) => {
      if (right.absEdge !== left.absEdge) return right.absEdge - left.absEdge;
      if (left.rostered !== right.rostered) return left.rostered ? -1 : 1;
      return left.name.localeCompare(right.name) || left.stat.localeCompare(right.stat);
    });
    return built;
  }, [
    gameTeamFilter,
    opponentAllowances,
    position,
    propLinesQuery.data?.propLines.lines,
    rosterIds,
    rosterKeys,
    scope,
    slateOpponents,
    statId,
    weekStatsByPlayer,
  ]);

  const gamesUnavailable = gamesQuery.isError;
  const propsLoading = propLinesQuery.isPending || (historyQuery.isPending && !historyQuery.data);
  const propsUnavailable = propLinesQuery.isError;

  return (
    <article className="monitor-panel monitor-game-lines-panel">
      <header className="monitor-panel-header">
        <h2>Game lines</h2>
      </header>

      {gamesUnavailable ? (
        <p className="monitor-empty">Lines unavailable</p>
      ) : (
        <>
          <div className="monitor-value-chart-controls monitor-game-lines-controls">
            <label className="monitor-value-chart-field">
              <span>Game</span>
              <select
                aria-label="Game"
                value={selectedGameId}
                onChange={(event) => setUserGameId(event.target.value)}
              >
                <option value={ALL_GAMES_PICKER_ID}>All games</option>
                {gameLineCards.map((game) => (
                  <option key={game.gameId} value={game.gameId}>
                    {game.matchup}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedGame ? (
            <GameProjectionBlock card={selectedGame} projection={projection} />
          ) : null}

          <div className="monitor-value-chart-controls monitor-props-controls">
            <label className="monitor-value-chart-field">
              <span>Players</span>
              <select
                aria-label="Players"
                value={scope}
                onChange={(event) => setScope(event.target.value as ScopeFilter)}
              >
                <option value="mine">My players</option>
                <option value="all">All players</option>
              </select>
            </label>
            <label className="monitor-value-chart-field">
              <span>Position</span>
              <select
                aria-label="Position"
                value={position}
                onChange={(event) => setPosition(event.target.value as PropPosition | "ALL")}
              >
                <option value="ALL">All</option>
                {PROP_POSITIONS.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </label>
            <label className="monitor-value-chart-field">
              <span>Stat</span>
              <select
                aria-label="Stat"
                value={statId}
                onChange={(event) => setStatId(event.target.value)}
              >
                <option value="ALL">All</option>
                {PROP_STAT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {propsUnavailable ? (
            <p className="monitor-empty">Unavailable</p>
          ) : propsLoading ? (
            <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading props…">
              <span>Loading…</span>
            </section>
          ) : propRows.length === 0 ? (
            <p className="monitor-empty">No props</p>
          ) : (
            <div className="props-scroll">
              <table className="props-table">
                <thead>
                  <tr>
                    <th scope="col" className="props-player-col">Player</th>
                    <th scope="col">Stat</th>
                    <th scope="col">Line</th>
                    <th scope="col">Move</th>
                    <th scope="col">Hit</th>
                    <th scope="col">History</th>
                    <th scope="col">Proj</th>
                    <th scope="col">vs Opp</th>
                    <th scope="col">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {propRows.map((row) => {
                    const hitTone = hitRateTone(row.overs, row.unders);
                    const byWeek = new Map(row.cells.map((cell) => [cell.week, cell]));
                    const scaleMax = Math.max(row.line, ...row.cells.map((cell) => cell.actual), 0) || 1;
                    return (
                      <tr key={row.key} className={row.rostered ? "is-my-roster" : undefined}>
                        <th scope="row" className="props-player-col">
                          <span className="props-player-name">{row.name}</span>
                          <span className="props-player-meta">
                            {row.position}
                            {row.team ? ` · ${row.team}` : ""}
                          </span>
                        </th>
                        <td>{row.statLabel}</td>
                        <td>{formatPropNumber(row.line, 1)}</td>
                        <td>{formatMove(row.move)}</td>
                        <td>
                          <span className={hitTone ? `props-hit props-hit-${hitTone}` : "props-hit"}>
                            {formatHitRate(row.overs, row.unders, row.hitRate)}
                          </span>
                        </td>
                        <td>
                          <div
                            className="props-history"
                            role="img"
                            aria-label={row.cells.length > 0
                              ? `Weekly results against the line of ${formatPropNumber(row.line, 1)}`
                              : "No prior games this season"}
                          >
                            {historyWeeks.map((weekNumber) => {
                              const cell = byWeek.get(weekNumber);
                              if (!cell) {
                                return <span key={weekNumber} className="props-bar is-empty" title={`W${weekNumber}: no game`} />;
                              }
                              const heightPct = Math.max(4, (cell.actual / scaleMax) * 100);
                              return (
                                <span
                                  key={weekNumber}
                                  className={`props-bar is-${cell.result}`}
                                  style={{ height: `${heightPct}%` }}
                                  title={`W${weekNumber}: ${formatPropNumber(cell.actual, 1)} vs line ${formatPropNumber(row.line, 1)}`}
                                />
                              );
                            })}
                            <span
                              className="props-history-line"
                              style={{ bottom: `${(row.line / scaleMax) * 100}%` }}
                            />
                          </div>
                        </td>
                        <td>{formatPropNumber(row.projection, 1)}</td>
                        <td>
                          {row.vsOpp === null || row.oppAllowed === null ? (
                            <span className="props-game-cell is-empty">—</span>
                          ) : (
                            <span
                              className="props-vsopp"
                              title={`${row.opponent} has allowed the top opposing ${row.position} an average of ${formatPropNumber(row.oppAllowed, 1)} per game (${row.oppGames} games)`}
                            >
                              <span className={row.vsOpp > 0 ? "props-hit-over" : row.vsOpp < 0 ? "props-hit-under" : undefined}>
                                {row.vsOpp === 0 ? "0.0" : formatDecimal(row.vsOpp, 1, { sign: "exceptZero" })}
                              </span>
                              <small>{`allows ${formatPropNumber(row.oppAllowed, 1)}`}</small>
                            </span>
                          )}
                        </td>
                        <td className="props-edge">{formatPropNumber(row.edge, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </article>
  );
}
