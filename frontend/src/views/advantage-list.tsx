import { advantageScale, formatGap, type AdvantageRow } from "./matchup-advantage";

/**
 * One row per lineup slot: your player, the slot, their player, then a bar that
 * grows from the center toward whoever leads. Colors match the win-probability
 * bar: your side teal, theirs gray. The sign on the number repeats the direction.
 */
export function AdvantageList({
  rows,
  onOpenPlayer,
  onCompare,
  ariaLabel,
}: {
  rows: readonly AdvantageRow[];
  onOpenPlayer?: (playerId: string) => void;
  /** Tapping the row (anywhere but a name) compares the two players. */
  onCompare?: (mine: string, theirs: string) => void;
  ariaLabel: string;
}) {
  const scale = advantageScale(rows);
  const name = (side: AdvantageRow["mine"], align: "mine" | "theirs") => {
    if (!side) return <span className={`advantage-name is-${align} is-empty`}>—</span>;
    if (side.playerId && onOpenPlayer) {
      const playerId = side.playerId;
      return <button type="button" className={`advantage-name is-${align}`} onClick={() => onOpenPlayer(playerId)}>{side.name}</button>;
    }
    return <span className={`advantage-name is-${align}`}>{side.name}</span>;
  };
  return (
    <div className="advantage-list" role="list" aria-label={ariaLabel}>
      {rows.map((row, index) => {
        const gap = row.gap;
        const mineId = row.mine?.playerId;
        const theirsId = row.theirs?.playerId;
        const compare = onCompare && mineId && theirsId ? () => onCompare(mineId, theirsId) : null;
        const width = gap === null ? 0 : (Math.abs(gap) / scale) * 100;
        const label = gap === null
          ? `${row.slot}: no projection`
          : gap === 0 ? `${row.slot}: even` : `${row.slot}: ${gap > 0 ? "you lead" : "they lead"} by ${Math.abs(gap).toFixed(1)}`;
        return (
          <div className={`advantage-row${compare ? " is-comparable" : ""}`} role="listitem" aria-label={label} key={`${row.slot}-${index}`}>
            {compare ? <button type="button" className="advantage-row-open" aria-label={`Compare ${row.mine!.name} and ${row.theirs!.name}`} onClick={compare} /> : null}
            {name(row.mine, "mine")}
            <span className="advantage-slot" aria-hidden="true">{row.slot.replace("_", " ")}</span>
            {name(row.theirs, "theirs")}
            <div className="advantage-bars" aria-hidden="true">
              <div className="advantage-half is-mine">
                {gap !== null && gap > 0 ? <><b>{formatGap(gap)}</b><i style={{ width: `${width}%` }} /></> : null}
              </div>
              <span />
              <div className="advantage-half is-theirs">
                {gap !== null && gap < 0 ? <><i style={{ width: `${width}%` }} /><b>{formatGap(gap)}</b></> : null}
                {gap === 0 ? <b className="is-even">0.0</b> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
