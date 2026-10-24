-- Persistent Tools Chat: conversations, messages, and standing preferences.
-- Originally hand-applied like 0002–0007; now journal entry 0009. See MIGRATION-STATUS.md.
-- RLS on; owner policies use (select auth.uid()). API still scopes by user_id
-- via the service role, which bypasses RLS.

CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "title" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_conversations_user_updated_idx"
  ON "chat_conversations" ("user_id", "updated_at" DESC);

--> statement-breakpoint
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_conversations'
      AND policyname = 'Users manage own chat conversations'
  ) THEN
    CREATE POLICY "Users manage own chat conversations" ON "chat_conversations"
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_created_idx"
  ON "chat_messages" ("conversation_id", "created_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_user_id_idx"
  ON "chat_messages" ("user_id");

--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'Users manage own chat messages'
  ) THEN
    CREATE POLICY "Users manage own chat messages" ON "chat_messages"
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_preferences" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "league_id" text,
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_preferences_user_id_idx"
  ON "chat_preferences" ("user_id");

--> statement-breakpoint
ALTER TABLE "chat_preferences" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_preferences'
      AND policyname = 'Users manage own chat preferences'
  ) THEN
    CREATE POLICY "Users manage own chat preferences" ON "chat_preferences"
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
