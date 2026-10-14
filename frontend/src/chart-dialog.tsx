import { useRef, type ReactNode } from "react";
import { ModalPortal, useDialogFocusTrap } from "./shared";

export function ChartDialog({
  isOpen,
  onClose,
  title,
  subtitle,
  count,
  countLabel,
  showCount = true,
  closeLabel = "Close",
  className,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  count?: number;
  countLabel?: string;
  showCount?: boolean;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose, isOpen);
  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="chart-result-backdrop" onClick={onClose}>
        <article
          ref={dialogRef}
          className={["chart-result-card", className].filter(Boolean).join(" ")}
          role="dialog"
          aria-modal="true"
          aria-labelledby="chart-result-title"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="chart-result-header">
            <div>
              <h2 id="chart-result-title">{title}</h2>
              {subtitle ? <span>{subtitle}</span> : null}
            </div>
            <div className="chart-result-header-actions">
              {showCount && typeof count === "number" && countLabel ? (
                <span>
                  <strong>{count}</strong> {countLabel}
                </span>
              ) : null}
              <button type="button" onClick={onClose} aria-label={closeLabel}>
                ×
              </button>
            </div>
          </header>
          <div className="chart-result-body">{children}</div>
        </article>
      </div>
    </ModalPortal>
  );
}
