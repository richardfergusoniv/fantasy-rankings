import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Card } from "@/components/ui/card";
import type { api, ApiResponse } from "./api";
import { weeklyOpponentRosterId } from "./power-opponent";
import { MatchupTag, ModalPortal, SegmentedControl, points, shortLeagueName, useDialogFocusTrap } from "./shared";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type League = Dashboard["leagues"][number];
type RosterPlayer = League["tradeTeams"][number]["players"][number];
type SeasonRow = Dashboard["seasonLongRankings"][number];
type PowerPosition = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";

function positionLabel(position: string): string {
  return position === "DEF" ? "DST" : position;
}

function normalizedLineupLabel(value: string): string {
  return value.replaceAll("_", "").toUpperCase().replaceAll("DEF", "DST");
}

function starterSlotChip(player: RosterPlayer): string | null {
  const slot = player.lineupSlot ?? player.position;
  if (normalizedLineupLabel(slot) === normalizedLineupLabel(player.position)) return null;
  return slot.replaceAll("_", " ");
}

function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}

type RosterRow = { player: RosterPlayer; season: SeasonRow | null };

export function PowerRankings({
  league,
  dashboard,
  onPlayerIntent,
  onOpenPlayer,
  playerCardOpen,
  selectedPlayerId = null,
}: {
  league: League;
  dashboard: Dashboard;
  onPlayerIntent: (playerId: string) => void;
  onOpenPlayer: (playerId: string) => void;
  playerCardOpen: boolean;
  selectedPlayerId?: string | null;
}) {
  const [scope, setScope] = useState<"week" | "restOfSeason">("week");
  const [mode, setMode] = useState<"seasonLong" | "dynasty">("seasonLong");
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const teamDialogRef = useRef<HTMLElement | null>(null);
  const returnPlayerRowRef = useRef<HTMLButtonElement | null>(null);
  const wasPlayerCardOpenRef = useRef(false);
  const isDynastyLeague = league.seasonLongFormat.isDynasty;
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const activeMode = isDynastyLeague ? mode : "seasonLong";
  const powerRankings = scope === "week"
    ? league.powerRankingsWeek
    : activeMode === "dynasty" ? league.powerRankingsDynasty : league.powerRankingsSeasonLong;
  const mine = powerRankings.find((team) => team.isUser);
  const positions: PowerPosition[] = scope === "week"
    ? ["QB", "RB", "WR", "TE", "FLEX"]
    : ["QB", "RB", "WR", "TE"];
  if (scope === "week" && league.rankingPositions.includes("K")) positions.push("K");
  if (scope === "week" && league.rankingPositions.includes("DEF")) positions.push("DEF");

  const closeTeamCard = () => setSelectedTeamId(null);
  useDialogFocusTrap(teamDialogRef, closeTeamCard, selectedTeamId !== null && !playerCardOpen);

  useEffect(() => {
    setSelectedTeamId(null);
    returnPlayerRowRef.current = null;
  }, [league.id]);

  useEffect(() => {
    if (wasPlayerCardOpenRef.current && !playerCardOpen) {
      requestAnimationFrame(() => returnPlayerRowRef.current?.focus());
    }
    wasPlayerCardOpenRef.current = playerCardOpen;
  }, [playerCardOpen]);

  const activeFormatKey = activeMode === "dynasty"
    ? league.seasonLongFormat.key
    : `redraft-${league.seasonLongFormat.numQbs}qb-${league.seasonLongFormat.numTeams}t-${league.seasonLongFormat.ppr}ppr`;
  const seasonRowsByPlayerId = useMemo(() => new Map(
    dashboard.seasonLongRankings
      .filter((row) => row.formatKey === activeFormatKey && row.position !== "PICK")
      .map((row) => [row.playerId, row]),
  ), [activeFormatKey, dashboard.seasonLongRankings]);
  const rosterById = useMemo(() => new Map(league.tradeTeams.map((team) => [team.rosterId, team])), [league.tradeTeams]);
  const matchupSlotOrder = useMemo(
    () => league.starters.map((player) => player.lineupSlot ?? player.position),
    [league.starters],
  );
  const displayedTeams = useMemo(
    () => [...powerRankings].sort((a, b) => a.rank - b.rank),
    [powerRankings],
  );
  const opponentRosterId = scope === "week"
    ? weeklyOpponentRosterId(league.opponentTeam?.name, league.tradeTeams)
    : null;
  const isDynastyView = scope === "restOfSeason" && activeMode === "dynasty";
  const avgFuturePickValue = isDynastyView && powerRankings.length > 0
    ? powerRankings.reduce((total, team) => total + team.futurePickValue, 0) / powerRankings.length
    : 0;
  const selectedTeam = selectedTeamId === null ? null : powerRankings.find((team) => team.rosterId === selectedTeamId) ?? null;

  const radarData = positions.map((position) => {
    const values = powerRankings.map((team) => team.positionValues[position]);
    const value = mine?.positionValues[position] ?? 0;
    const average = values.length ? values.reduce((total, item) => total + item, 0) / values.length : 0;
    const leader = Math.max(1, ...values);
    return {
      position,
      value,
      average,
      strength: Math.round((value / leader) * 100),
      averageStrength: Math.round((average / leader) * 100),
    };
  });

  const radarPoint = (index: number, percent: number, radius = 90): string => {
    const angle = (-90 + index * (360 / positions.length)) * Math.PI / 180;
    const distance = radius * Math.max(0, Math.min(100, percent)) / 100;
    return `${150 + Math.cos(angle) * distance},${130 + Math.sin(angle) * distance}`;
  };
  const teamPolygon = radarData.map((row, index) => radarPoint(index, row.strength)).join(" ");
  const averagePolygon = radarData.map((row, index) => radarPoint(index, row.averageStrength)).join(" ");
  const totalAverage = radarData.reduce((total, row) => total + row.average, 0);
  const scopeToggle = (
    <SegmentedControl
      className="lineup-mode-toggle power-scope-toggle"
      value={scope === "week" ? "week" : activeMode === "dynasty" ? "dynasty" : "ros"}
      onChange={(value) => {
        if (value === "week") {
          setScope("week");
        } else if (value === "ros") {
          setScope("restOfSeason");
          setMode("seasonLong");
        } else {
          setScope("restOfSeason");
          setMode("dynasty");
        }
      }}
      label="Power ranking horizon"
      options={isDynastyLeague
        ? [{ value: "week", label: `Week ${dashboard.week}` }, { value: "ros", label: "Season Long" }, { value: "dynasty", label: "Dynasty" }]
        : [{ value: "week", label: `Week ${dashboard.week}` }, { value: "ros", label: "Season Long" }]}
    />
  );

  const rosterRows = (rosterId: number): RosterRow[] => {
    const roster = rosterById.get(rosterId);
    if (!roster) return [];
    if (scope === "week") {
      return roster.players
        .filter((player) => league.rankingPositions.includes(player.position as "QB" | "RB" | "WR" | "TE" | "K" | "DEF"))
        .map((player, rosterIndex) => ({ player, season: seasonRowsByPlayerId.get(player.playerId) ?? null, rosterIndex }))
        .sort((a, b) => {
          if (a.player.isStarter !== b.player.isStarter) return a.player.isStarter ? -1 : 1;
          if (!a.player.isStarter) return a.rosterIndex - b.rosterIndex;
          const aSlotIndex = matchupSlotOrder.indexOf(a.player.lineupSlot ?? a.player.position);
          const bSlotIndex = matchupSlotOrder.indexOf(b.player.lineupSlot ?? b.player.position);
          const aOrder = aSlotIndex < 0 ? Number.MAX_SAFE_INTEGER : aSlotIndex;
          const bOrder = bSlotIndex < 0 ? Number.MAX_SAFE_INTEGER : bSlotIndex;
          return aOrder - bOrder || a.rosterIndex - b.rosterIndex;
        })
        .map(({ player, season }) => ({ player, season }));
    }
    return roster.players
      .flatMap((player) => {
        const season = seasonRowsByPlayerId.get(player.playerId);
        return season && ["QB", "RB", "WR", "TE"].includes(player.position) ? [{ player, season }] : [];
      })
      .sort((a, b) => b.season.value - a.season.value || a.player.name.localeCompare(b.player.name));
  };

  const renderPlayer = (row: RosterRow) => {
    const { player, season } = row;
    const metric = scope === "week"
      ? points(player.projection)
      : (season?.value ?? 0).toLocaleString();
    const metricLabel = scope === "week" ? "PROJ" : "VALUE";
    const slotChip = scope === "week" && player.isStarter ? starterSlotChip(player) : null;
    const isSelected = selectedPlayerId === player.playerId;
    return (
      <button
        type="button"
        className={`ranking-row ranking-row-button power-roster-player${isSelected ? " is-player-selected" : ""}`}
        key={player.playerId}
        aria-label={`Open ${player.name}${isSelected ? ", selected" : ""}`}
        onPointerDown={() => onPlayerIntent(player.playerId)}
        onFocus={() => onPlayerIntent(player.playerId)}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          returnPlayerRowRef.current = event.currentTarget;
          onOpenPlayer(player.playerId);
        }}
      >
        <span className="ranking-player">
          <span className="ranking-name-line">
            <strong>{player.name}</strong>
            {isSelected ? <span className="player-selected-chip">Selected</span> : null}
            {slotChip ? <span className="power-slot-chip">{slotChip}</span> : null}
          </span>
          <span className="ranking-meta-line"><span className="ranking-football-meta matchup-meta-group"><span className="ranking-meta-position">{positionLabel(player.position)}</span><MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} /></span></span>
        </span>
        <span className="ranking-proj"><strong>{metric}</strong><span>{metricLabel}</span></span>
      </button>
    );
  };

  const selectedTeamRows = selectedTeam ? rosterRows(selectedTeam.rosterId) : [];
  const selectedTeamStarters = scope === "week" ? selectedTeamRows.filter(({ player }) => player.isStarter) : selectedTeamRows;
  const selectedTeamBench = scope === "week" ? selectedTeamRows.filter(({ player }) => !player.isStarter) : [];

  if (!mine || powerRankings.length === 0) {
    return (
      <section className="power-view">
        {scopeToggle}
        <div className="analytics-empty">
          <strong>{scope === "week" ? "No weekly power rankings yet." : activeMode === "dynasty" ? "No dynasty power rankings for this league." : "No rest-of-season power rankings for this league."}</strong>
          <span>{scope === "week" ? "Refresh to check the latest Vegas lines and nflverse usage data." : "Refresh after FantasyCalc publishes values for this league format."}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="power-view">
      {scopeToggle}
      <Card className="power-hero gap-0 py-0 shadow-sm">
        <div>
          <span>Your power rank</span>
          <strong>#{mine.rank}</strong>
        </div>
        <p>of {powerRankings.length} teams</p>
        <small>{scope === "week" ? `${points(mine.totalValue)} projected optimized-lineup points` : `${mine.totalValue.toLocaleString()} total roster value`}</small>
      </Card>

      <section className="power-chart-section" aria-labelledby="position-strength-heading">
        <div className="section-heading power-section-heading">
          <h2 id="position-strength-heading">Position strength</h2>
        </div>
        <div className="power-radar" role="img" aria-label={`Spider chart of your ${scope === "week" ? "optimized lineup" : "roster"} strength by position in ${shortLeagueName(league.name)}`}>
          <svg viewBox="0 0 300 260" aria-hidden="true">
            {[25, 50, 75, 100].map((level) => <polygon key={level} points={positions.map((_position, index) => radarPoint(index, level)).join(" ")} className="radar-grid" />)}
            {positions.map((_position, index) => <line key={index} x1="150" y1="130" x2={radarPoint(index, 100).split(",")[0]} y2={radarPoint(index, 100).split(",")[1]} className="radar-axis" />)}
            <polygon points={averagePolygon} className="radar-average" />
            <polygon points={teamPolygon} className="radar-team" />
            {radarData.map((row, index) => {
              const [x = "150", y = "130"] = radarPoint(index, row.strength).split(",");
              return <circle key={row.position} cx={x} cy={y} r="3.5" className="radar-dot"><title>{`${positionLabel(row.position)}: ${scope === "week" ? points(row.value) : row.value.toLocaleString()} (${row.strength}% of league leader)`}</title></circle>;
            })}
            {positions.map((position, index) => {
              const [xText = "150", yText = "130"] = radarPoint(index, 100, 112).split(",");
              const x = Number(xText);
              return <text key={position} x={xText} y={Number(yText) + 4} textAnchor={x > 165 ? "start" : x < 135 ? "end" : "middle"}>{positionLabel(position)}</text>;
            })}
          </svg>
        </div>
        <p className="power-position-table-label">League average</p>
        <div className="power-position-values" role="list" aria-label="League average value by position">
          {radarData.map((row) => (
            <div key={row.position} role="listitem"><span>{positionLabel(row.position)}</span><strong>{scope === "week" ? points(row.average) : Math.round(row.average).toLocaleString()}</strong></div>
          ))}
          {scope === "week" ? <div className="power-position-total-highlight" role="listitem"><span>Total</span><strong>{points(totalAverage)}</strong></div> : <div className="power-position-total power-position-total-highlight" role="listitem"><span>Total</span><strong>{Math.round(totalAverage).toLocaleString()}</strong></div>}
        </div>
      </section>

      <section className="power-table-section" aria-labelledby="league-power-heading">
        <div className="section-heading power-section-heading"><h2 id="league-power-heading">League power rankings</h2>{scope === "restOfSeason" ? <span>full roster value</span> : null}</div>
        <div className="power-table" role="list">
          {displayedTeams.map((team) => {
            const isOpponent = opponentRosterId !== null && team.rosterId === opponentRosterId;
            return (
              <div className="power-list-item" role="listitem" key={team.rosterId}>
                <button
                  type="button"
                  className={`power-row power-row-toggle${team.isUser ? " is-user" : ""}${isOpponent ? " is-opponent" : ""}`}
                  aria-label={`Open ${team.teamName}${scope === "restOfSeason" ? `, ${formatRecord(team.record)} record` : ""}, rank ${team.rank}${isOpponent ? ", this week's opponent" : ""}`}
                  aria-haspopup="dialog"
                  onClick={() => setSelectedTeamId(team.rosterId)}
                >
                  <strong className="power-rank">{team.rank}</strong>
                  <span className="power-team">
                    <strong>{team.teamName}{scope === "restOfSeason" ? <span className="power-team-record"> · {formatRecord(team.record)}</span> : null}</strong>
                    {isOpponent ? <span className="sr-only">This week's opponent</span> : null}
                  </span>
                  <span className="power-total"><strong>{scope === "week" ? points(team.totalValue) : team.totalValue.toLocaleString()}</strong></span>
                </button>
              </div>
            );
          })}
        </div>
        {isDynastyView ? (
          <p className="power-future-picks-average">League avg future picks: <strong>{avgFuturePickValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></p>
        ) : null}
      </section>
      {selectedTeam ? (
        <ModalPortal>
          <div
            className={`power-team-card-backdrop${playerCardOpen ? " is-obscured" : ""}`}
          aria-hidden={playerCardOpen || undefined}
          onClick={closeTeamCard}
        >
          <section
            ref={teamDialogRef}
            className="power-team-card"
            role="dialog"
            aria-modal={!playerCardOpen}
            aria-labelledby={`power-team-card-title-${selectedTeam.rosterId}`}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="power-team-card-header">
              <h2 id={`power-team-card-title-${selectedTeam.rosterId}`} className={selectedTeam.isUser ? "is-user" : ""}>{selectedTeam.teamName}</h2>
              <button type="button" onClick={closeTeamCard} aria-label={`Close ${selectedTeam.teamName} team card`}>×</button>
            </header>
            <div className={`power-team-card-summary${activeMode === "dynasty" && selectedTeam.futurePickValue > 0 ? " has-picks" : ""}`}>
              <div><span>Power rank</span><strong>#{selectedTeam.rank}</strong></div>
              <div>
                <span>{scope === "week" ? "Projection" : "Roster value"}</span>
                <strong>{scope === "week" ? points(selectedTeam.totalValue) : (selectedTeam.totalValue - selectedTeam.futurePickValue).toLocaleString()}</strong>
              </div>
              {activeMode === "dynasty" && selectedTeam.futurePickValue > 0 ? <div><span>Future picks</span><strong>+{selectedTeam.futurePickValue.toLocaleString()}</strong></div> : null}
            </div>
            <div className="power-team-card-positions" role="list" aria-label={`${selectedTeam.teamName} position values`}>
              {positions.map((position) => (
                <div key={position} role="listitem"><span>{positionLabel(position)}</span><strong>{scope === "week" ? points(selectedTeam.positionValues[position]) : selectedTeam.positionValues[position].toLocaleString()}</strong></div>
              ))}
            </div>
            <div className="power-team-card-roster" role="region" aria-label={`${selectedTeam.teamName} roster`}>
              {selectedTeamRows.length > 0 ? (
                <>
                  {selectedTeamStarters.map((row) => renderPlayer(row))}
                  {selectedTeamBench.length > 0 ? <div className="power-bench-heading">Bench</div> : null}
                  {selectedTeamBench.map((row) => renderPlayer(row))}
                </>
              ) : <div className="power-roster-empty">No roster values for this format.</div>}
            </div>
            </section>
          </div>
        </ModalPortal>
      ) : null}
    </section>
  );
}
