import { describe, expect, it, vi } from "vitest";
import { runChatAgent } from "./chat-agent.js";
import { DEFAULT_OPENROUTER_MODEL, FALLBACK_OPENROUTER_MODEL } from "./chat-config.js";
import { OpenRouterError } from "./chat-openrouter.js";

describe("runChatAgent", () => {
  it("runs a tool-calling loop with OpenRouter mocked", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string }>;
      };
      const last = body.messages[body.messages.length - 1];
      if (last?.role === "tool") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "You are in 1 league." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "get_my_leagues", arguments: "{}" },
              }],
            },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const dispatchTool = vi.fn(async () => ({ ok: true, leagues: [{ leagueId: "lg1" }] }));
    const result = await runChatAgent({
      apiKey: "sk-or-test",
      userMessage: "What leagues am I in?",
      ctx: { userId: "u1", sleeperUserId: "s1" },
      fetchImpl,
      dispatchTool,
    });

    expect(dispatchTool).toHaveBeenCalledWith("get_my_leagues", {}, expect.any(Object));
    expect(result.reply).toBe("You are in 1 league.");
    expect(result.toolSteps).toBe(1);
    expect(result.model).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it("falls back to the free backup model on 429", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { model: string };
      if (calls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      expect(body.model).toBe(FALLBACK_OPENROUTER_MODEL);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Fallback answer." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await runChatAgent({
      apiKey: "sk-or-test",
      userMessage: "Hi",
      ctx: { userId: "u1", sleeperUserId: "s1" },
      fetchImpl,
    });

    expect(result.reply).toBe("Fallback answer.");
    expect(result.model).toBe(FALLBACK_OPENROUTER_MODEL);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses a paid primary model before networking", async () => {
    await expect(
      runChatAgent({
        apiKey: "sk-or-test",
        userMessage: "Hi",
        ctx: { userId: "u1", sleeperUserId: "s1" },
        primaryModel: "openai/gpt-4o",
        fetchImpl: async () => {
          throw new OpenRouterError(500, "should not reach network");
        },
      }),
    ).rejects.toThrow(/Refusing non-free/);
  });
});
