import { flushSync } from "react-dom";

/**
 * Same-document view transitions for view switches (see use-dashboard-url).
 *
 * Browsers without the View Transitions API and users who prefer reduced
 * motion get the update exactly as before: applied directly, no animation.
 * The CSS half lives in theme/shell.css, which names only the main content
 * region, so the shell chrome never animates.
 */

export function viewTransitionSupported(doc: Document): boolean {
  return typeof doc.startViewTransition === "function";
}

export function prefersReducedMotion(win: Window): boolean {
  return typeof win.matchMedia === "function"
    && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function withViewTransition(update: () => void): void {
  if (!viewTransitionSupported(document) || prefersReducedMotion(window)) {
    update();
    return;
  }
  document.startViewTransition(() => {
    // The browser captures the new snapshot once this callback returns, so
    // the state update has to be flushed synchronously inside it.
    flushSync(update);
  });
}
