-- Tighten chat_messages RLS so rows must belong to a conversation owned by
-- auth.uid() (not only matching chat_messages.user_id). Hand-apply like 0002–0009.
-- Does not alter table or column definitions from 0009.

DROP POLICY IF EXISTS "Users manage own chat messages" ON "chat_messages";

CREATE POLICY "Users manage own chat messages" ON "chat_messages"
  FOR ALL
  USING (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM "chat_conversations" AS conversation
      WHERE conversation.id = conversation_id
        AND conversation.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM "chat_conversations" AS conversation
      WHERE conversation.id = conversation_id
        AND conversation.user_id = (select auth.uid())
    )
  );
