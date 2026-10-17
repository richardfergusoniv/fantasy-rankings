import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ALL_GAMES_PICKER_ID,
  GAME_LINES_STALE_MS,
  NFLVERSE_GAMES_CSV_URL,
  buildTeamSeasonRecords,
  defaultGameLineCardId,
  formatCoverRecord,
  gamesForSeasonWeek,
  normalizeGameLineTeam,
  parseGamesCsv,
  toGameLineCard,
  type GameLineCard,
  type TeamSeasonRecords,
} from "../../../api/_lib/nflverse-game-lines";
import {
  TEAM_WEEK_STATS_STALE_MS,
  canonicalNflTeam,
} from "../../../api/_lib/nflverse-team-week-stats";
import {
  PROP_POSITIONS,
  PROP_STAT_OPTIONS,
  buildPropHistory,
  compareHitRateDesc,
  impliedProbability,
  indexWeekStatsByPlayer,
  isPropStatId,
  propPlayerMatchKey,
  propStatDef,
  type PropGameResult,
  type PropPosition,
  type PropStatId,
} from "../../../api/_lib/prop-line-reads";
import { api } from "../api";
import { SectionError } from "../dashboard-shared";
import type { League } from "../dashboard-types";
import { formatDecimal } from "../lib/format-number";
import { SegmentedControl } from "../shared";



