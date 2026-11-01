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
export function ListPagination({ shown, total, step, onMore, className = "", hideCount = false }: { shown: number; total: number; step: number; onMore: () => void; className?: string; hideCount?: boolean }) {
  const hasMore = shown < total;
  // With the count hidden and nothing more to load there is no row at all.
  if (hideCount && !hasMore) return null;
  return (
    <div className={`list-pagination-row${className ? ` ${className}` : ""}`}>
      {/* The empty span keeps the button at the row's right edge. */}
      {hideCount ? <span aria-hidden="true" /> : <span aria-live="polite">{Math.min(shown, total)} of {total}</span>}
      {hasMore ? <button type="button" onClick={onMore}>Show {Math.min(step, total - shown)} more</button> : null}
    </div>
  );
}
