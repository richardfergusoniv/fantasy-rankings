import { useRef, type ReactNode } from "react";
import { ModalPortal, useDialogFocusTrap } from "../shared";

/**
 * The shell shared by the app's overlays: portal, dimmed backdrop (click to close), a labelled
 * dialog card with Escape and Tab handling, and focus returned on close. The caller picks the
 * backdrop and card classes (width, height, padding) and supplies its own header.
 */
export function ModalCard({ onClose, labelledBy, backdropClassName, className, enabled = true, children }: {
  onClose: () => void;
  labelledBy: string;
  backdropClassName: string;
  className: string;
  /** False pauses the focus trap, for a card that sits under another one. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(cardRef, onClose, enabled);
  return (
    <ModalPortal>
      <div className={backdropClassName} onClick={onClose}>
        <article ref={cardRef} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          {children}
        </article>
      </div>
    </ModalPortal>
  );
}
