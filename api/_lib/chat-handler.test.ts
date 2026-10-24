import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

vi.mock("./auth.js", () => ({
  resolveViewer: vi.fn(),
}));

vi.mock("./chat-agent.js", () => ({
  runChatAgent: vi.fn(),
}));

import { resolveViewer } from "./auth.js";
import { runChatAgent } from "./chat-agent.js";
import { resetChatRateLimits } from "./chat-rate-limit.js";
import { GET, POST } from "../chat.js";

const resolveViewerMock = vi.mocked(resolveViewer);
const runChatAgentMock = vi.mocked(runChatAgent);

function authReq(method: string, body?: unknown): Request {
  return new Request("https://example.com/api/chat", {
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

  it("POST returns 503 when the OpenRouter key is missing", async () => {
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const res = await POST(authReq("POST", { message: "Who is my WR1?" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "chat_unavailable" });
    expect(runChatAgentMock).not.toHaveBeenCalled();
  });

  it("POST runs the agent with OpenRouter mocked via runChatAgent", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    runChatAgentMock.mockResolvedValue({
      reply: "Your WR1 projects 18.20.",
      model: "thinkingmachines/inkling:free",
      toolSteps: 1,
    });

    const res = await POST(authReq("POST", { message: "Who is my WR1?" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      reply: "Your WR1 projects 18.20.",
      model: "thinkingmachines/inkling:free",
      toolSteps: 1,
    });
    expect(runChatAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-or-test",
        userMessage: "Who is my WR1?",
        scoringWindow: "week",
        ctx: expect.objectContaining({ userId: "u1", sleeperUserId: "s1", scoringWindow: "week" }),
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

  it("POST maps OpenRouter failures to a retryable 503", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resolveViewerMock.mockResolvedValue({ userId: "u1", sleeperUserId: "s1" });
    const { OpenRouterError } = await import("./chat-openrouter.js");
    runChatAgentMock.mockRejectedValue(new OpenRouterError(429, "rate limited"));

    const res = await POST(authReq("POST", { message: "Hi" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      code: "chat_upstream_unavailable",
    });
  });
});
