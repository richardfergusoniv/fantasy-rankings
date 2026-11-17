/**
 * The one loading screen. The same picture shows from the first paint (a copy of this
 * markup sits in index.html) through sign-in, the app download and the first data load,
 * so starting the app is one screen that fills in, not several that replace each other.
 * boot-screen.test.ts keeps the index.html copy identical.
 */
export const BOOT_ROWS = 6;
/** One sweep of the shimmer, in ms. Matches `boot-sweep` in feed.css. */
const SWEEP_MS = 1400;

export function BootScreenMarkup() {
  return (
    <>
      <div className="boot-head"><span className="live-dot" /><span className="boot-bar boot-bar-week" /></div>
      <div className="boot-body">
        <span className="boot-bar boot-bar-heading" />
        {Array.from({ length: BOOT_ROWS }, (_, row) => (
          <div className="boot-row" key={row}>
            <span className="boot-bar boot-bar-title" />
            <span className="boot-bar boot-bar-value" />
            <span className="boot-bar boot-bar-sub" />
          </div>
        ))}
      </div>
    </>
  );
}

/** True when this browser holds a saved sign-in, so the app (not the sign-in page) is what loads next. */
export function hasSavedSignIn(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      if (/^sb-.*-auth-token$/.test(localStorage.key(index) ?? "")) return true;
    }
  } catch {
    // Storage is blocked: fall through to the plain background.
  }
  return false;
}

export function BootScreen() {
  // Each stage mounts its own copy. Starting the shimmer partway through, by the page clock,
  // keeps the sweep continuous across those swaps instead of restarting each time.
  const offset = typeof performance === "undefined" ? 0 : Math.round(performance.now() % SWEEP_MS);
  return (
    <div className="boot-screen" role="status" aria-busy="true" aria-label="Loading" style={{ "--boot-offset": `-${offset}ms` } as React.CSSProperties}>
      <BootScreenMarkup />
    </div>
  );
}