type PropTableRow = {
  key: string;
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  stat: PropStatId;
  statLabel: string;
  line: number;
  move: number | null;
  /** Median price on the played side (under for his players, over otherwise). */
  odds: number | null;
  implied: number | null;
  /** Sleeper Picks line for this player/stat, when Sleeper offers it. */
  sleeperLine: number | null;
  /** Sleeper's line is softer than consensus for the played direction. */
  sleeperFavorable: boolean;
  /** The rate for the side played on this row (see direction); rows sort by it. */
  hitRate: number | null;
  overs: number;
  unders: number;
  cells: Array<{ week: number; actual: number; result: PropGameResult }>;
  rostered: boolean;
  /** On this week's opponent's roster in this league. */
  opponent: boolean;
  /** His players are played as unders; everyone else as overs. */
  direction: "over" | "under";
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

function formatAmericanOdds(odds: number | null): string {
  if (odds === null || !Number.isFinite(odds) || odds === 0) return "—";
  const rounded = Math.round(odds);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

type PropSortKey = "player" | "stat" | "line" | "move" | "odds" | "sleeper" | "hit";

function formatHitRate(hits: number, misses: number, hitRate: number | null): string {
  if (hitRate === null) return "—";
  const decided = hits + misses;
  return `${hits}/${decided}`;
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

const EMPTY_COVER = { wins: 0, losses: 0, pushes: 0 };

function GameLineCardBlock({
  card,
  awayRecord,
  homeRecord,
}: {
  card: GameLineCard;
  awayRecord: TeamSeasonRecords | null;
  homeRecord: TeamSeasonRecords | null;
}) {
  return (
    <div className="monitor-game-line-card">
      <strong className="monitor-game-line-matchup">{card.matchup}</strong>
      <span className="monitor-game-line-kickoff">{card.kickoffPt}</span>

      <div className="monitor-game-line-market">
        <span className="monitor-game-line-market-label">Spread</span>
        <span>{card.spread}</span>
        <span className="monitor-game-line-market-records">
          {card.awayTeam} ATS {formatCoverRecord(awayRecord?.ats ?? EMPTY_COVER)} · {card.homeTeam} ATS {formatCoverRecord(homeRecord?.ats ?? EMPTY_COVER)}
        </span>
      </div>

      <div className="monitor-game-line-market">
        <span className="monitor-game-line-market-label">Total</span>
        <span>{card.total}</span>
        <span className="monitor-game-line-market-records">
          {card.awayTeam} O/U {formatCoverRecord(awayRecord?.ou ?? EMPTY_COVER)} · {card.homeTeam} O/U {formatCoverRecord(homeRecord?.ou ?? EMPTY_COVER)}
        </span>
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
  const [userGameId, setUserGameId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PropSortKey>("odds");
  const [sortAsc, setSortAsc] = useState(false);

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
  const teamRecords = useMemo(() => {
    if (!gamesQuery.data) return new Map<string, TeamSeasonRecords>();
    return buildTeamSeasonRecords(gamesQuery.data.rows, season, week);
  }, [gamesQuery.data, season, week]);

  const rosterIds = useMemo(() => rosterIdSet(league), [league]);
  const rosterKeys = useMemo(() => rosterMatchKeys(league), [league]);
  // The opponent is this week's matchup opponent only, the same team
  // the League page highlights — not every other roster in the league.
  const opponentIds = useMemo(() => {
    const ids = new Set<string>();
    const opponent = league.opponentTeam;
    if (opponent) {
      for (const player of [...opponent.starters, ...opponent.bench]) {
        if (player.playerId) ids.add(player.playerId);
      }
    }
    return ids;
  }, [league]);
  const opponentKeys = useMemo(() => {
    const keys = new Set<string>();
    const opponent = league.opponentTeam;
    if (opponent) {
      for (const player of [...opponent.starters, ...opponent.bench]) {
        if (!player.name || !player.position) continue;
        keys.add(propPlayerMatchKey(player.name, player.team, player.position));
      }
    }
    return keys;
  }, [league]);

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
      const opponent = !rostered && (opponentIds.has(line.playerId) || opponentKeys.has(matchKey));
      // His players are played as unders, everyone else as overs; the
      // row's rate, sort, and highlight all follow that direction.
      const direction = rostered ? "under" : "over";

      const weekRowsForPlayer = weekStatsByPlayer.get(matchKey)
        ?? weekStatsByPlayer.get(propPlayerMatchKey(line.name, line.team, positionCode))
        ?? [];
      const history = buildPropHistory(line.stat, line.line, weekRowsForPlayer);
      const displayRate = direction === "under" ? history.underRate : history.hitRate;
      // Only lines that hit their side more than half the time are shown.
      if (displayRate === null || displayRate <= 0.5) continue;
      const def = propStatDef(line.stat);
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
        odds: direction === "under" ? line.underOdds : line.overOdds,
        implied: impliedProbability(direction === "under" ? line.underOdds : line.overOdds),
        sleeperLine: line.sleeper?.line ?? null,
        sleeperFavorable: line.sleeper
          ? (direction === "over" ? line.sleeper.line < line.line : line.sleeper.line > line.line)
          : false,
        hitRate: displayRate,
        overs: history.overs,
        unders: history.unders,
        cells: history.cells,
        rostered,
        opponent,
        direction,
      });
    }

    built.sort(compareHitRateDesc);
    return built;
  }, [
    gameTeamFilter,
    opponentIds,
    opponentKeys,
    position,
    propLinesQuery.data?.propLines.lines,
    rosterIds,
    rosterKeys,
    statId,
    weekStatsByPlayer,
  ]);

  const sortedPropRows = useMemo(() => {
    const rowsCopy = [...propRows];
    const dir = sortAsc ? 1 : -1;
    rowsCopy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "player":
          cmp = a.name.localeCompare(b.name);
          break;
        case "stat":
          cmp = a.statLabel.localeCompare(b.statLabel);
          break;
        case "line":
          cmp = a.line - b.line;
          break;
        case "move": {
          // formatMove displays 0 as "—", so a zero move sorts as missing.
          const aMove = a.move === 0 ? null : a.move;
          const bMove = b.move === 0 ? null : b.move;
          if (aMove === null && bMove === null) cmp = 0;
          else if (aMove === null) return 1;
          else if (bMove === null) return -1;
          else cmp = aMove - bMove;
          break;
        }
        case "odds": {
          if (a.implied === null && b.implied === null) cmp = 0;
          else if (a.implied === null) return 1;
          else if (b.implied === null) return -1;
          else cmp = a.implied - b.implied;
          break;
        }
        case "sleeper": {
          if (a.sleeperLine === null && b.sleeperLine === null) cmp = 0;
          else if (a.sleeperLine === null) return 1;
          else if (b.sleeperLine === null) return -1;
          else cmp = a.sleeperLine - b.sleeperLine;
          break;
        }
        case "hit":
          cmp = (a.hitRate ?? -1) - (b.hitRate ?? -1);
          break;
      }
      if (cmp !== 0) return cmp * dir;
      return compareHitRateDesc(a, b);
    });
    return rowsCopy;
  }, [propRows, sortKey, sortAsc]);

  const toggleSort = (key: PropSortKey) => {
    if (key === sortKey) {
      setSortAsc((value) => !value);
    } else {
      setSortKey(key);
      setSortAsc(key === "player" || key === "stat");
    }
  };

  const sortHeader = (key: PropSortKey, label: string, className?: string) => (
    <th
      scope="col"
      className={className}
      aria-sort={sortKey === key ? (sortAsc ? "ascending" : "descending") : undefined}
    >
      <button type="button" className="props-sort-button" onClick={() => toggleSort(key)}>
        {label}
        <span aria-hidden="true" className="props-sort-arrow">
          {sortKey === key ? (sortAsc ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );

  const gamesUnavailable = gamesQuery.isError;
  const propsLoading = propLinesQuery.isPending || (historyQuery.isPending && !historyQuery.data);
  const propsUnavailable = propLinesQuery.isError;
  // A board older than ~a day and a half is stale reference data (a
  // failed daily pull keeps the previous board): its cells render dim.
  const sleeperPulledAt = propLinesQuery.data?.propLines.sleeperPulledAt ?? null;
  const sleeperStale = sleeperPulledAt
    ? Date.now() - new Date(sleeperPulledAt).getTime() > 36 * 60 * 60 * 1000
    : false;
  const sleeperTitle = sleeperPulledAt
    ? `Sleeper Picks board pulled ${new Date(sleeperPulledAt).toLocaleString()}`
    : undefined;

  return (
    <section className="monitor-section monitor-game-lines-panel">
      <header className="section-heading">
        <h2>Game lines</h2>
      </header>

      {gamesUnavailable ? (
        <SectionError
          title="Lines unavailable."
          onRetry={() => void gamesQuery.refetch()}
          retrying={gamesQuery.isFetching}
        />
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
            <GameLineCardBlock
              card={selectedGame}
              awayRecord={teamRecords.get(normalizeGameLineTeam(selectedGame.awayTeam)) ?? null}
              homeRecord={teamRecords.get(normalizeGameLineTeam(selectedGame.homeTeam)) ?? null}
            />
          ) : null}

          <div className="monitor-value-chart-controls monitor-props-controls">
            <SegmentedControl
              className="monitor-props-position"
              value={position}
              onChange={setPosition}
              label="Position"
              options={[
                { value: "ALL", label: "All" },
                ...PROP_POSITIONS.map((code) => ({ value: code, label: code })),
              ]}
            />
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
            <SectionError
              title="Props unavailable."
              onRetry={() => void propLinesQuery.refetch()}
              retrying={propLinesQuery.isFetching}
              compact
            />
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
                    {sortHeader("player", "Player", "props-player-col")}
                    {sortHeader("stat", "Stat")}
                    {sortHeader("line", "Line")}
                    {sortHeader("sleeper", "Sleeper")}
                    {sortHeader("move", "Move")}
                    {sortHeader("odds", "Odds")}
                    {sortHeader("hit", "Hit")}
                    <th scope="col">History</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPropRows.map((row) => {
                    const hits = row.direction === "under" ? row.unders : row.overs;
                    const misses = row.direction === "under" ? row.overs : row.unders;
                    // Colors stay factual (overs green, unders red) even
                    // though the fraction counts the played side.
                    const hitTone = hitRateTone(row.overs, row.unders);
                    const byWeek = new Map(row.cells.map((cell) => [cell.week, cell]));
                    const scaleMax = Math.max(row.line, ...row.cells.map((cell) => cell.actual), 0) || 1;
                    return (
                      <tr
                        key={row.key}
                        className={[
                          row.rostered ? "is-my-roster" : "",
                          row.opponent ? "is-opponent-roster" : "",
                        ].filter(Boolean).join(" ") || undefined}
                      >
                        <th scope="row" className="props-player-col">
                          <span className="props-player-name">{row.name}</span>
                          <span className="props-player-meta">
                            {row.position}
                            {row.team ? ` · ${row.team}` : ""}
                          </span>
                        </th>
                        <td>{row.statLabel}</td>
                        <td>{formatPropNumber(row.line, 1)}</td>
                        <td>
                          {row.sleeperLine === null ? "—" : (
                            <span
                              title={sleeperTitle}
                              className={[
                                "props-sleeper",
                                row.sleeperFavorable ? "is-favorable" : "",
                                sleeperStale ? "is-stale" : "",
                              ].filter(Boolean).join(" ")}
                            >
                              {formatPropNumber(row.sleeperLine, 1)}
                            </span>
                          )}
                        </td>
                        <td>{formatMove(row.move)}</td>
                        <td>{formatAmericanOdds(row.odds)}</td>
                        <td>
                          <span className={hitTone ? `props-hit props-hit-${hitTone}` : "props-hit"}>
                            {formatHitRate(hits, misses, row.hitRate)}
                          </span>
                        </td>
                        <td>
                          <div
                            className="props-history"
                            role="img"
                            aria-label={row.cells.length > 0
                              ? `Weekly results against the line of ${formatPropNumber(row.line, 1)}: ${historyWeeks.map((weekNumber) => {
                                const cell = byWeek.get(weekNumber);
                                return cell
                                  ? `W${weekNumber} ${formatPropNumber(cell.actual, 1)} (${cell.result})`
                                  : `W${weekNumber} no game`;
                              }).join(", ")}`
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
