import { optimizeValueTradeRoster } from "./lineup-optimizer.js";

/**
 * Position needs for the trade finder. A position's raw lineup value is not comparable across
 * positions (tight ends always total the least), so needs are ranked against the league average
 * for that position, and an incoming player must earn a starting spot to be worth asking for.
 */

export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type SkillPosition = (typeof SKILL_POSITIONS)[number];
export type PositionValues = Record<SkillPosition, number>;

/** Skill positions ordered from weakest to strongest compared with the league average for each position. */
export function positionsByNeed(row: { positionValues: PositionValues }, league: Array<{ positionValues: PositionValues }>): SkillPosition[] {
  const average = (position: SkillPosition) => (league.length > 0 ? league.reduce((sum, team) => sum + team.positionValues[position], 0) / league.length : 0);
  const relative = (position: SkillPosition) => {
    const avg = average(position);
    return avg > 0 ? row.positionValues[position] / avg : row.positionValues[position];
  };
  return [...SKILL_POSITIONS].sort((a, b) => relative(a) - relative(b));
}

type RosterPlayer = { playerId: string; position: string };

/**
 * Whether a player would start for this roster: adding him raises the value of the best lineup the
 * league's slots allow. Flex slots count, so a tight end who would start at FLEX qualifies even when
 * the starting tight end is better. Answers are cached per player.
 */
export function startsForRoster(roster: RosterPlayer[], slots: string[], valueById: ReadonlyMap<string, number>): (player: RosterPlayer) => boolean {
  const asOptimizable = (player: RosterPlayer) => ({ playerId: player.playerId, position: player.position, lineupSlot: null, isStarter: false, projection: null, actual: null });
  const base = roster.map(asOptimizable);
  const baseScore = optimizeValueTradeRoster(base, slots, valueById).score;
  const cache = new Map<string, boolean>();
  return (player) => {
    const known = cache.get(player.playerId);
    if (known !== undefined) return known;
    const starts = optimizeValueTradeRoster([...base, asOptimizable(player)], slots, valueById).score > baseScore;
    cache.set(player.playerId, starts);
    return starts;
  };
}
