import { useAuthSession } from "../auth-session";

/** Compact account row on Tools — replaces the full-width signed-in bar. */
export function ToolsAccountFooter() {
  const { sleeperUsername, signOut } = useAuthSession();
  if (!sleeperUsername || !signOut) return null;

  return (
    <footer className="tools-account-footer" aria-label="Account">
      <span>
        Sleeper · <span translate="no">{sleeperUsername}</span>
      </span>
      <button type="button" onClick={signOut}>
        Sign out
      </button>
    </footer>
  );
}
