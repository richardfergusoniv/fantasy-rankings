/**
 * Ownership classes for Analytics scatter points.
 *
 * - mine: on the viewer's fantasy roster
 * - rostered: owned by another team in the league
 * - available: waivers / free agents
 *
 * DST (DEF) ids are NFL team codes in Sleeper; matching must use the viewer's
 * starters/bench (or user rosterAssignments), never league-wide rosteredPlayerIds —
 * that incorrectly paints every rostered defense as "my team".
 */

export type ChartOwnership = "mine" | "rostered" | "available";

export type ChartOwnershipEntity = {
  id?: string;
  playerId?: string | null;
  name: string;
  team: string;
  position: string;
};

export type ChartOwnershipLeague = {
  starters: readonly { playerId?: string; name: string; team: string | null; position: string }[];
  bench: readonly { playerId?: string; name: string; team: string | null; position: string }[];
  rosteredPlayerIds: readonly string[];
  rosterAssignments?: readonly { playerId: string; teamName: string; isUser: boolean }[];
};

export function comparableChartPlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isDefensePosition(position: string): boolean {
  return position === "DEF" || position === "DST";
}

/** Sleeper / analytics id used for roster lookups (DST → team code). */
export function chartEntityRosterId(entity: ChartOwnershipEntity): string {
  if (isDefensePosition(entity.position)) return entity.team;
  if (entity.playerId) return entity.playerId;
  if (entity.id?.includes(":")) {
    const [, ...rest] = entity.id.split(":");
    return rest.join(":");
  }
  return entity.id ?? entity.team;
}

function rosterPlayers(league: ChartOwnershipLeague) {
  return [...league.starters, ...league.bench];
}

export function isPlayerOnSelectedTeam(entity: ChartOwnershipEntity, league: ChartOwnershipLeague): boolean {
  if (isDefensePosition(entity.position)) {
    const defenseId = chartEntityRosterId(entity);
    if (league.rosterAssignments?.some((assignment) => assignment.isUser && assignment.playerId === defenseId)) {
      return true;
    }
    return rosterPlayers(league).some((player) => (
      isDefensePosition(player.position)
      && (player.playerId === defenseId || player.team === entity.team)
    ));
  }

  const entityName = comparableChartPlayerName(entity.name);
  return rosterPlayers(league).some((player) => (
    player.position === entity.position
    && player.team === entity.team
    && comparableChartPlayerName(player.name) === entityName
  ));
}

export function isPlayerRosteredInLeague(entity: ChartOwnershipEntity, league: ChartOwnershipLeague): boolean {
  const rosterId = chartEntityRosterId(entity);
  if (league.rosteredPlayerIds.includes(rosterId)) return true;
  if (entity.playerId && league.rosteredPlayerIds.includes(entity.playerId)) return true;
  if (isDefensePosition(entity.position) && league.rosteredPlayerIds.includes(entity.team)) return true;
  return (league.rosterAssignments ?? []).some((assignment) => assignment.playerId === rosterId);
}

export function chartOwnershipForEntity(entity: ChartOwnershipEntity, league: ChartOwnershipLeague): ChartOwnership {
  if (isPlayerOnSelectedTeam(entity, league)) return "mine";
  if (isPlayerRosteredInLeague(entity, league)) return "rostered";
  return "available";
}
