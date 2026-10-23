import { rankStripLabelShift, rankStripLead, rankStripPosition } from "../lib/bar-geometry";

type RankStripPoint = { label: string; rank: number };

/**
 * Two ranks on one #1-to-last line. The gap between the dots is the gap in
 * ranks, so a real mismatch looks like one. The better rank is the filled dot
 * and its label sits above the line; the other label sits below.
 */
export function RankStrip({ first, second, total = 32, ariaLabel }: {
  first: RankStripPoint;
  second: RankStripPoint;
  total?: number;
  ariaLabel: string;
}) {
  const firstPosition = rankStripPosition(first.rank, total);
  const secondPosition = rankStripPosition(second.rank, total);
  const lead = rankStripLead(first.rank, second.rank);
  const spanStart = Math.min(firstPosition, secondPosition);
  const spanWidth = Math.abs(firstPosition - secondPosition);
  return (
    <div className={`rank-strip${lead ? " has-lead" : ""}`} role="img" aria-label={ariaLabel}>
      <span className={`rank-strip-label is-first${lead === "first" ? " is-lead" : ""}`} style={{ left: `${firstPosition}%`, transform: `translateX(${rankStripLabelShift(firstPosition)}%)` }}>{first.label}</span>
      <i className="rank-strip-track" />
      <i className="rank-strip-span" style={{ left: `${spanStart}%`, width: `${spanWidth}%` }} />
      <i className={`rank-strip-dot${lead === "first" ? " is-lead" : ""}`} style={{ left: `${firstPosition}%` }} />
      <i className={`rank-strip-dot${lead === "second" ? " is-lead" : ""}`} style={{ left: `${secondPosition}%` }} />
      <span className={`rank-strip-label is-second${lead === "second" ? " is-lead" : ""}`} style={{ left: `${secondPosition}%`, transform: `translateX(${rankStripLabelShift(secondPosition)}%)` }}>{second.label}</span>
    </div>
  );
}
