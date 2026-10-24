import { Sparkles } from "lucide-react";

export function AskButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ask-button" onClick={onClick} aria-label="Ask" title="Ask" aria-haspopup="dialog">
      <Sparkles className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
