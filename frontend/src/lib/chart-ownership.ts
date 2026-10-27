/**
 * Ownership classes for Analytics scatter points.
 *
 * - mine: on the viewer's fantasy roster
 * - rostered: owned by another team in the league
 * - available: waivers / free agents (only when identity is resolved)
 * - unknown: skill player with no Sleeper id yet — do not treat as waivers
 * - field: plotted but not a fantasy roster ownership class (e.g. NFL team pace dots)
 *
 * DST (DEF) ids are NFL team codes in Sleeper; matching must use the viewer's
 * starters/bench (or user rosterAssignments), never league-wide rosteredPlayerIds —
 * that incorrectly paints every rostered defense as "my team".
 */

export type ChartOwnership = "mine" | "rostered" | "available" | "unknown" | "field";

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

/**
 * Sleeper id used for roster lookups (DST → team code).
 * Analytics entity `id` encodes an nflverse GSIS id (`WR:00-003…`); never use
 * that for `rosteredPlayerIds` checks — callers must supply `playerId`.
 */
export function chartEntityRosterId(entity: ChartOwnershipEntity): string | null {
  if (isDefensePosition(entity.position)) return entity.team;
  if (entity.playerId) return entity.playerId;
  return null;
}

function rosterPlayers(league: ChartOwnershipLeague) {
  return [...league.starters, ...league.bench];
}

export function isPlayerOnSelectedTeam(entity: ChartOwnershipEntity, league: ChartOwnershipLeague): boolean {
  if (isDefensePosition(entity.position)) {
    const defenseId = chartEntityRosterId(entity);
    if (defenseId && league.rosterAssignments?.some((assignment) => assignment.isUser && assignment.playerId === defenseId)) {
      return true;
    }
    return rosterPlayers(league).some((player) => (
      isDefensePosition(player.position)
      && (player.playerId === defenseId || player.team === entity.team)
    ));
  }

  if (entity.playerId) {
    if (league.rosterAssignments?.some((assignment) => assignment.isUser && assignment.playerId === entity.playerId)) {
      return true;
    }
    if (rosterPlayers(league).some((player) => player.playerId === entity.playerId)) return true;
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
  if (rosterId && league.rosteredPlayerIds.includes(rosterId)) return true;
  if (entity.playerId && league.rosteredPlayerIds.includes(entity.playerId)) return true;
  if (isDefensePosition(entity.position) && league.rosteredPlayerIds.includes(entity.team)) return true;
  if (rosterId && (league.rosterAssignments ?? []).some((assignment) => assignment.playerId === rosterId)) return true;
  return false;
}

export function chartOwnershipForEntity(entity: ChartOwnershipEntity, league: ChartOwnershipLeague): ChartOwnership {
  if (isPlayerOnSelectedTeam(entity, league)) return "mine";
  if (isPlayerRosteredInLeague(entity, league)) return "rostered";
  // Without a Sleeper/DST roster id we cannot distinguish waivers from rival-owned.
  if (!chartEntityRosterId(entity)) return "unknown";
  return "available";
}

export function ownershipReadoutSuffix(ownership: ChartOwnership | undefined): string {
  switch (ownership) {
    case "mine":
      return " · My team";
    case "available":
      return " · Waivers";
    case "rostered":
      return " · Rostered";
    case "unknown":
    case "field":
    case undefined:
      return "";
    default: {
      const _exhaustive: never = ownership;
      return _exhaustive;
    }
  }
}
