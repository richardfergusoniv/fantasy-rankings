import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Shared Drizzle client for Supabase Postgres.
 *
 * Uses postgres-js with `prepare: false` because Supabase's connection
 * pooler runs in transaction mode (prepared statements are not supported).
 *
 * Required env var: DATABASE_URL (Supabase Postgres connection string,
 * use the pooler URL on port 6543 for serverless functions).
 *
 * Usage:
 *   import { db } from "@/lib/db";
 *   const rows = await db.select().from(schema.sourceCache);
 */

// Lazy singleton so importing this module never opens a connection at
// import time (important for Vercel cold starts and build-time evaluation).
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase Postgres connection string to the environment.",
    );
  }
  return url;
}

export function getDb() {
  if (!_db) {
    const client = postgres(getConnectionString(), {
      prepare: false,
      // Keep the pool small for serverless; each function instance
      // gets its own pool.
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

/** Eager singleton for handlers that run after env is guaranteed. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
