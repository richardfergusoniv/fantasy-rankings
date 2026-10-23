import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_TOOL_STEPS,
  DEFAULT_OPENROUTER_MODEL,
  FALLBACK_OPENROUTER_MODEL,
  isFreeOpenRouterModel,
  resolveOpenRouterFallbackModel,
  resolveOpenRouterModel,
} from "./chat-config.js";
import { callOpenRouterChat, ChatAgentTimeoutError } from "./chat-openrouter.js";

describe("chat-config free models", () => {
  it("allows up to eight tool steps under the 60s deadline", () => {
    expect(CHAT_MAX_TOOL_STEPS).toBe(8);
  });

  it("only accepts :free model ids", () => {
    expect(isFreeOpenRouterModel("thinkingmachines/inkling:free")).toBe(true);
    expect(isFreeOpenRouterModel("openai/gpt-4o")).toBe(false);
  });

  it("ignores non-free OPENROUTER_MODEL overrides", () => {
    expect(resolveOpenRouterModel("openai/gpt-4o")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveOpenRouterModel("thinkingmachines/inkling:free")).toBe("thinkingmachines/inkling:free");
    expect(resolveOpenRouterModel("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    );
    expect(resolveOpenRouterFallbackModel()).toBe(FALLBACK_OPENROUTER_MODEL);
    expect(FALLBACK_OPENROUTER_MODEL.endsWith(":free")).toBe(true);
  });

  it("refuses to call a paid model id", async () => {
    await expect(
      callOpenRouterChat({
        apiKey: "sk-or-test",
        body: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "hi" }],
        },
        fetchImpl: async () => new Response("nope", { status: 500 }),
      }),
    ).rejects.toThrow(/Refusing non-free/);
  });

  it("maps aborted response body reads to ChatAgentTimeoutError", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    await expect(
      callOpenRouterChat({
        apiKey: "sk-or-test",
        body: {
          model: "thinkingmachines/inkling:free",
          messages: [{ role: "user", content: "hi" }],
        },
        fetchImpl: async () =>
          ({
            ok: true,
            status: 200,
            text: async () => {
              throw abortErr;
            },
          }) as unknown as Response,
      }),
    ).rejects.toBeInstanceOf(ChatAgentTimeoutError);
  });
});
