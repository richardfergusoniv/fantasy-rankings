import type { ReactNode } from "react";

/** The loading look every section shares: a caption over shimmer rows. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="section-loading" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <span>{label}</span>
      <div className="loading-shimmer loading-line wide" aria-hidden="true" />
      <div className="loading-shimmer loading-line" aria-hidden="true" />
      <div className="loading-shimmer loading-line" aria-hidden="true" />
    </section>
  );
}

/** One empty state: what is missing, then what to do about it. */
export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="state-empty">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </div>
  );
}

/** The end of a long list: how much is showing, and a button for more. */
export function ListPagination({ shown, total, step, onMore, className = "" }: { shown: number; total: number; step: number; onMore: () => void; className?: string }) {
  return (
    <div className={`list-pagination-row${className ? ` ${className}` : ""}`}>
      <span aria-live="polite">{Math.min(shown, total)} of {total}</span>
      {shown < total ? <button type="button" onClick={onMore}>Show {Math.min(step, total - shown)} more</button> : null}
    </div>
  );
}
