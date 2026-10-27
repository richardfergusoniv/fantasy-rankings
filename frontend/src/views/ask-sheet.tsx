import { useEffect } from "react";
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AskContext } from "../lib/ask-context";
import { trackVisualViewport } from "../lib/visual-viewport";
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
  // Pin the sheet and its overlay to the visual viewport while open. The
  // sheet's CSS anchors to the --vv-* variables, so when the on-screen
  // keyboard opens the sheet shrinks in place instead of being pushed up
  // with the layout viewport, and the page behind never shows through.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("ask-sheet-open");
    const stop = trackVisualViewport(root, window.visualViewport);
    return () => {
      stop?.();
      root.classList.remove("ask-sheet-open");
    };
  }, [open ]);

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
