import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AskContext } from "../lib/ask-context";
import { ChatPanel } from "./chat-panel";

/** Chat as a sheet over the current page: a side panel on desktop, a bottom sheet on a phone. */
export function AskSheet({
  open,
  onOpenChange,
  context,
  horizon,
  leagueId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: AskContext;
  horizon: "week" | "ros" | "dynasty" | null;
  /** League the user is viewing — chat defaults team questions to it. */
  leagueId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ask-sheet">
        <div className="ask-sheet-grabber" aria-hidden="true" />
        <div className="ask-sheet-head">
          <DialogTitle>Ask</DialogTitle>
          <span className="ask-sheet-context">· {context.label}</span>
          <DialogDescription className="sr-only">Ask questions about your leagues, answered from your data.</DialogDescription>
        </div>
        <DialogCloseButton />
        <ChatPanel horizon={horizon} leagueId={leagueId} variant="sheet" suggestions={context.suggestions} />
      </DialogContent>
    </Dialog>
  );
}
