/**
 * POST /api/chat — authenticated fantasy chat agent (OpenRouter free models).
 * GET  /api/chat — availability probe ({ available }) for the Tools → Chat UI.
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
  readOpenRouterApiKey,
} from "./_lib/chat-config.js";
import { ChatAgentTimeoutError, OpenRouterError } from "./_lib/chat-openrouter.js";
import { checkChatRateLimit } from "./_lib/chat-rate-limit.js";

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(CHAT_MAX_INPUT_CHARS),
});

const postBodySchema = z.object({
  message: z.string().min(1).max(CHAT_MAX_INPUT_CHARS),
  history: z.array(historyMessageSchema).max(CHAT_MAX_HISTORY_MESSAGES).optional().default([]),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer) return unauthorized("Sign in required.");
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

    const result = await runChatAgent({
      apiKey,
      userMessage: parsed.data.message.trim(),
      history: parsed.data.history,
      ctx: { userId: viewer.userId, sleeperUserId: viewer.sleeperUserId },
    });

    return json({
      ok: true,
      reply: result.reply,
      model: result.model,
      toolSteps: result.toolSteps,
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
  void req;
  return methodNotAllowed(["GET", "POST"]);
}
