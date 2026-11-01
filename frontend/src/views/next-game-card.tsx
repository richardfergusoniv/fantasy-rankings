import type { ProjectedGamePreview } from "../../../api/_lib/projected-standings";
import { CloseGlyph } from "../components/glyphs";
import { ModalCard } from "../components/modal-card";
import { formatDecimal, formatPercent } from "../lib/format-number";
import { AdvantageList } from "./advantage-list";
import { advantageRows, biggestGaps } from "./matchup-advantage";
import { winPercent } from "./win-probability";

type Slot = ProjectedGamePreview["mine"][number];

/**
 * Pair the two lineups slot by slot. Both arrive in the league's slot order, but a
 * starter in a slot the league doesn't list is appended per team, so the tails can differ.
 */
export function pairBySlot(mine: readonly Slot[], theirs: readonly Slot[]): Array<[Slot | null, Slot | null]> {
  const used = new Set<number>();
  const pairs: Array<[Slot | null, Slot | null]> = mine.map((slot) => {
    const index = theirs.findIndex((other, i) => !used.has(i) && other.slot === slot.slot);
    if (index < 0) return [slot, null];
    used.add(index);
    return [slot, theirs[index]!];
  });
  theirs.forEach((slot, i) => { if (!used.has(i)) pairs.push([null, slot]); });
  return pairs;
}

/** Slots in the card: the widest gaps either way, like the Advantage tab but shorter. */
const PREVIEW_SLOTS = 3;

/**
 * Preview of one of your upcoming games, opened from Projected · Your next games:
 * projected score, win chance (same model and colors as the Matchup card), and
 * the biggest slot-by-slot gaps drawn like the Advantage tab.
 */
export function NextGameCard({
  game,
  myName,
  opponentName,
  onClose,
}: {
  game: ProjectedGamePreview;
  myName: string;
  opponentName: string;
  onClose: () => void;
}) {
  const rows = advantageRows(pairBySlot(game.mine, game.theirs).map(([mine, theirs]) => ({
    slot: mine?.slot ?? theirs?.slot ?? "—",
    // An unfilled slot has no player and shows as "—".
    mine: mine?.name ? { name: mine.name, points: mine.points } : null,
    theirs: theirs?.name ? { name: theirs.name, points: theirs.points } : null,
  })));
  const top = biggestGaps(rows, PREVIEW_SLOTS);
  const myWin = game.winProbability === null ? null : winPercent(game.winProbability);
  return (
    <ModalCard onClose={onClose} labelledBy="next-game-title" backdropClassName="matchup-card-backdrop" className="matchup-data-card next-game-card">
      <div className="matchup-data-header matchup-data-header-minimal">
        <h2 id="next-game-title" className="sr-only">Week {game.week}: {myName} versus {opponentName}</h2>
        <button type="button" onClick={onClose} aria-label="Close game preview"><CloseGlyph /></button>
      </div>
      <p className="matchup-eyebrow">Week {game.week}</p>
      <div className="next-game-score" aria-label={`Projected ${formatDecimal(game.myTotal, 1)} to ${formatDecimal(game.theirTotal, 1)}`}>
        <div className="is-mine"><span>{myName}</span><strong>{formatDecimal(game.myTotal, 1)}</strong></div>
        <div className="is-theirs"><span>{opponentName}</span><strong>{formatDecimal(game.theirTotal, 1)}</strong></div>
      </div>
      {myWin !== null ? (
        <div className="matchup-win-probability next-game-win">
          <div className="matchup-win-labels" aria-hidden="true">
            <strong className="is-mine">{formatPercent(myWin)}</strong>
            <span>Win probability</span>
            <strong>{formatPercent(100 - myWin)}</strong>
          </div>
          <div className="matchup-win-bar" role="img" aria-label={`Win probability: ${myName} ${formatPercent(myWin)}, ${opponentName} ${formatPercent(100 - myWin)}`}>
            <span className="is-mine" style={{ width: `${myWin}%` }} />
          </div>
        </div>
      ) : null}
      {top.length > 0 ? (
        <div className="data-table-frame next-game-gaps">
          <AdvantageList rows={top} ariaLabel={`Biggest gaps, week ${game.week}`} />
        </div>
      ) : null}
    </ModalCard>
  );
}
