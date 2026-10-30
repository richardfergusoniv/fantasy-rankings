import { rankStripLabelShift, rankStripLead, rankStripPosition } from "../lib/bar-geometry";

type EdgeStripPoint = { label: string; rank: number };

/**
 * One matchup stat on a #1-to-last line. The first side is the filled dot with
 * its label above; the second is the hollow dot with its label below, so each
 * side keeps one place in every row. The span between them is amber when the
 * first side leads and coral when the second does.
 */
export function EdgeStrip({ first, second, total = 32, ariaLabel }: {
  first: EdgeStripPoint;
  second: EdgeStripPoint;
  total?: number;
  ariaLabel: string;
}) {
  const firstPosition = rankStripPosition(first.rank, total);
  const secondPosition = rankStripPosition(second.rank, total);
  const lead = rankStripLead(first.rank, second.rank);
  return (
    <div className={`edge-strip${lead === "first" ? " is-for" : lead === "second" ? " is-against" : ""}`} role="img" aria-label={ariaLabel}>
      <i className="edge-strip-track" />
      <i className="edge-strip-span" style={{ left: `${Math.min(firstPosition, secondPosition)}%`, width: `${Math.abs(firstPosition - secondPosition)}%` }} />
      <i className="edge-strip-dot is-second" style={{ left: `${secondPosition}%` }} />
      <i className="edge-strip-dot is-first" style={{ left: `${firstPosition}%` }} />
      <span className="edge-strip-label is-first" style={{ left: `${firstPosition}%`, transform: `translateX(${rankStripLabelShift(firstPosition)}%)` }}>{first.label}</span>
      <span className="edge-strip-label is-second" style={{ left: `${secondPosition}%`, transform: `translateX(${rankStripLabelShift(secondPosition)}%)` }}>{second.label}</span>
    </div>
  );
}
