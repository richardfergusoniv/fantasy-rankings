import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_MODEL,
  FALLBACK_OPENROUTER_MODEL,
  isFreeOpenRouterModel,
  resolveOpenRouterFallbackModel,
  resolveOpenRouterModel,
} from "./chat-config.js";
import { callOpenRouterChat } from "./chat-openrouter.js";

describe("chat-config free models", () => {
  it("only accepts :free model ids", () => {
    expect(isFreeOpenRouterModel("google/gemma-4-31b-it:free")).toBe(true);
    expect(isFreeOpenRouterModel("openai/gpt-4o")).toBe(false);
  });

  it("ignores non-free OPENROUTER_MODEL overrides", () => {
    expect(resolveOpenRouterModel("openai/gpt-4o")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveOpenRouterModel("google/gemma-4-31b-it:free")).toBe("google/gemma-4-31b-it:free");
    expect(resolveOpenRouterFallbackModel().endsWith(":free")).toBe(true);
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
});
