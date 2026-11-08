/**
 * Slot-by-slot gaps for the Matchup Advantage tab and the Projected
 * next-games preview card. Pure so it can be unit tested.
 */

export type AdvantageSide = {
  playerId?: string | null;
  name: string;
  points: number | null;
};

export type AdvantageSlotInput = {
  slot: string;
  mine: AdvantageSide | null;
  theirs: AdvantageSide | null;
};

export type AdvantageRow = AdvantageSlotInput & {
  /** Your points minus theirs; null when either side has no projection. An empty slot counts as 0. */
  gap: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function advantageRows(slots: readonly AdvantageSlotInput[]): AdvantageRow[] {
  return slots.map((row) => {
    const mine = row.mine ? row.mine.points : 0;
    const theirs = row.theirs ? row.theirs.points : 0;
    const gap = mine === null || theirs === null ? null : round1(mine - theirs);
    return { ...row, gap };
  });
}

const FLEX_SLOTS = new Set(["FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX"]);

/** One lineup slot as the league lists it, with whoever currently holds it. */
export type StarterSlot<T> = {
  slot: string;
  /** The holder's position; null for an empty slot. */
  position: string | null;
  player: T | null;
};

/**
 * Re-deal a lineup's players across its slots so two teams compare like for like:
 * within each position the best player (by `valueOf`, highest first) takes the first
 * slot and the worst the last, and a FLEX slot gets the lowest-valued player left
 * over at its position, so it is always the weakest of the flex-eligible group.
 *
 * `valueOf` is the live-aware points, so a player whose game has finished sorts by
 * what he scored and slides up or down against everyone still projected. A player
 * with no value sorts last. Ties keep the league's slot order. Slots keep their
 * league order; only the players move.
 */
export function rankStartersBySlot<T>(
  starters: readonly StarterSlot<T>[],
  valueOf: (player: T) => number | null,
): Array<{ slot: string; player: T | null }> {
  const byPosition = new Map<string, Array<{ player: T; value: number | null; order: number }>>();
  starters.forEach((starter, order) => {
    if (!starter.player || !starter.position) return;
    const group = byPosition.get(starter.position) ?? [];
    group.push({ player: starter.player, value: valueOf(starter.player), order });
    byPosition.set(starter.position, group);
  });
  for (const group of byPosition.values()) {
    group.sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.order - b.order : a.value === null ? 1 : -1;
      return b.value - a.value || a.order - b.order;
    });
  }
  const next = new Map<string, number>();
  const take = (position: string): T | null => {
    const index = next.get(position) ?? 0;
    next.set(position, index + 1);
    return byPosition.get(position)?.[index]?.player ?? null;
  };
  const dealt: Array<T | null> = starters.map(() => null);
  // Dedicated slots first, so what is left over at each position is what FLEX holds.
  starters.forEach((starter, index) => {
    if (!FLEX_SLOTS.has(starter.slot)) dealt[index] = take(starter.slot);
  });
  starters.forEach((starter, index) => {
    if (FLEX_SLOTS.has(starter.slot) && starter.position) dealt[index] = take(starter.position);
  });
  return starters.map((starter, index) => ({ slot: starter.slot, player: dealt[index] ?? null }));
}

/** Largest absolute gap, so every bar in a list shares one scale. Never 0. */
export function advantageScale(rows: readonly AdvantageRow[]): number {
  return Math.max(1, ...rows.map((row) => Math.abs(row.gap ?? 0)));
}

/** The n slots with the widest gaps, either direction, biggest first. */
export function biggestGaps(rows: readonly AdvantageRow[], count: number): AdvantageRow[] {
  return [...rows]
    .filter((row) => row.gap !== null && row.gap !== 0)
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0))
    .slice(0, count);
}

/** "+5.3", "−2.8" (true minus sign), "0.0". */
export function formatGap(gap: number): string {
  if (gap > 0) return `+${gap.toFixed(1)}`;
  if (gap < 0) return `−${Math.abs(gap).toFixed(1)}`;
  return "0.0";
}
