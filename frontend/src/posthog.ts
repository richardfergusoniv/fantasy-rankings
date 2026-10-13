import posthog from "posthog-js";

/**
 * PostHog product analytics + error tracking (client side).
 *
 * - Initialized only when VITE_POSTHOG_KEY is set; otherwise every export
 *   is a no-op, so local/preview builds without the key behave as before.
 * - The PostHog project runs in identified-only person mode: the SDK
 *   drops events from anonymous browsers, so nothing is recorded until
 *   AuthGate identifies the signed-in user (Sleeper user ID, never email).
 * - Session recording is disabled outright. Event properties are scrubbed
 *   of anything credential-shaped before they leave the browser.
 */

const POSTHOG_HOST = "https://us.i.posthog.com";

let initialized = false;

const SENSITIVE_KEY = /(authorization|token|secret|password|api[-_]?key|cookie)/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

export function initPostHog(): void {
  if (initialized) return;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  posthog.init(key, {
    api_host: POSTHOG_HOST,
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
  initialized = true;
}

export function identifyPostHogUser(sleeperUserId: string, sleeperUsername?: string): void {
  if (!initialized) return;
  posthog.identify(
    sleeperUserId,
    sleeperUsername ? { sleeper_username: sleeperUsername } : undefined,
  );
}

export function resetPostHog(): void {
  if (!initialized) return;
  posthog.reset();
}

export function captureClientError(err: unknown): void {
  if (!initialized) return;
  posthog.captureException(err);
}
