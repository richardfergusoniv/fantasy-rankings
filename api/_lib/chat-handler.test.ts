import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

vi.mock("./auth.js", () => ({
  resolveViewer: vi.fn(),
}));

vi.mock("./chat-agent.js", () => ({
  runChatAgent: vi.fn(),
}));

vi.mock("./chat-preferences.js", () => ({
  appendChatPreferences: vi.fn((_base: string, _prefs: unknown[]) => "system-with-prefs"),
  listChatPreferences: vi.fn(async () => []),
}));

vi.mock("./chat-store.js", () => ({
  ChatStoreError: class ChatStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  chatConversationOwned: vi.fn(),
  deleteChatConversation: vi.fn(),
  getChatConversation: vi.fn(),
  listChatConversations: vi.fn(),
  persistChatTurn: vi.fn(),
}));

import { resolveViewer } from "./auth.js";
import { runChatAgent } from "./chat-agent.js";
import { listChatPreferences } from "./chat-preferences.js";
import { resetChatRateLimits } from "./chat-rate-limit.js";
import {
  chatConversationOwned,
  deleteChatConversation,
  getChatConversation,
  listChatConversations,
  persistChatTurn,
} from "./chat-store.js";
import { DELETE, GET, POST } from "../chat.js";

const resolveViewerMock = vi.mocked(resolveViewer);
const runChatAgentMock = vi.mocked(runChatAgent);
const listPrefsMock = vi.mocked(listChatPreferences);
const listChatsMock = vi.mocked(listChatConversations);
const getChatMock = vi.mocked(getChatConversation);
const ownedMock = vi.mocked(chatConversationOwned);
const persistMock = vi.mocked(persistChatTurn);
const deleteMock = vi.mocked(deleteChatConversation);

function authReq(method: string, body?: unknown, url = "https://example.com/api/chat"): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("api/chat handler", () => {
  beforeEach(() => {
    resetChatRateLimits();
    resolveViewerMock.mockReset();
    runChatAgentMock.mockReset();
    listPrefsMock.mockReset();
    listChatsMock.mockReset();
    getChatMock.mockReset();
    ownedMock.mockReset();
    persistMock.mockReset();
    deleteMock.mockReset();
    listPrefsMock.mockResolvedValue([]);
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  it("GET requires auth and reports availability from the API key", async () => {
    resolveViewerMock.mockResolvedValue(null);
    const denied = await GET(authReq("GET"));
    expect(denied.status).toBe(401);

    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const unavailable = await GET(authReq("GET"));
    expect(unavailable.status).toBe(200);
    expect(await unavailable.json()).toEqual({ available: false });

    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const available = await GET(authReq("GET"));
    expect(await available.json()).toEqual({ available: true });
  });

  it("GET ?chats=1 returns titles only", async () => {
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    listChatsMock.mockResolvedValue([
      { id: "c1", title: "Who is my WR1?", updatedAt: "2026-10-24T00:00:00.000Z" },
    ]);
    const res = await GET(authReq("GET", undefined, "https://example.com/api/chat?chats=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      chats: [{ id: "c1", title: "Who is my WR1?", updatedAt: "2026-10-24T00:00:00.000Z" }],
    });
    expect(getChatMock).not.toHaveBeenCalled();
  });

  it("GET ?id= loads one conversation with messages", async () => {
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    getChatMock.mockResolvedValue({
      id: "c1",
      title: "Who is my WR1?",
      updatedAt: "2026-10-24T00:00:00.000Z",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Who is my WR1?",
          createdAt: "2026-10-24T00:00:00.000Z",
        },
      ],
    });
    const res = await GET(authReq("GET", undefined, "https://example.com/api/chat?id=c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, chat: { id: "c1" } });
  });

  it("POST returns 503 when the OpenRouter key is missing", async () => {
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const res = await POST(authReq("POST", { message: "Who is my WR1?" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "chat_unavailable" });
    expect(runChatAgentMock).not.toHaveBeenCalled();
  });

  it("POST runs the agent, persists, and returns chatId", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    runChatAgentMock.mockResolvedValue({
      reply: "Your WR1 projects 18.20.",
      model: "thinkingmachines/inkling:free",
      toolSteps: 1,
    });
    persistMock.mockResolvedValue({ chatId: "c1", title: "Who is my WR1?" });

    const res = await POST(authReq("POST", { message: "Who is my WR1?" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      reply: "Your WR1 projects 18.20.",
      model: "thinkingmachines/inkling:free",
      toolSteps: 1,
      chatId: "c1",
      title: "Who is my WR1?",
    });
    expect(runChatAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-or-test",
        userMessage: "Who is my WR1?",
        systemPrompt: "system-with-prefs",
        scoringWindow: "week",
        ctx: expect.objectContaining({ userId: "u1", sleeperUserId: "s1", scoringWindow: "week" }),
      }),
    );
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        userMessage: "Who is my WR1?",
        assistantMessage: "Your WR1 projects 18.20.",
      }),
    );
  });

  it("POST rejects oversized input", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const res = await POST(authReq("POST", { message: "x".repeat(2_001) }));
    expect(res.status).toBe(400);
    expect(runChatAgentMock).not.toHaveBeenCalled();
  });

  it("POST maps OpenRouter 429/5xx to a retryable busy 503 without persisting", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const { OpenRouterError } = await import("./chat-openrouter.js");
    runChatAgentMock.mockRejectedValue(new OpenRouterError(429, "rate limited"));

    const res = await POST(authReq("POST", { message: "Hi" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "The chat model is busy. Try again shortly.",
      code: "chat_upstream_unavailable",
    });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("POST maps OpenRouter 403 to a non-retryable chat_upstream_denied and masks the log", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const { OpenRouterError } = await import("./chat-openrouter.js");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runChatAgentMock.mockRejectedValue(
      new OpenRouterError(
        403,
        JSON.stringify({ error: { message: "key sk-or-v1-secretkey123 denied" } }),
        "thinkingmachines/inkling:free",
      ),
    );

    const res = await POST(authReq("POST", { message: "Hi" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "The chat model refused this request.",
      code: "chat_upstream_denied",
    });
    expect(persistMock).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[chat POST] upstream",
      403,
      "thinkingmachines/inkling:free",
      expect.stringContaining("sk-or-***"),
    );
    expect(consoleSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("sk-or-v1-secretkey123")),
    )).toBe(false);
    consoleSpy.mockRestore();
  });

  it.each([
    [401, "OpenRouter rejected the chat API key. Check the key settings."],
    [402, "The OpenRouter account is out of credits or over its limit."],
    [404, "The chat model isn’t available on OpenRouter right now."],
  ])("POST maps OpenRouter %s to chat_upstream_denied with its own message", async (status, message) => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const { OpenRouterError } = await import("./chat-openrouter.js");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runChatAgentMock.mockRejectedValue(new OpenRouterError(status, "nope", "thinkingmachines/inkling:free"));

    const res = await POST(authReq("POST", { message: "Hi" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: message, code: "chat_upstream_denied" });
    consoleSpy.mockRestore();
  });

  it("DELETE removes a conversation for the viewer", async () => {
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    deleteMock.mockResolvedValue(true);
    const res = await DELETE(authReq("DELETE", undefined, "https://example.com/api/chat?id=c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(deleteMock).toHaveBeenCalledWith("u1", "c1");
  });
});
