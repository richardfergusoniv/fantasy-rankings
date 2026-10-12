import type { BasePosition } from "./dashboard-types";

/** Starter-style order used for bench lists: QB, RB, WR, TE, K, DST(DEF). */
export const FANTASY_POSITION_ORDER: readonly BasePosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** QB → RB → WR → TE → K → DST(DEF); unknown positions sort last. */
export function fantasyPositionSortIndex(position: string): number {
  const index = FANTASY_POSITION_ORDER.indexOf(position as BasePosition);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareByFantasyPosition(left: string, right: string): number {
  return fantasyPositionSortIndex(left) - fantasyPositionSortIndex(right);
}

/** Stable within-position order when `compareWithinPosition` is omitted. */
export function sortPlayersByFantasyPosition<T extends { position: string }>(
  players: readonly T[],
  compareWithinPosition?: (left: T, right: T) => number,
): T[] {
  return [...players].sort(
    (left, right) => compareByFantasyPosition(left.position, right.position)
      || (compareWithinPosition?.(left, right) ?? 0),
  );
}
