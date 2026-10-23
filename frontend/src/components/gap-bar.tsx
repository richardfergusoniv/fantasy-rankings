import { gapBarShare } from "../lib/bar-geometry";

/** A bar that grows from a center line toward the leader, as long as the real gap. */
export function GapBar({ left, right, lowerIsBetter = false, neutral = false }: {
  left: number | null | undefined;
  right: number | null | undefined;
  lowerIsBetter?: boolean;
  neutral?: boolean;
}) {
  const { side, share } = left == null || right == null
    ? { side: null, share: 0 }
    : gapBarShare(left, right, { lowerIsBetter, neutral });
  return (
    <span className="gap-bar" aria-hidden="true">
      {side ? <i className={`gap-bar-fill is-${side}`} style={{ width: `${share}%` }} /> : null}
      <b className="gap-bar-center" />
    </span>
  );
}
