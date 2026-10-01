import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared utilities for Vercel API routes.
 *
 * Conventions:
 * - All handlers use the Web API format: `export default async function handler(req: Request): Promise<Response>`
 * - Validate input with zod `safeParse`; return 400 on failure
 * - Return consistent JSON: `{ ok: true, ... }` or `{ ok: false, error: "..." }`
 * - DB via `import { db } from "./db"` (relative to api/ dir)
 */

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function badRequest(message: string, issues?: unknown): Response {
  return json({ ok: false, error: message, issues }, 400);
}

export function unauthorized(message = "Unauthorized"): Response {
  return json({ ok: false, error: message }, 401);
}

export function forbidden(message = "Forbidden"): Response {
  return json({ ok: false, error: message }, 403);
}

export function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ ok: false, error: `Method not allowed. Use ${allowed.join(", ")}.` }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      Allow: allowed.join(", "),
    },
  });
}

export function internalError(err: unknown): Response {
  // Never leak stack traces to the client in production
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[api]", message, err instanceof Error ? err.stack : err);
  return json({ ok: false, error: message }, 500);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Check the request carries a valid cron/webhook secret.
 * Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
 * The props pipeline sends the same header on ingest webhooks.
 */
export function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

/**
 * Check whether a Supabase user ID is in the admin allowlist.
 * Replaces `ctx.viewer.isOwner` from the Hatch actions.
 */
export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const allowlist = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowlist.includes(userId);
}

/**
 * Get the Supabase user from the request's Authorization header (Bearer JWT).
 * Returns null when no valid session is present. Used by auth-required routes.
 */
export async function getRequestUser(req: Request): Promise<{ id: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// ---------------------------------------------------------------------------
// Query param helpers
// ---------------------------------------------------------------------------

/** Parse a boolean query param ("true"/"1" → true). */
export function queryBool(url: URL, key: string, defaultValue = false): boolean {
  const raw = url.searchParams.get(key);
  if (raw === null) return defaultValue;
  return raw === "true" || raw === "1";
}

/** Parse an integer query param. Returns undefined when missing/invalid. */
export function queryInt(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}
