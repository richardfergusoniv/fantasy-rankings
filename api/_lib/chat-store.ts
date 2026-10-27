/**
 * Persist Tools Chat conversations and messages (user-scoped).
 * List queries return titles only; messages load when a chat is opened.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_INPUT_CHARS } from "./chat-config.js";
import { db, schema } from "./db.js";

export const CHAT_TITLE_MAX_CHARS = 72;
export const CHAT_LIST_LIMIT = 40;

export type ChatListItem = {
  id: string;
  title: string;
  updatedAt: string;
};

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type StoredChat = {
  id: string;
  title: string;
  updatedAt: string;
  messages: StoredChatMessage[];
};

export function titleFromFirstMessage(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Chat";
  if (cleaned.length <= CHAT_TITLE_MAX_CHARS) return cleaned;
  return `${cleaned.slice(0, CHAT_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

export async function listChatConversations(userId: string): Promise<ChatListItem[]> {
  const rows = await db
    .select({
      id: schema.chatConversations.id,
      title: schema.chatConversations.title,
      updatedAt: schema.chatConversations.updatedAt,
    })
    .from(schema.chatConversations)
    .where(eq(schema.chatConversations.userId, userId))
    .orderBy(desc(schema.chatConversations.updatedAt))
    .limit(CHAT_LIST_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Ownership check without loading messages (keeps egress low on send). */
export async function chatConversationOwned(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.chatConversations.id })
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getChatConversation(
  userId: string,
  conversationId: string,
): Promise<StoredChat | null> {
  const [conversation] = await db
    .select({
      id: schema.chatConversations.id,
      title: schema.chatConversations.title,
      updatedAt: schema.chatConversations.updatedAt,
    })
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.userId, userId),
      ),
    )
    .limit(1);
  if (!conversation) return null;

  const messages = await db
    .select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      createdAt: schema.chatMessages.createdAt,
    })
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.conversationId, conversationId),
        eq(schema.chatMessages.userId, userId),
      ),
    )
    .orderBy(asc(schema.chatMessages.createdAt));

  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
    messages: messages.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * Newest N transcript turns for an owned chat, returned oldest→newest.
 * Used on send so long conversations do not load the full message table.
 * Returns null when the conversation is missing or not owned.
 */
export async function getChatRecentMessages(
  userId: string,
  conversationId: string,
  limit: number = CHAT_MAX_HISTORY_MESSAGES,
): Promise<Array<{ role: "user" | "assistant"; content: string }> | null> {
  const owned = await chatConversationOwned(userId, conversationId);
  if (!owned) return null;

  const take = Math.max(0, Math.floor(limit));
  if (take === 0) return [];

  const newestFirst = await db
    .select({
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
    })
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.conversationId, conversationId),
        eq(schema.chatMessages.userId, userId),
      ),
    )
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(take);

  return newestFirst
    .reverse()
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, CHAT_MAX_INPUT_CHARS),
    }));
}

export async function deleteChatConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const rowFilter = and(
    eq(schema.chatConversations.id, conversationId),
    eq(schema.chatConversations.userId, userId),
  );
  const rows = await db
    .select({ id: schema.chatConversations.id })
    .from(schema.chatConversations)
    .where(rowFilter)
    .limit(1);
  if (!rows[0]) return false;
  await db.delete(schema.chatConversations).where(rowFilter);
  return true;
}

export async function persistChatTurn(args: {
  userId: string;
  conversationId?: string | null;
  userMessage: string;
  assistantMessage: string;
}): Promise<{ chatId: string; title: string }> {
  const userContent = args.userMessage.trim().slice(0, CHAT_MAX_INPUT_CHARS);
  const assistantContent = args.assistantMessage.trim();
  const now = new Date();

  return db.transaction(async (tx) => {
    if (args.conversationId) {
      const [existing] = await tx
        .select({
          id: schema.chatConversations.id,
          title: schema.chatConversations.title,
        })
        .from(schema.chatConversations)
        .where(
          and(
            eq(schema.chatConversations.id, args.conversationId),
            eq(schema.chatConversations.userId, args.userId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new ChatStoreError("Chat not found.", "chat_not_found");
      }
      await tx.insert(schema.chatMessages).values([
        {
          id: crypto.randomUUID(),
          conversationId: existing.id,
          userId: args.userId,
          role: "user",
          content: userContent,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          conversationId: existing.id,
          userId: args.userId,
          role: "assistant",
          content: assistantContent,
          createdAt: new Date(now.getTime() + 1),
        },
      ]);
      await tx
        .update(schema.chatConversations)
        .set({ updatedAt: now })
        .where(
          and(
            eq(schema.chatConversations.id, existing.id),
            eq(schema.chatConversations.userId, args.userId),
          ),
        );
      return { chatId: existing.id, title: existing.title };
    }

    const chatId = crypto.randomUUID();
    const title = titleFromFirstMessage(userContent);
    await tx.insert(schema.chatConversations).values({
      id: chatId,
      userId: args.userId,
      title,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.chatMessages).values([
      {
        id: crypto.randomUUID(),
        conversationId: chatId,
        userId: args.userId,
        role: "user",
        content: userContent,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        conversationId: chatId,
        userId: args.userId,
        role: "assistant",
        content: assistantContent,
        createdAt: new Date(now.getTime() + 1),
      },
    ]);
    return { chatId, title };
  });
}

export class ChatStoreError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ChatStoreError";
    this.code = code;
  }
}
