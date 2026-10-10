import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { Dashboard, League, MatchupSelection } from "./dashboard-types";
import { MatchupTag, ModalPortal, points, useDialogFocusTrap } from "./shared";

type RosterPlayer = League["tradeTeams"][number]["players"][number];
type SeasonRow = Dashboard["seasonLongRankings"][number];
type PowerTeam = League["powerRankingsWeek"][number];
type PowerScope = "week" | "restOfSeason";
type PowerMode = "seasonLong" | "dynasty";
type PowerPosition = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
type RosterRow = { player: RosterPlayer; season: SeasonRow | null };

export function positionLabel(position: string): string {
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

export function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`;
}

export function LeagueTeamCard({
  team,
  league,
  dashboard,
  scope,
  mode,
  playerCardOpen,
  layer = "default",
  selectedPlayerId = null,
  onPlayerIntent,
  onOpenPlayer,
  onOpenMatchup,
  onClose,
}: {
  team: PowerTeam;
  league: League;
  dashboard: Dashboard;
  scope: PowerScope;
  mode: PowerMode;
  playerCardOpen: boolean;
  /** Raise above the player card when this dialog was opened from it. */
  layer?: "default" | "above-player";
  selectedPlayerId?: string | null;
  onPlayerIntent: (playerId: string) => void;
  onOpenPlayer: (playerId: string) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnPlayerRowRef = useRef<HTMLElement | null>(null);
  const wasPlayerCardOpenRef = useRef(false);
  useDialogFocusTrap(dialogRef, onClose, !playerCardOpen);
  const activeMode = league.seasonLongFormat.isDynasty ? mode : "seasonLong";
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const positions: PowerPosition[] = scope === "week"
    ? ["QB", "RB", "WR", "TE", "FLEX"]
    : ["QB", "RB", "WR", "TE"];
  if (scope === "week" && league.rankingPositions.includes("K")) positions.push("K");
  if (scope === "week" && league.rankingPositions.includes("DEF")) positions.push("DEF");

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
  const roster = useMemo(
    () => league.tradeTeams.find((candidate) => candidate.rosterId === team.rosterId) ?? null,
    [league.tradeTeams, team.rosterId],
  );
  const matchupSlotOrder = useMemo(
    () => league.starters.map((player) => player.lineupSlot ?? player.position),
    [league.starters],
  );

  const rows = useMemo((): RosterRow[] => {
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
  }, [league.rankingPositions, matchupSlotOrder, roster, scope, seasonRowsByPlayerId]);

  const starters = scope === "week" ? rows.filter(({ player }) => player.isStarter) : rows;
  const bench = scope === "week" ? rows.filter(({ player }) => !player.isStarter) : [];

  const renderPlayer = (row: RosterRow) => {
    const { player, season } = row;
    const metric = scope === "week"
      ? points(player.projection)
      : (season?.value ?? 0).toLocaleString();
    const metricLabel = scope === "week" ? "PROJ" : "VALUE";
    const slotChip = scope === "week" && player.isStarter ? starterSlotChip(player) : null;
    const isSelected = selectedPlayerId === player.playerId;
    const openMatchup = player.team && player.opponent && onOpenMatchup
      ? (event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          onOpenMatchup({
            team: player.team ?? "",
            opponent: player.opponent ?? "",
            isAway: player.isAway,
            gamePhase: player.gamePhase,
          });
        }
      : undefined;
    return (
      <div
        className={`ranking-row ranking-row-button power-roster-player${isSelected ? " is-player-selected" : ""}`}
        key={player.playerId}
      >
        <button
          type="button"
          className="power-roster-open"
          aria-label={`Open ${player.name}${isSelected ? ", selected" : ""}`}
          onPointerDown={() => onPlayerIntent(player.playerId)}
          onFocus={() => onPlayerIntent(player.playerId)}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            returnPlayerRowRef.current = event.currentTarget;
            onOpenPlayer(player.playerId);
          }}
        />
        <span className="ranking-player">
          <span className="ranking-name-line">
            <strong>{player.name}</strong>
            {isSelected ? <span className="player-selected-chip">Selected</span> : null}
            {slotChip ? <span className="power-slot-chip">{slotChip}</span> : null}
          </span>
          <span className="ranking-meta-line"><span className="ranking-football-meta matchup-meta-group"><span className="ranking-meta-position">{positionLabel(player.position)}</span><MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={openMatchup} /></span></span>
        </span>
        <span className="ranking-proj"><strong>{metric}</strong><span>{metricLabel}</span></span>
      </div>
    );
  };

  return (
    <ModalPortal>
      <div
        className={`power-team-card-backdrop${playerCardOpen ? " is-obscured" : ""}${layer === "above-player" ? " is-above-player" : ""}`}
        aria-hidden={playerCardOpen || undefined}
        onClick={onClose}
      >
        <section
          ref={dialogRef}
          className="power-team-card"
          role="dialog"
          aria-modal={!playerCardOpen}
          aria-labelledby={`power-team-card-title-${team.rosterId}`}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="power-team-card-header">
            <h2 id={`power-team-card-title-${team.rosterId}`} className={team.isUser ? "is-user" : ""}>{team.teamName}</h2>
            <button type="button" onClick={onClose} aria-label={`Close ${team.teamName} team card`}>×</button>
          </header>
          <div className={`power-team-card-summary${activeMode === "dynasty" && team.futurePickValue > 0 ? " has-picks" : ""}`}>
            <div><span>Power rank</span><strong>#{team.rank}</strong></div>
            <div>
              <span>{scope === "week" ? "Projection" : "Roster value"}</span>
              <strong>{scope === "week" ? points(team.totalValue) : (team.totalValue - team.futurePickValue).toLocaleString()}</strong>
            </div>
            {activeMode === "dynasty" && team.futurePickValue > 0 ? <div><span>Future picks</span><strong>+{team.futurePickValue.toLocaleString()}</strong></div> : null}
          </div>
          <div className="power-team-card-positions" role="list" aria-label={`${team.teamName} position values`}>
            {positions.map((position) => (
              <div key={position} role="listitem"><span>{positionLabel(position)}</span><strong>{scope === "week" ? points(team.positionValues[position]) : team.positionValues[position].toLocaleString()}</strong></div>
            ))}
          </div>
          <div className="power-team-card-roster" role="region" aria-label={`${team.teamName} roster`}>
            {rows.length > 0 ? (
              <>
                {starters.map((row) => renderPlayer(row))}
                {bench.length > 0 ? <div className="power-bench-heading">Bench</div> : null}
                {bench.map((row) => renderPlayer(row))}
              </>
            ) : <div className="power-roster-empty">No roster values for this format.</div>}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
