import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared utilities for Vercel API routes.
 *
 * Conventions:
 * - All handlers use the Web API format: `export default async function handler(req: Request): Promise<Response>`
 * - Validate input with zod `safeParse`; return 400 on failure
 * - Return consistent JSON: `{ ok: true, ... }` or `{ ok: false, error: "..." }`
 * - DB via `import { db } from "./db.js"` (relative to api/ dir)
 */

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function json(
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
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

export function payloadTooLarge(): Response {
  return json({ ok: false, error: "Request body too large" }, 413);
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

export const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Read and parse a JSON request body with a byte cap independent of schema
 * validation. Throws BodyTooLargeError when the body exceeds maxBytes;
 * propagates JSON parse errors like `req.json()` would.
 */
export async function readJsonBody(req: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  return text ? JSON.parse(text) : null;
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
  const message = err instanceof Error ? err.message : "Internal server error";
  const cause = err instanceof Error && err.cause != null ? err.cause : undefined;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === "object" && "message" in cause && typeof (cause as { message: unknown }).message === "string"
        ? (cause as { message: string }).message
        : cause != null
          ? String(cause)
          : undefined;
  console.error(
    "[api]",
    message,
    causeMessage ? `cause=${causeMessage}` : "",
    err instanceof Error ? err.stack : err,
    cause && !(cause instanceof Error) ? cause : "",
  );
  return json({ ok: false, error: "Internal server error" }, 500);
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
 * Supabase project URL and anon key.
 *
 * Canonical names are SUPABASE_URL and SUPABASE_ANON_KEY. VITE_ (the names
 * the browser build reads) and NEXT_PUBLIC_ are fallbacks so an existing
 * deploy keeps working.
 */
export function readSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Get the Supabase user from the request's Authorization header (Bearer JWT).
 * Returns null when no valid session is present. Used by auth-required routes.
 */
export async function getRequestUser(req: Request): Promise<{ id: string } | null> {
  const supabaseEnv = readSupabasePublicEnv();
  if (!supabaseEnv) return null;
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = supabaseEnv;

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
