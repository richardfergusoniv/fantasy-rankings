-- Deployment-wide build leases + shared rate-limit buckets (audit finding #9).
-- Journal entry 0011 (`npm run db:migrate` applies it on a fresh database;
-- production is still hand-applied — see MIGRATION-STATUS.md). Both tables
-- are service-role only: RLS enabled, no policies (the API connects with the
-- service role, which bypasses RLS).

CREATE TABLE IF NOT EXISTS "build_leases" (
  "resource" text PRIMARY KEY NOT NULL,
  "holder" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('running', 'done', 'failed')),
  "last_error" text,
  "acquired_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
ALTER TABLE "build_leases" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "subject" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer NOT NULL,
  PRIMARY KEY ("subject", "window_start")
);

--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
