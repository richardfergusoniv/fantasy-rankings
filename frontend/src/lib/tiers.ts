/**
 * Tiers for a ranked list: a new tier starts where the drop to the next player
 * is much bigger than the drops around it. The list must already be in rank
 * order, best first. Players with no value stay in the tier above them.
 */

/** A drop must be at least this many times the typical drop nearby to start a tier. */
export const TIER_BREAK_RATIO = 2;
/** Typical drops are measured over this many drops on each side. */
const NEIGHBOURHOOD = 4;
/** A drop smaller than this share of the player's value never starts a tier. */
const MIN_RELATIVE_DROP = 0.02;
/** A tier has at least this many players. */
export const MIN_TIER_SIZE = 2;
/** A longer stretch with no cliff is split at its biggest drop, so no tier runs on forever. */
export const MAX_TIER_SIZE = 12;

export type TierOptions = {
  breakRatio?: number;
  minTierSize?: number;
  maxTierSize?: number;
};

/** The 1-based tier number for each value, in the order given. */
export function assignTiers(values: ReadonlyArray<number | null | undefined>, options: TierOptions = {}): number[] {
  const breakRatio = options.breakRatio ?? TIER_BREAK_RATIO;
  const minTierSize = options.minTierSize ?? MIN_TIER_SIZE;
  const maxTierSize = options.maxTierSize ?? MAX_TIER_SIZE;
  const known: Array<{ index: number; value: number }> = [];
  values.forEach((value, index) => {
    if (typeof value === "number" && Number.isFinite(value)) known.push({ index, value });
  });

  // drops[i] is the fall from known[i] to known[i + 1], never negative.
  const drops = known.slice(0, -1).map((item, i) => Math.max(0, item.value - known[i + 1]!.value));
  const startsNewTier = new Set<number>(); // known index that opens a tier
  let tierSize = 1;
  drops.forEach((drop, i) => {
    const nearby: number[] = [];
    for (let j = Math.max(0, i - NEIGHBOURHOOD); j <= Math.min(drops.length - 1, i + NEIGHBOURHOOD); j += 1) {
      if (j !== i) nearby.push(drops[j]!);
    }
    const typical = nearby.length === 0 ? 0 : nearby.reduce((sum, d) => sum + d, 0) / nearby.length;
    const base = Math.abs(known[i]!.value);
    const isCliff = drop > 0
      && drop >= typical * breakRatio
      && (base === 0 || drop / base >= MIN_RELATIVE_DROP)
      && tierSize >= minTierSize
      // Leave at least a full tier for the players below.
      && known.length - (i + 1) >= minTierSize;
    if (isCliff) {
      startsNewTier.add(i + 1);
      tierSize = 1;
    } else {
      tierSize += 1;
    }
  });

  // Split any stretch that is still too long into near-equal parts, cutting each
  // one at the biggest drop close to where an even split would fall.
  const splitLongStretch = (from: number, to: number) => {
    const length = to - from;
    if (length <= maxTierSize) return;
    const parts = Math.ceil(length / maxTierSize);
    const reach = Math.max(1, Math.floor(length / parts / 4));
    let previousCut = from;
    for (let part = 1; part < parts; part += 1) {
      const target = from + Math.round((length * part) / parts);
      let best = -1;
      let bestDrop = -1;
      for (let cut = target - reach; cut <= target + reach; cut += 1) {
        // A cut after known[cut - 1] opens a tier at known[cut].
        if (cut - previousCut < minTierSize || to - cut < minTierSize) continue;
        const drop = drops[cut - 1] ?? 0;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = cut;
        }
      }
      if (best < 0) continue;
      startsNewTier.add(best);
      previousCut = best;
    }
  };
  const openings = [0, ...[...startsNewTier].sort((a, b) => a - b), known.length];
  for (let k = 0; k + 1 < openings.length; k += 1) splitLongStretch(openings[k]!, openings[k + 1]!);

  const result: number[] = [];
  let tier = 1;
  let knownCursor = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (knownCursor < known.length && known[knownCursor]!.index === index) {
      if (startsNewTier.has(knownCursor)) tier += 1;
      knownCursor += 1;
    }
    result.push(tier);
  }
  return result;
}

export type TierGroup<T> = { tier: number; start: number; items: T[] };

/** Consecutive rows with the same tier number, with the index of each group's first row. */
export function groupByTier<T>(rows: readonly T[], tiers: readonly number[]): Array<TierGroup<T>> {
  const groups: Array<TierGroup<T>> = [];
  rows.forEach((row, index) => {
    const tier = tiers[index] ?? 1;
    const last = groups[groups.length - 1];
    if (last && last.tier === tier) last.items.push(row);
    else groups.push({ tier, start: index, items: [row] });
  });
  return groups;
}
