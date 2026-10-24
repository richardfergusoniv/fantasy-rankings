import { Sparkles } from "lucide-react";
import type { Ref } from "react";

export function AskButton({ onClick, buttonRef }: { onClick: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={buttonRef} type="button" className="ask-button" onClick={onClick} aria-label="Ask" title="Ask" aria-haspopup="dialog">
      <Sparkles className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
