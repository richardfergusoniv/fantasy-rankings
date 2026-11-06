import { formatPercent } from "../lib/format-number";

/** The bar's scale: a move this big or bigger reaches the end. */
export const MOVE_BAR_CAP = 50;

export type MoveBarSpan = { left: number; width: number; direction: "up" | "down" | "flat" };

/**
 * Where the bar sits, in percent of the track. The middle is the value 30 days ago:
 * a rise grows right, a fall grows left, capped at MOVE_BAR_CAP. A value that rose
 * from zero (an infinite move) fills the right half.
 */
export function moveBarSpan(movePercent: number): MoveBarSpan {
  if (Number.isNaN(movePercent) || movePercent === 0) return { left: 50, width: 0, direction: "flat" };
  const half = (Math.min(Math.abs(movePercent), MOVE_BAR_CAP) / MOVE_BAR_CAP) * 50;
  return movePercent > 0
    ? { left: 50, width: half, direction: "up" }
    : { left: 50 - half, width: half, direction: "down" };
}

export function moveBarLabel(movePercent: number): string {
  if (Number.isNaN(movePercent) || movePercent === 0) return "No change in 30 days";
  if (!Number.isFinite(movePercent)) return movePercent > 0 ? "Up from 0 in 30 days" : "Down to 0 in 30 days";
  return `${movePercent > 0 ? "Up" : "Down"} ${formatPercent(Math.abs(movePercent))} in 30 days`;
}

/**
 * A season value's 30-day move: a tick for where it was, a bar to where it is now,
 * green when it rose and red when it fell. No bar when there is no 30-day history.
 */
export function MoveBar({ movePercent, className }: { movePercent: number | null; className?: string }) {
  if (movePercent === null) return null;
  const span = moveBarSpan(movePercent);
  const label = moveBarLabel(movePercent);
  return (
    <span className={["move-bar", `is-${span.direction}`, className].filter(Boolean).join(" ")} role="img" aria-label={label} title={label}>
      {span.width > 0 ? <b style={{ left: `${span.left}%`, width: `${span.width}%` }} /> : null}
      <u />
    </span>
  );
}
