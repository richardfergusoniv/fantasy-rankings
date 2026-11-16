import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { FactorEdge } from "../views/start-sit-verdict";
import { ChevronGlyph } from "./glyphs";

/**
 * The Assistant's answer on the screen where you make the decision. The whole
 * card is one button: tapping it opens the sheet with everything behind the
 * answer. Keep the card to the answer itself; reasons live in the sheet.
 */
export function AssistantCard({ eyebrow, onOpen, label, more = "Details", children }: {
  /** Names the kind of answer, e.g. "Start". */
  eyebrow: string;
  /** The link text in the corner. */
  more?: string;
  onOpen: () => void;
  /** Spoken name for the button: the answer in a sentence. */
  label: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className="assistant-card" onClick={onOpen} aria-haspopup="dialog" aria-label={`${label}. Show details`}>
      <span className="assistant-card-top">
        <span className="assistant-card-eyebrow">Assistant · {eyebrow}</span>
        <span className="assistant-card-more" aria-hidden="true">{more}<ChevronGlyph /></span>
      </span>
      {children}
    </button>
  );
}

export type AssistantSheetColumn = { heading: string };

/** One table inside the sheet: a heading row naming each side, then a row per input. */
export function AssistantTable({ title, columns, rows, leadCaption = false }: {
  title: string;
  /** Set the caption as the answer itself (body size, bold), not a small grey label. */
  leadCaption?: boolean;
  columns: readonly [string, string];
  rows: ReadonlyArray<{ label: string; values: readonly [ReactNode, ReactNode]; edge?: FactorEdge }>;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="assistant-table">
      <caption className={leadCaption ? "is-lead" : undefined}>{title}</caption>
      <thead>
        <tr><th scope="col"><span className="sr-only">Input</span></th><th scope="col">{columns[0]}</th><th scope="col">{columns[1]}</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td className={row.edge === 0 ? "is-edge" : undefined}>{row.values[0]}</td>
            <td className={row.edge === 1 ? "is-edge" : undefined}>{row.values[1]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Facts about one thing, label and value per row. */
export function AssistantFacts({ title, facts }: { title: string; facts: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  if (facts.length === 0) return null;
  return (
    <section className="assistant-facts" aria-label={title}>
      <h3>{title}</h3>
      <dl>
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The detail sheet behind an Assistant card. "Ask a follow-up" is the only thing that calls the chat. */
export function AssistantSheet({ open, onOpenChange, title, description, question, onAsk, before, actions, children }: {
  open: boolean;
  /** Shown above the title, e.g. a link back to a list. */
  before?: ReactNode;
  /** Buttons pinned under the scrolling body, above "Ask a follow-up", so the main action is never below the fold. */
  actions?: ReactNode;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Question handed to chat when "Ask a follow-up" is tapped. */
  question: string;
  onAsk: (question: string) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="assistant-sheet">
        <DialogCloseButton label="Close details" />
        {before}
        <DialogTitle className="assistant-sheet-title">{title}</DialogTitle>
        {/* Read by screen readers only: the sheet shows no helper text. */}
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="assistant-sheet-body">{children}</div>
        {actions}
        <Button type="button" variant="outline" className="assistant-sheet-ask" onClick={() => { onOpenChange(false); onAsk(question); }}>
          Ask a follow-up
        </Button>
      </DialogContent>
    </Dialog>
  );
}
