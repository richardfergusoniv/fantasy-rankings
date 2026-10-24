/**
 * OpenRouter OpenAI-compatible chat completions client.
 * Paid models are refused; on 403/404/429/5xx the free fallback model is tried once.
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
  temperature?: number;
};

export type OpenRouterFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export class OpenRouterError extends Error {
  readonly status: number;
  readonly body: string;
  readonly model: string | undefined;

  constructor(status: number, body: string, model?: string) {
    super(`OpenRouter request failed (${status})`);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
    this.model = model;
  }
}

export class ChatAgentTimeoutError extends Error {
  constructor(message = "Chat agent deadline exceeded.") {
    super(message);
    this.name = "ChatAgentTimeoutError";
  }
}

/**
 * Log-safe summary of an OpenRouter error body. Guardrail and moderation
 * responses can echo the user's prompt (e.g. `metadata.flagged_input`), so
 * only the diagnostic fields are kept: error code, message, moderation
 * reasons and provider. A non-JSON body is reported by length only.
 */
export function summarizeOpenRouterErrorBody(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `non-JSON body (${body.length} chars)`;
  }
  const error = parsed && typeof parsed === "object" && "error" in parsed
    ? (parsed as { error?: unknown }).error
    : undefined;
  if (!error || typeof error !== "object") return `JSON body without error (${body.length} chars)`;
  const { code, message, metadata } = error as { code?: unknown; message?: unknown; metadata?: unknown };
  const meta = metadata && typeof metadata === "object"
    ? (metadata as { reasons?: unknown; provider_name?: unknown })
    : {};
  const safe = {
    code,
    message: typeof message === "string" ? message.slice(0, 200) : undefined,
    reasons: meta.reasons,
    provider: meta.provider_name,
  };
  return maskOpenRouterLogText(JSON.stringify(safe));
}

/**
 * Mask key-like tokens before writing upstream bodies to logs: bearer tokens,
 * OpenRouter keys, and other `sk-…` provider keys an upstream may echo.
 */
export function maskOpenRouterLogText(text: string): string {
  return text
    .replace(/Bearer:?\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/sk-or-[A-Za-z0-9_-]+/g, "sk-or-***")
    .replace(/\bsk-(?!or-\*\*\*)[A-Za-z0-9_-]{8,}/g, "sk-***");
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
  const payload: Record<string, unknown> = {
    model: args.body.model,
    messages: args.body.messages,
    temperature: args.body.temperature,
  };
  if (args.body.tools) payload.tools = args.body.tools;
  // require_parameters: only route to providers that support every sent param,
  // so send only what every configured free model supports. Never add
  // tool_choice back: inkling rejects it.
  payload.provider = { require_parameters: true };

  let response: Response;
  try {
    response = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: args.signal,
    });
  } catch (err) {
    if (isAbortError(err) || args.signal?.aborted) throw new ChatAgentTimeoutError();
    throw err;
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    if (isAbortError(err) || args.signal?.aborted) throw new ChatAgentTimeoutError();
    throw err;
  }
  if (!response.ok) {
    throw new OpenRouterError(response.status, text.slice(0, 500), args.body.model);
  }
  let parsed: ChatCompletionResponse;
  try {
    parsed = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    throw new OpenRouterError(502, "Invalid JSON from OpenRouter", args.body.model);
  }
  if (!parsed.choices?.length) {
    throw new OpenRouterError(
      502,
      parsed.error?.message ?? "Empty OpenRouter choices",
      args.body.model,
    );
  }
  return parsed;
}

/** Retry once on the fallback model for block/mismatch, rate limit, or upstream outage. */
export function shouldFallback(status: number): boolean {
  return status === 403 || status === 404 || status === 429 || status >= 500;
}

/**
 * Call OpenRouter with the configured free primary model; on 403/404/429/5xx retry
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

  // Do not send tool_choice: "auto" is the default when tools are present, and
  // some free endpoints (e.g. inkling) reject the explicit tool_choice param.
  const bodyBase: Omit<OpenRouterRequest, "model"> = {
    messages: args.messages,
    tools: args.tools,
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
    // Log the primary's failure: if the fallback fails too, only its error
    // reaches the route, and a persistent primary problem would stay invisible.
    console.error(
      "[chat] primary model failed; trying fallback",
      err.status,
      primary,
      summarizeOpenRouterErrorBody(err.body),
    );
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
  systemPrompt: string = CHAT_SYSTEM_PROMPT,
): ChatCompletionMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: userMessage },
  ];
}
