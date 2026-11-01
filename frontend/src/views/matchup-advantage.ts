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
