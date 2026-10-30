import type { ReactNode } from "react";
import { CloseGlyph } from "./components/glyphs";
import { ModalCard } from "./components/modal-card";

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
  if (!isOpen) return null;

  return (
    <ModalCard onClose={onClose} labelledBy="chart-result-title" backdropClassName="chart-result-backdrop" className={["chart-result-card", className].filter(Boolean).join(" ")}>
          <div className="chart-result-header">
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
                <CloseGlyph />
              </button>
            </div>
          </div>
          <div className="chart-result-body">{children}</div>
    </ModalCard>
  );
}
