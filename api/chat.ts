/**
 * Tools → Chat API (no extra Vercel functions).
 * GET  /api/chat              — { available }
 * GET  /api/chat?chats=1      — conversation list (titles only)
 * GET  /api/chat?id=<id>      — one conversation + messages
 * POST /api/chat              — send a turn (optional chatId); persists on success
 * DELETE /api/chat?id=<id>    — delete a conversation
 */
import { z } from "zod";
import {
  badRequest,
  internalError,
  json,
  methodNotAllowed,
  unauthorized,
} from "./_lib/api-utils.js";
import { resolveViewer } from "./_lib/auth.js";
import { runChatAgent } from "./_lib/chat-agent.js";
import {
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_INPUT_CHARS,
  CHAT_SYSTEM_PROMPT,
  readOpenRouterApiKey,
} from "./_lib/chat-config.js";
import { ChatAgentTimeoutError, OpenRouterError } from "./_lib/chat-openrouter.js";
import {
  appendChatPreferences,
  listChatPreferences,
} from "./_lib/chat-preferences.js";
import { checkChatRateLimit } from "./_lib/chat-rate-limit.js";
import {
  chatConversationOwned,
  ChatStoreError,
  deleteChatConversation,
  getChatConversation,
  listChatConversations,
  persistChatTurn,
} from "./_lib/chat-store.js";

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(CHAT_MAX_INPUT_CHARS),
});

const postBodySchema = z.object({
  message: z.string().min(1).max(CHAT_MAX_INPUT_CHARS),
  history: z.array(historyMessageSchema).max(CHAT_MAX_HISTORY_MESSAGES).optional().default([]),
  chatId: z.string().trim().min(1).max(80).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) return unauthorized("Sign in required.");

    const url = new URL(req.url);
    const chatId = url.searchParams.get("id")?.trim() ?? "";
    if (chatId) {
      const chat = await getChatConversation(viewer.userId, chatId);
      if (!chat) return json({ ok: false, error: "Chat not found.", code: "chat_not_found" }, 404);
      return json({ ok: true, chat });
    }
    if (url.searchParams.get("chats") === "1") {
      const chats = await listChatConversations(viewer.userId);
      return json({ ok: true, chats });
    }

    const available = Boolean(readOpenRouterApiKey());
    return json({ available });
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) return unauthorized("Sign in required.");

    const apiKey = readOpenRouterApiKey();
    if (!apiKey) {
      return json(
        { ok: false, error: "Chat unavailable", code: "chat_unavailable" },
        503,
      );
    }

    const rate = checkChatRateLimit(viewer.userId);
    if (!rate.ok) {
      return json(
        {
          ok: false,
          error: "Rate limit exceeded. Try again in a few minutes.",
          code: "rate_limited",
          retryAfterMs: rate.retryAfterMs,
        },
        429,
        { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000) || 1) },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = postBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid chat payload.", parsed.error.issues);
    }

    if (parsed.data.chatId) {
      const owned = await chatConversationOwned(viewer.userId, parsed.data.chatId);
      if (!owned) {
        return json({ ok: false, error: "Chat not found.", code: "chat_not_found" }, 404);
      }
    }

    const preferences = await listChatPreferences(viewer.userId);
    const systemPrompt = appendChatPreferences(CHAT_SYSTEM_PROMPT, preferences);
    const history = parsed.data.history.slice(-CHAT_MAX_HISTORY_MESSAGES);

    const result = await runChatAgent({
      apiKey,
      userMessage: parsed.data.message.trim(),
      history,
      systemPrompt,
      ctx: { userId: viewer.userId, sleeperUserId: viewer.sleeperUserId },
    });

    let saved: { chatId: string; title: string };
    try {
      saved = await persistChatTurn({
        userId: viewer.userId,
        conversationId: parsed.data.chatId,
        userMessage: parsed.data.message.trim(),
        assistantMessage: result.reply,
      });
    } catch (err) {
      if (err instanceof ChatStoreError && err.code === "chat_not_found") {
        return json({ ok: false, error: "Chat not found.", code: "chat_not_found" }, 404);
      }
      throw err;
    }

    return json({
      ok: true,
      reply: result.reply,
      model: result.model,
      toolSteps: result.toolSteps,
      chatId: saved.chatId,
      title: saved.title,
    });
  } catch (err) {
    if (err instanceof OpenRouterError || err instanceof ChatAgentTimeoutError) {
      console.error("[chat POST] upstream", err instanceof OpenRouterError ? err.status : "timeout");
      return json(
        {
          ok: false,
          error: "The chat model is busy. Try again shortly.",
          code: "chat_upstream_unavailable",
        },
        503,
      );
    }
    console.error("[chat POST]", err instanceof Error ? err.message : err);
    return internalError(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) return unauthorized("Sign in required.");

    const url = new URL(req.url);
    const chatId = url.searchParams.get("id")?.trim() ?? "";
    if (!chatId) return badRequest("Missing chat id.");

    const deleted = await deleteChatConversation(viewer.userId, chatId);
    return json({ ok: true, deleted });
  } catch (err) {
    return internalError(err);
  }
}

export async function PUT(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["GET", "POST", "DELETE"]);
}
