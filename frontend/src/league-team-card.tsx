import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { CardHero } from "./components/card-hero";
import type { Dashboard, League, MatchupSelection } from "./dashboard-types";
import { compareByFantasyPosition } from "./fantasy-position-order";
import { weeklyOpponentRosterId } from "./power-opponent";
import { DepthChangeMark, MatchupTag, ModalPortal, depthChange, leagueRank, points, useDialogFocusTrap } from "./shared";
import { formatWhole } from "./lib/format-number";
import { displayedMatchupPoints } from "../../api/_lib/lineup-optimizer";
import { teamOutlook, winPercent, winProbability } from "./views/win-probability";
import { CloseGlyph } from "./components/glyphs";
import { EmptyState } from "./components/state-blocks";

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
  powerRankings,
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
  /** Every team in the table this card was opened from, to rank each position. */
  powerRankings: readonly PowerTeam[];
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
  const isOpponent = scope === "week" && weeklyOpponentRosterId(league.opponentTeam?.name, league.tradeTeams, league.opponentTeam?.rosterId) === team.rosterId;
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
  const [nowMs] = useState(() => Date.now());
  const userPowerTeam = powerRankings.find((candidate) => candidate.isUser) ?? null;
  // Win chance only means something against the team you play this week.
  const myOutlook = isOpponent && scope === "week" ? teamOutlook(league.starters, nowMs) : null;
  const theirOutlook = isOpponent && scope === "week" && league.opponentTeam?.starters ? teamOutlook(league.opponentTeam.starters, nowMs) : null;
  const winChance = myOutlook && theirOutlook ? winPercent(winProbability(myOutlook, theirOutlook)) : null;
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
          if (!a.player.isStarter) {
            return compareByFantasyPosition(a.player.position, b.player.position) || a.rosterIndex - b.rosterIndex;
          }
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

  const renderPlayer = (row: RosterRow) => {
    const { player, season } = row;
    const rawWeekMetric = scope === "week" ? displayedMatchupPoints(player) : null;
    // A final game whose actual never arrived (e.g. the matchup feed
    // failed) keeps the projection instead of showing no points.
    const weekMetric = rawWeekMetric && rawWeekMetric.value === null && player.projection !== null
      ? { value: player.projection, label: "PROJ" as const }
      : rawWeekMetric;
    const metric = weekMetric
      ? points(weekMetric.value)
      : formatWhole(season?.value ?? 0);
    const metricLabel = weekMetric ? weekMetric.label : "VALUE";
    const slotChip = scope === "week" && player.isStarter ? starterSlotChip(player) : null;
    const isSelected = selectedPlayerId === player.playerId;
    const depthMove = depthChange(dashboard.playerInsights?.depth[player.playerId], dashboard.playerInsights?.depthPrevious?.[player.playerId]);
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
          <span className="ranking-meta-line"><span className="ranking-football-meta matchup-meta-group"><span className="ranking-meta-position">{positionLabel(player.position)}</span><MatchupTag team={player.team} opponent={player.opponent} isAway={player.isAway} isBye={player.isBye} position={player.position} entry={sosEntry} onClick={openMatchup} />{depthMove ? <DepthChangeMark change={depthMove} /> : null}</span></span>
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
          <div className="power-team-card-header">
            <div className="power-team-card-heading">
              <h2 id={`power-team-card-title-${team.rosterId}`} className={team.isUser ? "is-user" : ""}>{team.teamName}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label={`Close ${team.teamName} team card`}><CloseGlyph /></button>
          </div>
          <div className="power-team-card-intro">
            <div className="card-chips">
              <span className="depth-chart-tag">{formatRecord(team.record)}</span>
              {team.isUser ? <span className="roster-owner-tag is-user">You</span> : null}
              {isOpponent ? <Badge variant="secondary" size="compact" className="status-badge">Opponent this week</Badge> : null}
            </div>
            <CardHero
              ariaLabel={`${team.teamName} headline numbers`}
              items={[
                { label: "Power rank", value: `#${team.rank}`, valueTone: team.rank <= 3 ? "good" : undefined, sub: `of ${powerRankings.length} teams` },
                scope === "week"
                  ? { label: `Week ${dashboard.week} proj.`, value: points(team.totalValue), sub: !team.isUser && userPowerTeam ? `Yours ${points(userPowerTeam.totalValue)}` : undefined }
                  : { label: "Roster value", value: formatWhole(team.totalValue - team.futurePickValue) },
                activeMode === "dynasty" && team.futurePickValue > 0
                  ? { label: "Future picks", value: `+${formatWhole(team.futurePickValue)}` }
                  : { label: scope === "week" ? "Roster value" : "Positions", value: scope === "week" ? formatWhole(roster?.players.reduce((sum, player) => sum + (seasonRowsByPlayerId.get(player.playerId)?.value ?? 0), 0) ?? 0) : String(positions.length) },
              ]}
            />
            {winChance === null ? null : (
              <div className="power-team-card-win">
                <div><span className="is-you">You · {winChance}% to win</span><span>Them · {Math.round((100 - winChance) * 10) / 10}%</span></div>
                <div className="power-team-card-win-bar" role="img" aria-label={`Your win chance ${winChance} percent`}><i style={{ flex: winChance }} /><i style={{ flex: 100 - winChance }} /></div>
              </div>
            )}
          </div>
          <div className="power-team-card-positions" role="list" aria-label={`${team.teamName} position values`}>
            {positions.map((position) => {
              const values = powerRankings.map((candidate) => candidate.positionValues[position]);
              // A position nobody has any value at has no meaningful rank.
              const rank = values.some((value) => value !== 0) ? leagueRank(values, team.positionValues[position]) : null;
              return (
                <div key={position} role="listitem">
                  <span>{positionLabel(position)}</span>
                  <strong>{scope === "week" ? points(team.positionValues[position]) : formatWhole(team.positionValues[position])}</strong>
                  {rank === null ? null : <small className="power-position-rank" aria-label={`Ranked ${rank} in the league`}>#{rank}</small>}
                </div>
              );
            })}
          </div>
          <div className="power-team-card-roster" role="region" aria-label={`${team.teamName} roster`}>
            {rows.length > 0 ? (
              <>{rows.map((row) => renderPlayer(row))}</>
            ) : <EmptyState title="No roster values for this format" />}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
