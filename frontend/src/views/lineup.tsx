import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { lineupCountingPoints, optimizeLineup } from "../../../api/_lib/lineup-optimizer";
import type {
  Dashboard,
  League,
  MatchupSelection,
  PlayerLink,
  RosterPlayer,
} from "../dashboard-types";
import {
  DesignationBadge,
  accessibleMatchupLabel,
  forecastPoints,
  formatProjectionPoints,
  matchupCell,
  playerScore,
  sleeperInjuryTag,
} from "../dashboard-shared";
import { MatchupTag, SegmentedControl, type StrengthOfScheduleEntryLike } from "../shared";
import {
  isOptimizedLineupChanged,
  matchupProjectionClassName,
  optimizedTotalProjectionClassName,
} from "./lineup-projection";

export {
  isOptimizedLineupChanged,
  matchupProjectionClassName,
  optimizedTotalProjectionClassName,
} from "./lineup-projection";

export function MatchupPlayer({
  player,
  side,
  sosEntry,
  isSwappedIn = false,
  isDemoted = false,
  selected = false,
  onOpen,
  onOpenMatchup,
}: {
  player: RosterPlayer | undefined;
  side: "mine" | "theirs";
  sosEntry?: StrengthOfScheduleEntryLike;
  isSwappedIn?: boolean;
  isDemoted?: boolean;
  selected?: boolean;
  onOpen?: (player: RosterPlayer) => void;
  onOpenMatchup?: (matchup: MatchupSelection) => void;
}) {
  if (!player) {
    return (
      <div className={`matchup-player ${side} empty-player`} aria-hidden="true">
        <span className="matchup-player-open" />
        <span className="matchup-meta" />
        <span className="matchup-number matchup-player-score"><b>—</b></span>
      </div>
    );
  }
  const score = playerScore(player);
  const openPlayer = () => onOpen?.(player);
  const position = player.position === "DEF" ? "DST" : player.position;
  const matchup = accessibleMatchupLabel(player.team, player.opponent, player.isAway, player.isBye);
  const scoreDescription = `${formatProjectionPoints(score.value, score.label === "PROJ" ? player.projectionSource : null)} ${score.label === "PROJ" ? "projected points" : "points"}`;
  const injuryDescription = player.injuryStatus ? `, injury status ${player.injuryStatus}` : "";
  const substitutionDescription = isSwappedIn
    ? ", swapped into optimized lineup"
    : isDemoted
      ? ", moved to bench in optimized lineup"
      : "";
  const selectedDescription = selected ? ", selected" : "";
  return (
    <div className={`matchup-player ${side}${isSwappedIn ? " swapped-in" : ""}${isDemoted ? " demoted" : ""}${selected ? " is-player-selected" : ""}`}>
      <button type="button" className="matchup-player-open" onClick={openPlayer} aria-label={`View ${player.name} details and news, ${position}, ${matchup}, ${scoreDescription}${injuryDescription}${substitutionDescription}${selectedDescription}`}>
        <span className="matchup-name-line">
          <strong>{player.name}</strong>
          {selected ? <span className="player-selected-chip">Selected</span> : null}
          {isSwappedIn || isDemoted ? (
            <span className={`matchup-substitution-tag ${isSwappedIn ? "in" : "out"}`} aria-hidden="true">
              {isSwappedIn ? "IN" : "OUT"}
            </span>
          ) : null}
          {player.injuryStatus ? (
            <DesignationBadge code={sleeperInjuryTag(player.injuryStatus)} label={`Injury status: ${player.injuryStatus}`} title={player.injuryStatus} />
          ) : null}
        </span>
      </button>
      <div className="matchup-meta">
        <MatchupTag
          team={player.team}
          opponent={player.opponent}
          isAway={player.isAway}
          isBye={player.isBye}
          position={player.position}
          entry={sosEntry}
          onClick={player.team && player.opponent && onOpenMatchup ? () => onOpenMatchup({ team: player.team ?? "", opponent: player.opponent ?? "", isAway: player.isAway, gamePhase: player.gamePhase }) : undefined}
        />
      </div>
      <button type="button" className={matchupProjectionClassName({ scoreLabel: score.label })} onClick={openPlayer} tabIndex={-1} aria-hidden="true">
        <b>{formatProjectionPoints(score.value, score.label === "PROJ" ? player.projectionSource : null)}</b>
      </button>
    </div>
  );
}

