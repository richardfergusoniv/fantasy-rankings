/** Where a rank sits on a 1..total line, as 0-100 from the best end (#1) to the worst. */
export function rankStripPosition(rank: number, total = 32): number {
  if (total <= 1) return 0;
  const position = ((rank - 1) / (total - 1)) * 100;
  return Math.min(100, Math.max(0, position));
}

/** Which of two ranks is better (lower), or null when they match. */
export function rankStripLead(first: number, second: number): "first" | "second" | null {
  if (first === second) return null;
  return first < second ? "first" : "second";
}

/** The label offset, as a percent of its own width, that keeps it inside the strip near either end. */
export function rankStripLabelShift(position: number): number {
  if (position < 18) return -10;
  if (position > 82) return -90;
  return -50;
}

/**
 * How far the leader's bar grows from the center line, as a percent of the
 * full track (0-50). The length is the real difference relative to the two
 * values' average, so a tie has no bar and a big gap reads as one.
 */
export function gapBarShare(
  left: number,
  right: number,
  options: { lowerIsBetter?: boolean; neutral?: boolean } = {},
): { side: "left" | "right" | null; share: number } {
  if (options.neutral || left === right) return { side: null, share: 0 };
  const mean = (Math.abs(left) + Math.abs(right)) / 2;
  if (mean === 0) return { side: null, share: 0 };
  const leftLeads = options.lowerIsBetter ? left < right : left > right;
  const share = Math.min(50, (Math.abs(left - right) / mean) * 100);
  return { side: leftLeads ? "left" : "right", share };
}
