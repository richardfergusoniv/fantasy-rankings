import { createClient, type Session } from "@supabase/supabase-js";

/**
 * Browser Supabase client for Fantasy Rankings (Phase 2 auth).
 *
 * Uses the public anon key — safe to expose; Row Level Security in the
 * database is what actually protects per-user data. The URL and anon key
 * come from Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
 * set in the Vercel project settings.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

export type { Session };

/** Current session's access token, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
