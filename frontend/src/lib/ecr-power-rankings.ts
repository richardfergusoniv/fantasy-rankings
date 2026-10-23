import { eligibleForSlot } from "../../../api/_lib/lineup-optimizer";
import type { Dashboard } from "../dashboard-types";

type League = Dashboard["leagues"][number];
type PowerTeam = League["powerRankingsWeek"][number];
type Experts = Dashboard["playerInsights"]["experts"];
type PositionKey = keyof PowerTeam["positionValues"];

export type EcrTeam = {
  team: PowerTeam;
  starterIds: Set<string>;
  /** The lineup slot ECR gave each starter. */
  slotByPlayerId: Map<string, string>;
  projections: Map<string, number>;
};

const FLEX_SLOTS = ["REC_FLEX", "WRRB_FLEX", "FLEX", "SUPER_FLEX"];

/**
 * Best valid lineup: players are taken best-first and kept only if every kept
 * player can still hold a slot, moving earlier picks between slots when needed.
 * That makes overlapping flexes (REC_FLEX, WRRB_FLEX, FLEX) come out optimal.
 */
function assignSlots(players: readonly { playerId: string; position: string }[], slots: readonly string[]): Map<string, string> {
  const playerBySlot = new Map<number, string>();
  const positionById = new Map(players.map((player) => [player.playerId, player.position]));
  const tryPlace = (playerId: string, seen: Set<number>): boolean => {
    const position = positionById.get(playerId) ?? "";
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot === undefined || seen.has(index) || !eligibleForSlot(position, slot)) continue;
      seen.add(index);
      const holder = playerBySlot.get(index);
      if (holder === undefined || tryPlace(holder, seen)) {
        playerBySlot.set(index, playerId);
        return true;
      }
    }
    return false;
  };
  for (const player of players) tryPlace(player.playerId, new Set());
  return new Map([...playerBySlot].flatMap(([index, playerId]) => {
    const slot = slots[index];
    return slot === undefined ? [] : [[playerId, slot] as [string, string]];
  }));
}

/**
 * Each team's best lineup by FantasyPros projected points, ranked high to low.
 * Players the experts do not project count as zero. Records and ownership come
 * from the Vegas table so the two stay in step.
 */
export function buildEcrPowerRankings(league: League, experts: Experts): EcrTeam[] {
  const teams = league.powerRankingsWeek.flatMap((team): EcrTeam[] => {
    const roster = league.tradeTeams.find((candidate) => candidate.rosterId === team.rosterId);
    if (!roster) return [];
    const projections = new Map<string, number>();
    for (const player of roster.players) {
      const value = experts[player.playerId]?.projection;
      if (value != null) projections.set(player.playerId, value);
    }
    const pool = [...roster.players].sort((a, b) => (projections.get(b.playerId) ?? 0) - (projections.get(a.playerId) ?? 0));
    const slotByPlayerId = assignSlots(pool, league.tradeStarterSlots);
    const positionValues: PowerTeam["positionValues"] = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
    for (const [playerId, slot] of slotByPlayerId) {
      const key: PositionKey = FLEX_SLOTS.includes(slot) ? "FLEX" : (slot as PositionKey);
      if (key in positionValues) positionValues[key] += projections.get(playerId) ?? 0;
    }
    for (const key of Object.keys(positionValues) as PositionKey[]) positionValues[key] = Number(positionValues[key].toFixed(2));
    const totalValue = Number(Object.values(positionValues).reduce((sum, value) => sum + value, 0).toFixed(2));
    return [{
      team: { ...team, rank: 0, totalValue, futurePickValue: 0, positionValues },
      starterIds: new Set(slotByPlayerId.keys()),
      slotByPlayerId,
      projections,
    }];
  });
  return teams
    .sort((a, b) => b.team.totalValue - a.team.totalValue || a.team.teamName.localeCompare(b.team.teamName))
    .map((entry, index) => ({ ...entry, team: { ...entry.team, rank: index + 1 } }));
}