export function forecastTotal(players: RosterPlayer[]): number | null {
  const values = players.flatMap((player) => {
    const value = lineupCountingPoints(player);
    return value === null ? [] : [value];
  });
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

export function Lineup({
  league,
  dashboard,
  onOpenMatchup,
  onOpenLeagueTeam,
  linkedPlayerId,
  onOpenLinkedPlayer,
}: {
  league: League;
  dashboard: Dashboard;
  onOpenMatchup: (matchup: MatchupSelection) => void;
  onOpenLeagueTeam?: (rosterId: number) => void;
} & PlayerLink) {
  const [mode, setMode] = useState<"current" | "optimized">("current");
  const openPlayer = (player: RosterPlayer) => {
    onOpenLinkedPlayer(player.playerId);
  };
  const opponent = league.opponentTeam;
  const sosEntry = dashboard.strengthOfSchedule.find((entry) => entry.leagueId === league.id);
  const optimized = useMemo(() => optimizeLineup(league.starters, league.bench), [league.starters, league.bench]);
  const mine = mode === "optimized" ? optimized.starters : league.starters;
  const myBench = mode === "optimized" ? optimized.bench : league.bench;
  const theirs = opponent?.starters;
  const theirBench = opponent?.bench;
  const optimizedForecast = forecastTotal(optimized.starters);
  const lineupChanged = isOptimizedLineupChanged(
    optimized.starters.map((starter) => starter.playerId),
    league.starters.map((starter) => starter.playerId),
  );
  const userTeam = league.powerRankingsWeek.find((team) => team.isUser)
    ?? league.tradeTeams.find((team) => team.isUser)
    ?? null;
  const userTeamName = userTeam?.teamName ?? "My Team";
  const userRosterId = userTeam?.rosterId ?? null;
  const opponentRosterId = (() => {
    if (!opponent?.name) return null;
    const fromTrade = league.tradeTeams.filter((team) => !team.isUser && team.teamName === opponent.name);
    if (fromTrade.length === 1) return fromTrade[0]?.rosterId ?? null;
    const fromPower = league.powerRankingsWeek.filter((team) => !team.isUser && team.teamName === opponent.name);
    return fromPower.length === 1 ? fromPower[0]?.rosterId ?? null : null;
  })();
  const opponentTeamName = opponent?.name ?? "OPPONENT";
  const starterCount = Math.max(mine.length, theirs?.length ?? 0);
  const rows = Array.from({ length: starterCount }, (_, index) => ({
    mine: mine[index],
    theirs: theirs?.[index],
  }));
  const benchCount = Math.max(myBench.length, theirBench?.length ?? 0);
  const benchRows = Array.from({ length: benchCount }, (_, index) => ({
    mine: myBench[index],
    theirs: theirBench?.[index],
  }));
  const myTotalProjectionClassName = optimizedTotalProjectionClassName({
    optimizedMode: mode === "optimized",
    lineupChanged,
  });
  const optimizedTotalDescription = mode === "optimized" && lineupChanged
    ? ", optimized total differs from current lineup"
    : mode === "optimized"
      ? ", lineup already optimal"
      : "";

  return (
    <>
      <SegmentedControl
        className="lineup-mode-toggle page-tab-control"
        value={mode}
        onChange={setMode}
        label="Your lineup version"
        options={[{ value: "current", label: "Current lineup" }, { value: "optimized", label: "Optimized lineup" }]}
      />

      <Card className="matchup-score gap-0 py-0 shadow-sm" aria-label="Head-to-head score">
        <div className="score-team mine">
          {userRosterId !== null && onOpenLeagueTeam ? (
            <button
              type="button"
              className="matchup-score-team-open"
              aria-label={`Open ${userTeamName} league team`}
              aria-haspopup="dialog"
              onClick={() => onOpenLeagueTeam(userRosterId)}
            >
              {userTeamName}
            </button>
          ) : (
            <span>{userTeamName}</span>
          )}
          <div className="score-line">
            <strong>{formatProjectionPoints(league.teamActual)}</strong>
            <small className={myTotalProjectionClassName}>
              {forecastPoints(mode === "optimized" ? optimizedForecast : league.teamProjection, mode === "optimized" ? optimized.starters : league.starters)}
              <span className="sr-only"> projected points{optimizedTotalDescription}</span>
            </small>
          </div>
        </div>
        <div className="versus">VS</div>
        <div className="score-team theirs">
          {opponentRosterId !== null && onOpenLeagueTeam ? (
            <button
              type="button"
              className="matchup-score-team-open"
              aria-label={`Open ${opponentTeamName} league team`}
              aria-haspopup="dialog"
              onClick={() => onOpenLeagueTeam(opponentRosterId)}
            >
              {opponentTeamName}
            </button>
          ) : (
            <span>{opponentTeamName}</span>
          )}
          <div className="score-line"><strong>{formatProjectionPoints(opponent?.teamActual ?? null)}</strong><small>{forecastPoints(opponent?.teamProjection ?? null, opponent?.starters ?? [])}<span className="sr-only"> projected points</span></small></div>
        </div>
      </Card>

      <section className="lineup-section matchup-section">
        <div className="section-heading"><h2>Starters</h2></div>
        <div className="data-table-frame">
        <div className="matchup-list">
          {rows.map(({ mine: myPlayer, theirs }, index) => (
            <div className="matchup-row" key={`${myPlayer?.playerId ?? "empty"}-${theirs?.playerId ?? "empty"}-${index}`}>
              <MatchupPlayer
                player={matchupCell(myPlayer)}
                side="mine"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
                selected={Boolean(linkedPlayerId && myPlayer?.playerId === linkedPlayerId)}
                isSwappedIn={mode === "optimized" && Boolean(matchupCell(myPlayer)) && !league.starters.some((starter) => starter.playerId === myPlayer?.playerId)}
              />
              <span className="matchup-slot">{(myPlayer?.lineupSlot ?? theirs?.lineupSlot ?? "—").replace("_", " ")}</span>
              <MatchupPlayer
                player={matchupCell(theirs)}
                side="theirs"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
                selected={Boolean(linkedPlayerId && theirs?.playerId === linkedPlayerId)}
              />
            </div>
          ))}
        </div>
        </div>
        {!opponent ? <div className="empty-inline compact">Sleeper hasn’t posted an opponent for this week.</div> : null}
      </section>

      <section className="lineup-section matchup-section bench-matchup-section" aria-label="Bench matchup">
        <div className="section-heading"><h2>Bench</h2></div>
        <div className="data-table-frame">
        <div className="matchup-list">
          {benchRows.map(({ mine: myPlayer, theirs }, index) => (
            <div className="matchup-row" key={`${myPlayer?.playerId ?? "empty"}-${theirs?.playerId ?? "empty"}-bench-${index}`}>
              <MatchupPlayer
                player={myPlayer}
                side="mine"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
                selected={Boolean(linkedPlayerId && myPlayer?.playerId === linkedPlayerId)}
                isDemoted={mode === "optimized" && Boolean(myPlayer) && league.starters.some((starter) => starter.playerId === myPlayer?.playerId)}
              />
              <span className="matchup-slot">BN</span>
              <MatchupPlayer
                player={theirs}
                side="theirs"
                sosEntry={sosEntry}
                onOpen={openPlayer}
                onOpenMatchup={onOpenMatchup}
                selected={Boolean(linkedPlayerId && theirs?.playerId === linkedPlayerId)}
              />
            </div>
          ))}
        </div>
        </div>
        {benchRows.length === 0 ? <div className="empty-inline compact">No bench players are listed.</div> : null}
        {!opponent ? <div className="empty-inline compact">Sleeper hasn’t posted an opponent for this week.</div> : null}
      </section>
    </>
  );
}
