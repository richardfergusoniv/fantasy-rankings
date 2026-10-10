-- Shared, user-agnostic player news (one row per source URL / post id).
-- Hand-apply like 0002–0004. Not a drizzle-kit journal entry yet.
-- See PR C / MIGRATION-STATUS.md. Do not run db:migrate against production blindly.

CREATE TABLE IF NOT EXISTS "shared_player_news" (
  "id" text PRIMARY KEY NOT NULL,
  "player_id" text NOT NULL,
  "player" text NOT NULL,
  "team" text NOT NULL,
  "change" text NOT NULL,
  "news_type" text DEFAULT 'roster' NOT NULL,
  "role_context" text DEFAULT '' NOT NULL,
  "source" text NOT NULL,
  "source_label" text NOT NULL,
  "source_url" text NOT NULL,
  "author" text,
  "external_id" text,
  "published_at" timestamp with time zone,
  "signal" text,
  "score" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shared_player_news_news_type_check"
    CHECK ("news_type" IN ('roster', 'waiver', 'headline')),
  CONSTRAINT "shared_player_news_source_check"
    CHECK ("source" IN ('sleeper', 'x', 'nflverse'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "shared_player_news_source_url_uidx"
  ON "shared_player_news" ("source_url");

-- Dedupes X post_id (and other external ids). Multiple NULLs are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "shared_player_news_source_external_uidx"
  ON "shared_player_news" ("source", "external_id");

CREATE INDEX IF NOT EXISTS "shared_player_news_player_id_idx"
  ON "shared_player_news" ("player_id");

CREATE INDEX IF NOT EXISTS "shared_player_news_published_at_idx"
  ON "shared_player_news" ("published_at");
