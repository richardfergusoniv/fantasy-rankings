/**
 * OpenRouter OpenAI-compatible chat completions client.
 * Paid models are refused; on 429/5xx the free fallback model is tried once.
 * Client-side aborts / deadlines are not retried as upstream failures.
 */
import {
  CHAT_SYSTEM_PROMPT,
  isFreeOpenRouterModel,
  OPENROUTER_BASE_URL,
  resolveOpenRouterFallbackModel,
  resolveOpenRouterModel,
} from "./chat-config.js";
import type { OpenAiToolDefinition } from "./chat-tools.js";

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ChatCompletionMessage = {
  role: ChatMessageRole;
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatCompletionChoice = {
  message: ChatCompletionMessage;
  finish_reason?: string | null;
};

export type ChatCompletionResponse = {
  id?: string;
  model?: string;
  choices: ChatCompletionChoice[];
  error?: { message?: string; code?: number };
};

export type OpenRouterRequest = {
  model: string;
  messages: ChatCompletionMessage[];
  tools?: OpenAiToolDefinition[];
  tool_choice?: "auto" | "none";
  temperature?: number;
};

export type OpenRouterFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export class OpenRouterError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`OpenRouter request failed (${status})`);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
  }
}

export class ChatAgentTimeoutError extends Error {
  constructor(message = "Chat agent deadline exceeded.") {
    super(message);
    this.name = "ChatAgentTimeoutError";
  }
}

function assertFreeModel(model: string): void {
  if (!isFreeOpenRouterModel(model)) {
    throw new Error(`Refusing non-free OpenRouter model: ${model}`);
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (err instanceof Error && err.name === "AbortError") return true;
  return "name" in err && (err as { name: unknown }).name === "AbortError";
}

export async function callOpenRouterChat(
  args: {
    apiKey: string;
    body: OpenRouterRequest;
    fetchImpl?: OpenRouterFetch;
    signal?: AbortSignal;
  },
): Promise<ChatCompletionResponse> {
  assertFreeModel(args.body.model);
  if (args.signal?.aborted) throw new ChatAgentTimeoutError();
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...args.body,
        // Keep free: never let OpenRouter fall through to paid models.
        provider: { require_parameters: true },
      }),
      signal: args.signal,
    });
  } catch (err) {
    if (isAbortError(err) || args.signal?.aborted) throw new ChatAgentTimeoutError();
    throw err;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new OpenRouterError(response.status, text.slice(0, 500));
  }
  let parsed: ChatCompletionResponse;
  try {
    parsed = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    throw new OpenRouterError(502, "Invalid JSON from OpenRouter");
  }
  if (!parsed.choices?.length) {
    throw new OpenRouterError(502, parsed.error?.message ?? "Empty OpenRouter choices");
  }
  return parsed;
}

function shouldFallback(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Call OpenRouter with the configured free primary model; on 429/5xx retry
 * once with the free fallback model. Aborts / deadlines are not retried.
 */
export async function callOpenRouterWithFallback(args: {
  apiKey: string;
  messages: ChatCompletionMessage[];
  tools: OpenAiToolDefinition[];
  fetchImpl?: OpenRouterFetch;
  primaryModel?: string;
  fallbackModel?: string;
  signal?: AbortSignal;
}): Promise<{ response: ChatCompletionResponse; model: string }> {
  const primary = args.primaryModel ?? resolveOpenRouterModel();
  const fallback = args.fallbackModel ?? resolveOpenRouterFallbackModel();
  assertFreeModel(primary);
  assertFreeModel(fallback);

  const bodyBase: Omit<OpenRouterRequest, "model"> = {
    messages: args.messages,
    tools: args.tools,
    tool_choice: "auto",
    temperature: 0.2,
  };

  try {
    const response = await callOpenRouterChat({
      apiKey: args.apiKey,
      body: { ...bodyBase, model: primary },
      fetchImpl: args.fetchImpl,
      signal: args.signal,
    });
    return { response, model: primary };
  } catch (err) {
    if (err instanceof ChatAgentTimeoutError) throw err;
    if (!(err instanceof OpenRouterError) || !shouldFallback(err.status)) throw err;
    if (fallback === primary) throw err;
    const response = await callOpenRouterChat({
      apiKey: args.apiKey,
      body: { ...bodyBase, model: fallback },
      fetchImpl: args.fetchImpl,
      signal: args.signal,
    });
    return { response, model: fallback };
  }
}

export function buildInitialMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
): ChatCompletionMessage[] {
  return [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: userMessage },
  ];
}
