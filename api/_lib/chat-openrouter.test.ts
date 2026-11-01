import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENROUTER_MODEL,
  FALLBACK_OPENROUTER_MODEL,
  resolveOpenRouterModelChain,
} from "./chat-config.js";
import {
  callOpenRouterWithFallback,
  OpenRouterError,
  resetPrimaryCooldowns,
  type OpenRouterFetch,
} from "./chat-openrouter.js";

const THIRD_MODEL = "thinkingmachines/inkling-small:free";

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function modelOf(init?: RequestInit): string {
  return (JSON.parse(String(init?.body ?? "{}")) as { model: string }).model;
}

/** Fetch stub routing by requested model; records the attempt order. */
function routedFetch(handlers: Record<string, (init?: RequestInit) => Promise<Response> | Response>) {
  const attempts: string[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const model = modelOf(init);
    attempts.push(model);
    const handler = handlers[model] ?? handlers["*"];
    if (!handler) throw new Error(`No handler for model ${model}`);
    return handler(init);
  }) as unknown as OpenRouterFetch;
  return { attempts, fetchImpl };
}

describe("callOpenRouterWithFallback chain", () => {
  beforeEach(() => {
    resetPrimaryCooldowns();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("falls through busy models until one answers", async () => {
    const { attempts, fetchImpl } = routedFetch({
      [DEFAULT_OPENROUTER_MODEL]: () => new Response("rate limited", { status: 429 }),
      [FALLBACK_OPENROUTER_MODEL]: () => new Response("upstream down", { status: 503 }),
      [THIRD_MODEL]: () => okResponse("Third model answer."),
    });
    const result = await callOpenRouterWithFallback({
      apiKey: "sk-or-test",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      fetchImpl,
    });
    expect(result.model).toBe(THIRD_MODEL);
    expect(result.response.choices[0]?.message.content).toBe("Third model answer.");
    expect(attempts).toEqual([DEFAULT_OPENROUTER_MODEL, FALLBACK_OPENROUTER_MODEL, THIRD_MODEL]);
  });

  it("throws the last error when every model in the chain is busy", async () => {
    const { attempts, fetchImpl } = routedFetch({
      "*": () => new Response("rate limited", { status: 429 }),
    });
    await expect(
      callOpenRouterWithFallback({
        apiKey: "sk-or-test",
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: "OpenRouterError", status: 429 });
    expect(attempts).toHaveLength(resolveOpenRouterModelChain().length);
  });

  it("does not fall through on a non-fallback error", async () => {
    const { attempts, fetchImpl } = routedFetch({
      "*": () => new Response("bad request", { status: 400 }),
    });
    await expect(
      callOpenRouterWithFallback({
        apiKey: "sk-or-test",
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OpenRouterError);
    expect(attempts).toEqual([DEFAULT_OPENROUTER_MODEL]);
  });

  it("deprioritizes a model that just failed on the next call", async () => {
    const first = routedFetch({
      [DEFAULT_OPENROUTER_MODEL]: () => new Response("rate limited", { status: 429 }),
      [FALLBACK_OPENROUTER_MODEL]: () => okResponse("Fallback answer."),
    });
    const firstResult = await callOpenRouterWithFallback({
      apiKey: "sk-or-test",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      fetchImpl: first.fetchImpl,
    });
    expect(firstResult.model).toBe(FALLBACK_OPENROUTER_MODEL);

    const second = routedFetch({ "*": () => okResponse("Any answer.") });
    const secondResult = await callOpenRouterWithFallback({
      apiKey: "sk-or-test",
      messages: [{ role: "user", content: "Hi again" }],
      tools: [],
      fetchImpl: second.fetchImpl,
    });
    // The primary is cooling down, so the fallback is attempted first and wins.
    expect(second.attempts).toEqual([FALLBACK_OPENROUTER_MODEL]);
    expect(secondResult.model).toBe(FALLBACK_OPENROUTER_MODEL);
  });

  it("advances past a model whose attempt times out", async () => {
    const { attempts, fetchImpl } = routedFetch({
      [DEFAULT_OPENROUTER_MODEL]: (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
      [FALLBACK_OPENROUTER_MODEL]: () => okResponse("Fallback after timeout."),
    });
    const result = await callOpenRouterWithFallback({
      apiKey: "sk-or-test",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      fetchImpl,
      attemptTimeoutMs: 25,
    });
    expect(result.model).toBe(FALLBACK_OPENROUTER_MODEL);
    expect(attempts).toEqual([DEFAULT_OPENROUTER_MODEL, FALLBACK_OPENROUTER_MODEL]);
  });
});
