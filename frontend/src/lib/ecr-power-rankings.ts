import { eligibleForSlot } from "../../../api/_lib/lineup-optimizer";
import type { Dashboard } from "../dashboard-types";

type League = Dashboard["leagues"][number];
type PowerTeam = League["powerRankingsWeek"][number];
type Experts = Dashboard["playerInsights"]["experts"];
type PositionKey = keyof PowerTeam["positionValues"];

export type EcrTeam = { team: PowerTeam; starterIds: Set<string>; projections: Map<string, number> };

const FLEX_SLOTS = ["REC_FLEX", "WRRB_FLEX", "FLEX", "SUPER_FLEX"];

/** Fixed positions fill first, then the flexes from narrowest to widest, each taking the best player left. */
function fillOrder(slots: readonly string[]): string[] {
  const rank = (slot: string) => {
    const flex = FLEX_SLOTS.indexOf(slot);
    return flex < 0 ? -1 : flex;
  };
  return [...slots].sort((a, b) => rank(a) - rank(b));
}

/**
 * Each team's best lineup by FantasyPros projected points, ranked high to low.
 * Players the experts do not project count as zero. Records and ownership come
 * from the Vegas table so the two stay in step.
 */
export function buildEcrPowerRankings(league: League, experts: Experts): EcrTeam[] {
  const slots = fillOrder(league.tradeStarterSlots);
  const teams = league.powerRankingsWeek.flatMap((team): EcrTeam[] => {
    const roster = league.tradeTeams.find((candidate) => candidate.rosterId === team.rosterId);
    if (!roster) return [];
    const projections = new Map<string, number>();
    for (const player of roster.players) {
      const value = experts[player.playerId]?.projection;
      if (value != null) projections.set(player.playerId, value);
    }
    const pool = roster.players
      .filter((player) => projections.has(player.playerId))
      .sort((a, b) => (projections.get(b.playerId) ?? 0) - (projections.get(a.playerId) ?? 0));
    const used = new Set<string>();
    const positionValues: PowerTeam["positionValues"] = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
    for (const slot of slots) {
      const pick = pool.find((player) => !used.has(player.playerId) && eligibleForSlot(player.position, slot));
      if (!pick) continue;
      used.add(pick.playerId);
      const key: PositionKey = FLEX_SLOTS.includes(slot) ? "FLEX" : (slot as PositionKey);
      if (key in positionValues) positionValues[key] += projections.get(pick.playerId) ?? 0;
    }
    for (const key of Object.keys(positionValues) as PositionKey[]) positionValues[key] = Number(positionValues[key].toFixed(2));
    const totalValue = Number(Object.values(positionValues).reduce((sum, value) => sum + value, 0).toFixed(2));
    return [{ team: { ...team, rank: 0, totalValue, futurePickValue: 0, positionValues }, starterIds: used, projections }];
  });
  return teams
    .sort((a, b) => b.team.totalValue - a.team.totalValue || a.team.teamName.localeCompare(b.team.teamName))
    .map((entry, index) => ({ ...entry, team: { ...entry.team, rank: index + 1 } }));
}
