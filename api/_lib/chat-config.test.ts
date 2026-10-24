import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_TOOL_STEPS,
  DEFAULT_OPENROUTER_MODEL,
  FALLBACK_OPENROUTER_MODEL,
  isFreeOpenRouterModel,
  resolveOpenRouterFallbackModel,
  resolveOpenRouterModel,
} from "./chat-config.js";
import {
  callOpenRouterChat,
  ChatAgentTimeoutError,
  maskOpenRouterLogText,
  shouldFallback,
} from "./chat-openrouter.js";

describe("chat-config free models", () => {
  it("allows up to eight tool steps under the 60s deadline", () => {
    expect(CHAT_MAX_TOOL_STEPS).toBe(8);
  });

  it("only accepts :free model ids", () => {
    expect(isFreeOpenRouterModel("thinkingmachines/inkling:free")).toBe(true);
    expect(isFreeOpenRouterModel("openai/gpt-4o")).toBe(false);
  });

  it("defaults to nemotron primary with inkling fallback", () => {
    expect(DEFAULT_OPENROUTER_MODEL).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(FALLBACK_OPENROUTER_MODEL).toBe("thinkingmachines/inkling:free");
    expect(DEFAULT_OPENROUTER_MODEL.endsWith(":free")).toBe(true);
    expect(FALLBACK_OPENROUTER_MODEL.endsWith(":free")).toBe(true);
  });

  it("ignores non-free OPENROUTER_MODEL overrides", () => {
    expect(resolveOpenRouterModel("openai/gpt-4o")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveOpenRouterModel("thinkingmachines/inkling:free")).toBe("thinkingmachines/inkling:free");
    expect(resolveOpenRouterModel("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    );
    expect(resolveOpenRouterFallbackModel()).toBe(FALLBACK_OPENROUTER_MODEL);
  });

  it("falls back on 403/404 as well as 429/5xx", () => {
    expect(shouldFallback(403)).toBe(true);
    expect(shouldFallback(404)).toBe(true);
    expect(shouldFallback(429)).toBe(true);
    expect(shouldFallback(500)).toBe(true);
    expect(shouldFallback(401)).toBe(false);
    expect(shouldFallback(400)).toBe(false);
  });

  it("masks OpenRouter key-like tokens in log text", () => {
    expect(maskOpenRouterLogText('denied for sk-or-v1-abcDEF123_key')).toBe(
      "denied for sk-or-***",
    );
    expect(maskOpenRouterLogText("Authorization: Bearer sk-or-v1-abc")).toBe(
      "Authorization: Bearer ***",
    );
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
