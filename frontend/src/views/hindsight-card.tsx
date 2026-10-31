import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BetterPick, Hindsight } from "../../../api/_lib/draft-grade";
import { CardHero } from "../components/card-hero";
import { ChevronGlyph } from "../components/glyphs";

/** `+5.8%`, `0.0%`: how far a lineup is above the drafted one. */
export const gapText = (gap: number) => `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`;

/** Raised summary at the top of Hindsight: lineup gains in numbers. Opens every strategy side by side. */
export function HindsightCard({ hindsight, yoursIsBest, yoursTiming, onOpen }: {
  hindsight: Hindsight;
  yoursIsBest: boolean;
  yoursTiming: string;
  onOpen: () => void;
}) {
  const items = [
    { label: "Lineup gap", value: gapText(hindsight.gapToBest), sub: "vs best strategy", valueTone: hindsight.gapToBest > 0 ? ("good" as const) : undefined },
    { label: "Picks to change", value: `${hindsight.changes} of ${hindsight.of}`, sub: "best strategy" },
    yoursIsBest
      ? { label: "Your strategy", value: "Best", sub: yoursTiming }
      : { label: "Your strategy", value: gapText(hindsight.gapYours), sub: "done best", valueTone: hindsight.gapYours > 0 ? ("good" as const) : undefined },
  ];
  return (
    <Card
      className="draft-grade hindsight-card gap-0 py-0 shadow-sm"
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
    >
      <span className="hindsight-chevron"><ChevronGlyph /></span>
      <CardHero ariaLabel="Hindsight" items={items} />
      {hindsight.biggestSwap ? (
        <div className="hindsight-swap">
          <span><b>Biggest swap</b> · {hindsight.biggestSwap.from} for {hindsight.biggestSwap.to.name}</span>
          <em>+{hindsight.biggestSwap.gain.toLocaleString()}</em>
        </div>
      ) : null}
    </Card>
  );
}

type Entry = { playerId: string; pickNo: number };

/** Every strategy side by side: the user's picks down the side, each strategy's replacement across the top. */
export function HindsightSheet({ open, onOpenChange, hindsight, entries, nameOf, secondaryOf }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hindsight: Hindsight;
  entries: readonly Entry[];
  nameOf: (playerId: string) => { name: string; secondary: string | null } | undefined;
  secondaryOf: (position: string, team: string | null) => string | null;
}) {
  const cell = (swap: BetterPick | undefined) => {
    if (!swap) return <span className="hindsight-none">—</span>;
    const secondary = secondaryOf(swap.position, swap.team);
    return <><strong>{swap.name}</strong>{secondary ? <small>{secondary}</small> : null}</>;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="hindsight-sheet"
        onCloseAutoFocus={(event) => {
          // The sheet opens from the summary card, so put focus back on it rather than on the page.
          event.preventDefault();
          document.querySelector<HTMLElement>(".hindsight-card")?.focus();
        }}
      >
        <div className="hindsight-sheet-head">
          <DialogTitle>All strategies</DialogTitle>
          <DialogDescription className="sr-only">Who each strategy would have taken at each of your picks, on today’s values.</DialogDescription>
        </div>
        <DialogCloseButton />
        <div className="hindsight-scroll" tabIndex={0} role="region" aria-label="All strategies, scrolls sideways">
          <table className="hindsight-table">
            <thead>
              <tr>
                <th scope="col" className="is-pick">Your pick</th>
                {hindsight.plans.map((plan) => (
                  <th scope="col" key={`${plan.name}-${plan.timing}`} className={`${plan.best ? "is-best " : ""}${plan.yours ? "is-yours " : ""}${plan.gap === null ? "is-off" : ""}`}>
                    <b>{plan.name}</b>
                    <span>{plan.timing}</span>
                    <em>{plan.gap === null ? "Not possible" : gapText(plan.gap)}</em>
                    {plan.best || plan.yours ? <Badge variant="secondary" size="compact" className="status-badge">{[plan.best ? "Best" : null, plan.yours ? "Yours" : null].filter(Boolean).join(" · ")}</Badge> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const own = nameOf(entry.playerId);
                return (
                  <tr key={entry.playerId}>
                    <th scope="row" className="is-pick">
                      <strong>{own?.name}</strong>
                      <small>{[`Pick ${entry.pickNo}`, own?.secondary].filter(Boolean).join(" · ")}</small>
                    </th>
                    {hindsight.plans.map((plan) => (
                      <td key={`${plan.name}-${plan.timing}`} className={plan.gap === null ? "is-off" : undefined}>{cell(plan.swaps[entry.playerId])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
