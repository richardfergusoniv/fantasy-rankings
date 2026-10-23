/**
 * In-memory per-user rate limit for chat questions.
 * Resets when the serverless isolate recycles; good enough as a basic abuse guard.
 */

import { CHAT_RATE_LIMIT_MAX, CHAT_RATE_LIMIT_WINDOW_MS } from "./chat-config.js";

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

export function checkChatRateLimit(
  userId: string,
  now = Date.now(),
  max = CHAT_RATE_LIMIT_MAX,
  windowMs = CHAT_RATE_LIMIT_WINDOW_MS,
): RateLimitResult {
  const bucket = buckets.get(userId) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  const recent = bucket.timestamps.filter((ts) => ts > cutoff);
  if (recent.length >= max) {
    const oldest = recent[0] ?? now;
    buckets.set(userId, { timestamps: recent });
    return { ok: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }
  recent.push(now);
  buckets.set(userId, { timestamps: recent });
  return { ok: true, remaining: max - recent.length };
}

/** Test helper: clear all buckets. */
export function resetChatRateLimits(): void {
  buckets.clear();
}
