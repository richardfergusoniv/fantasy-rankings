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
import { CHAT_RATE_LIMIT_MAX, CHAT_RATE_LIMIT_WINDOW_MS } from "./chat-config.js";

type Bucket = { timestamps: number[] };

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
  const bucket = localBuckets.get(userId) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  const recent = bucket.timestamps.filter((ts) => ts > cutoff);
  if (recent.length >= max) {
    const oldest = recent[0] ?? now;
    localBuckets.set(userId, { timestamps: recent });
    return { ok: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }
  recent.push(now);
  localBuckets.set(userId, { timestamps: recent });
  return { ok: true, remaining: max - recent.length };
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

export async function checkChatRateLimit(
  userId: string,
  now = Date.now(),
  max = CHAT_RATE_LIMIT_MAX,
  windowMs = CHAT_RATE_LIMIT_WINDOW_MS,
): Promise<RateLimitResult> {
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  try {
    const count = await incrementRateLimitBucket(`chat:${userId}`, windowStartMs);
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

/** Test helper: clear all in-memory fallback buckets. */
export function resetChatRateLimits(): void {
  localBuckets.clear();
}
