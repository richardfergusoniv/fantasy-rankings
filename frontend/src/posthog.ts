/**
 * PostHog product analytics + error tracking (client side).
 *
 * - Loaded via dynamic import and initialized only when VITE_POSTHOG_KEY is
 *   set; otherwise every export is a no-op and posthog-js stays out of the
 *   initial bundle, so local/preview builds without the key behave as before.
 * - Events are captured for identified users only: capture is opted out by
 *   default and `person_profiles` is "identified_only", so nothing is sent
 *   until AuthGate identifies the signed-in user (Sleeper user ID, never
 *   email) and capture is opted out again on sign-out.
 * - Session recording is disabled outright. Event properties are scrubbed
 *   of anything credential-shaped before they leave the browser, including
 *   credentials embedded inside URL or error-message strings.
 */

const POSTHOG_HOST = "https://us.i.posthog.com";

type PostHogClient = typeof import("posthog-js").default;

let posthogPromise: Promise<PostHogClient | null> | null = null;

const SENSITIVE_KEY = /(authorization|token|secret|password|api[-_]?key|cookie)/i;
// `key=value` credentials embedded inside URL or error-message strings
// (e.g. "https://api.example.com/x?apikey=abc123&season=2025").
const SENSITIVE_PARAM = /((?:authorization|token|secret|password|api[-_]?key|cookie)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s&"']+)/gi;

function scrubString(value: string): string {
  return value.replace(SENSITIVE_PARAM, "$1[redacted]");
}

function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (depth > 4 || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

function loadPostHog(): Promise<PostHogClient | null> {
  posthogPromise ??= (async () => {
    try {
      const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
      if (!key) return null;
      const { default: posthog } = await import("posthog-js");
      posthog.init(key, {
        api_host: POSTHOG_HOST,
        person_profiles: "identified_only",
        // Anonymous browsers must not send events at all: start opted out and
        // opt in only once a user is identified (see identifyPostHogUser).
        opt_out_capturing_by_default: true,
        capture_pageview: true,
        capture_exceptions: true,
        autocapture: true,
        disable_session_recording: true,
        before_send: (event) => {
          if (!event) return null;
          if (event.properties) {
            event.properties = scrub(event.properties) as typeof event.properties;
          }
          return event;
        },
      });
      return posthog;
    } catch {
      // A failed chunk fetch clears the cache so the next call can retry
      // instead of leaving every export stuck on a rejected promise.
      posthogPromise = null;
      return null;
    }
  })();
  return posthogPromise;
}

export function initPostHog(): void {
  void loadPostHog();
}

export function identifyPostHogUser(sleeperUserId: string, sleeperUsername?: string): void {
  void loadPostHog().then((posthog) => {
    if (!posthog) return;
    // Capture is opted out by default; enable it only once a user is known.
    posthog.opt_in_capturing();
    posthog.identify(
      sleeperUserId,
      sleeperUsername ? { sleeper_username: sleeperUsername } : undefined,
    );
  });
}

export function resetPostHog(): void {
  void loadPostHog().then((posthog) => {
    if (!posthog) return;
    posthog.reset();
    // reset() also clears the persisted opt-in flag, so re-assert the
    // opted-out default after it.
    posthog.opt_out_capturing();
  });
}

export function captureClientError(err: unknown): void {
  void loadPostHog().then((posthog) => posthog?.captureException(err));
}
