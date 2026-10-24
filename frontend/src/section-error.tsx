import { Button } from "@/components/ui/button";

// Kept out of dashboard-shared so the app-level error boundary (in the entry
// chunk, around the lazy-loaded App) doesn't pull dashboard code with it.

export function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg className={spinning ? "spin" : ""} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.3 9A7 7 0 0 0 6.5 6.5L4 9m16 6-2.5 2.5A7 7 0 0 1 5.7 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SectionError({ title, onRetry, retrying = false, compact = false }: { title: string; onRetry: () => void; retrying?: boolean; compact?: boolean }) {
  return (
    <div className={`section-error${compact ? " compact" : ""}`} role="alert">
      <strong>{title}</strong>
      <Button type="button" variant="outline" onClick={onRetry} disabled={retrying}>
        <RefreshIcon spinning={retrying} /> Retry
      </Button>
    </div>
  );
}
