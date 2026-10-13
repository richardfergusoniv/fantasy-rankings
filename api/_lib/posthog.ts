import { PostHog } from "posthog-node";

/**
 * PostHog error capture for API routes (server side).
 *
 * No-ops when POSTHOG_KEY is not set. Callers pass only non-sensitive
 * context (route names, job names, resource ids) — request headers and
 * bodies are never forwarded, so the CRON_SECRET bearer cannot leak
 * into a third-party log through this path. Telemetry failures are
 * swallowed: this helper must never break the route that called it.
 */

let client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.POSTHOG_KEY;
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host: "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

export async function captureServerError(
  err: unknown,
  context: Record<string, string>,
): Promise<void> {
  try {
    const ph = getClient();
    if (!ph) return;
    ph.captureException(err, "server", { ...context });
    await ph.flush();
  } catch {
    // Telemetry must never take down the route.
  }
}
