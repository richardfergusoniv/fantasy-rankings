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

  it("answers every tool_call when the step budget is exhausted mid-message", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; tool_call_id?: string; content?: string | null }>;
      };
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "get_my_leagues", arguments: "{}" } },
                  { id: "c2", type: "function", function: { name: "get_my_leagues", arguments: "{}" } },
                  { id: "c3", type: "function", function: { name: "get_my_leagues", arguments: "{}" } },
                ],
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const toolMsgs = body.messages.filter((item) => item.role === "tool");
      expect(toolMsgs).toHaveLength(3);
      expect(toolMsgs.map((item) => item.tool_call_id)).toEqual(["c1", "c2", "c3"]);
      expect(toolMsgs[2]?.content).toContain("Tool step limit reached");
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Partial answer." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const dispatchTool = vi.fn(async () => ({ ok: true }));
    const result = await runChatAgent({
      apiKey: "sk-or-test",
      userMessage: "Tell me everything",
      ctx: { userId: "u1", sleeperUserId: "s1" },
      fetchImpl,
      dispatchTool,
      maxToolSteps: 2,
    });

    expect(dispatchTool).toHaveBeenCalledTimes(2);
    expect(result.toolSteps).toBe(2);
    expect(result.reply).toBe("Partial answer.");
  });

  it("turns tool dispatch failures into tool results", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content?: string | null }>;
      };
      const last = body.messages[body.messages.length - 1];
      if (last?.role === "tool") {
        expect(String(last.content)).toContain("Tool failed");
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Data is temporarily unavailable." } }],
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
                function: { name: "get_trade_history", arguments: "{\"leagueId\":\"lg1\"}" },
              }],
            },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await runChatAgent({
      apiKey: "sk-or-test",
      userMessage: "Recent trades?",
      ctx: { userId: "u1", sleeperUserId: "s1" },
      fetchImpl,
      dispatchTool: async () => {
        throw new Error("db down");
      },
    });

    expect(result.reply).toBe("Data is temporarily unavailable.");
  });
});
