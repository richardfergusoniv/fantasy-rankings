/**
 * Shared per-user rate limit for chat questions.
 *
 * Backed by the `rate_limit_buckets` table so the quota holds across
 * serverless instances (audit finding #9): each request atomically
 * increments the current fixed-window counter, so concurrent requests on
 * different instances all count against the same budget. The in-memory
 * bucket below is a fallback for when the database is unavailable — a
 * rate limiter must never take the chat route down.
 */

import { sql } from "drizzle-orm";
import { db } from "./db.js";
import { withDeadline } from "./sleeper.js";
import { CHAT_RATE_LIMIT_MAX, CHAT_RATE_LIMIT_WINDOW_MS } from "./chat-config.js";

// Fixed windows aligned with the shared DB bucket, so the fallback never
// rejects a request the database window would accept (or vice versa).
type Bucket = { windowStartMs: number; count: number };

const localBuckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

function checkLocalRateLimit(
  userId: string,
  now: number,
  max: number,
  windowMs: number,
): RateLimitResult {
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const existing = localBuckets.get(userId);
  const count = existing?.windowStartMs === windowStartMs ? existing.count : 0;
  if (count >= max) {
    return { ok: false, retryAfterMs: Math.max(0, windowStartMs + windowMs - now) };
  }
  localBuckets.set(userId, { windowStartMs, count: count + 1 });
  return { ok: true, remaining: max - count - 1 };
}

/** Atomically increment the subject's window bucket; returns the new count. */
export async function incrementRateLimitBucket(
  subject: string,
  windowStartMs: number,
): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO rate_limit_buckets (subject, window_start, count)
    VALUES (${subject}, to_timestamp(${windowStartMs} / 1000.0), 1)
    ON CONFLICT (subject, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count
  `)) as unknown as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 1);
}

/** Bound the shared-counter call so a stalled DB cannot delay chat turns. */
const RATE_LIMIT_DB_TIMEOUT_MS = 2_000;

export async function checkChatRateLimit(
  userId: string,
  now = Date.now(),
  max = CHAT_RATE_LIMIT_MAX,
  windowMs = CHAT_RATE_LIMIT_WINDOW_MS,
): Promise<RateLimitResult> {
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  try {
    const bucketPromise = incrementRateLimitBucket(`chat:${userId}`, windowStartMs);
    // If the deadline wins, the late settlement must not be an unhandled rejection.
    bucketPromise.catch(() => undefined);
    const count = await withDeadline(bucketPromise, RATE_LIMIT_DB_TIMEOUT_MS);
    // Mirror the request locally so a later DB failure falls back to the
    // quota already used on this instance, not a fresh allowance.
    checkLocalRateLimit(userId, now, max, windowMs);
    if (count > max) {
      return { ok: false, retryAfterMs: Math.max(0, windowStartMs + windowMs - now) };
    }
    return { ok: true, remaining: max - count };
  } catch (error) {
    console.error(
      "[chat-rate-limit] shared quota unavailable, using in-memory fallback",
      error instanceof Error ? error.message : error,
    );
    return checkLocalRateLimit(userId, now, max, windowMs);
  }
}

/** Delete buckets whose window closed more than `retainMs` ago. */
export async function pruneRateLimitBuckets(retainMs = 24 * 60 * 60 * 1000): Promise<number> {
  const result = (await db.execute(sql`
    DELETE FROM rate_limit_buckets
    WHERE window_start < now() - (${retainMs} || ' milliseconds')::interval
  `)) as unknown as { count?: number };
  return Number(result.count ?? 0);
}

/** Test helper: clear all in-memory fallback buckets. */
export function resetChatRateLimits(): void {
  localBuckets.clear();
}
