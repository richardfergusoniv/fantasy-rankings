/**
 * OpenRouter OpenAI-compatible chat completions client.
 * Paid models are refused; on 403/404/429/5xx (or a per-attempt timeout) the
 * call falls through the chain of free tool-capable models until one answers.
 * Client-side aborts / deadlines are not retried as upstream failures.
 */
import {
  CHAT_SYSTEM_PROMPT,
  isFreeOpenRouterModel,
  OPENROUTER_BASE_URL,
  resolveOpenRouterFallbackModel,
  resolveOpenRouterModel,
  resolveOpenRouterModelChain,
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
 * only the diagnostic fields are kept: error code, message, provider, and
 * how many moderation reasons there were (the reasons themselves are
 * free-form and may quote the prompt). A non-JSON body is reported by length only.
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
    reasonCount: Array.isArray(meta.reasons) ? meta.reasons.length : undefined,
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

const MAX_ERROR_BODY_CHARS = 16_000;

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
    // Keep enough of the body for summarizeOpenRouterErrorBody to parse it as
    // JSON (a 500-char cut broke longer guardrail errors); it bounds what is logged.
    throw new OpenRouterError(response.status, text.slice(0, MAX_ERROR_BODY_CHARS), args.body.model);
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
 * After a model fails with a fallback-eligible status, deprioritize it for
 * this long (per instance), instead of paying a failed round-trip to it on
 * every call while it is down.
 */
export const PRIMARY_COOLDOWN_MS = 5 * 60_000;
const primaryCooldownUntil = new Map<string, number>();

/** Test helper: forget model cooldowns. */
export function resetPrimaryCooldowns(): void {
  primaryCooldownUntil.clear();
}

/** Per-attempt cap so one slow model cannot starve the rest of the chain. */
export const MODEL_ATTEMPT_TIMEOUT_MS = 20_000;

/** Internal marker: an attempt hit the per-attempt cap (not the caller's deadline). */
class ModelAttemptTimeoutError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(`Model attempt timed out: ${model}`);
    this.name = "ModelAttemptTimeoutError";
    this.model = model;
  }
}

/**
 * Call OpenRouter with the configured free primary model; on 403/404/429/5xx
 * or a per-attempt timeout, fall through the chain of free tool-capable
 * models (the named fallback first, then every other one) until a model
 * answers or the chain runs out. The caller's abort signal outranks the
 * chain: a deadline stops everything and is never retried.
 */
export async function callOpenRouterWithFallback(args: {
  apiKey: string;
  messages: ChatCompletionMessage[];
  tools: OpenAiToolDefinition[];
  fetchImpl?: OpenRouterFetch;
  primaryModel?: string;
  fallbackModel?: string;
  signal?: AbortSignal;
  attemptTimeoutMs?: number;
}): Promise<{ response: ChatCompletionResponse; model: string }> {
  const primary = args.primaryModel ?? resolveOpenRouterModel();
  const fallback = args.fallbackModel ?? resolveOpenRouterFallbackModel();
  assertFreeModel(primary);
  assertFreeModel(fallback);

  // Models still cooling down after a recent failure go last instead of
  // being skipped outright, so a bad run never leaves nothing to try.
  const chain = [...new Set([primary, fallback, ...resolveOpenRouterModelChain(primary)])];
  const now = Date.now();
  const ordered = [
    ...chain.filter((model) => (primaryCooldownUntil.get(model) ?? 0) <= now),
    ...chain.filter((model) => (primaryCooldownUntil.get(model) ?? 0) > now),
  ];

  // Do not send tool_choice: "auto" is the default when tools are present, and
  // some free endpoints (e.g. inkling) reject the explicit tool_choice param.
  const bodyBase: Omit<OpenRouterRequest, "model"> = {
    messages: args.messages,
    tools: args.tools,
    temperature: 0.2,
  };
  const attemptTimeoutMs = args.attemptTimeoutMs ?? MODEL_ATTEMPT_TIMEOUT_MS;

  const callModel = async (model: string) => {
    const attempt = new AbortController();
    const onParentAbort = () => attempt.abort();
    if (args.signal) {
      if (args.signal.aborted) throw new ChatAgentTimeoutError();
      args.signal.addEventListener("abort", onParentAbort, { once: true });
    }
    const timer = setTimeout(() => attempt.abort(), attemptTimeoutMs);
    try {
      const response = await callOpenRouterChat({
        apiKey: args.apiKey,
        body: { ...bodyBase, model },
        fetchImpl: args.fetchImpl,
        signal: attempt.signal,
      });
      return { response, model };
    } catch (err) {
      if (args.signal?.aborted) throw new ChatAgentTimeoutError();
      // callOpenRouterChat reports any abort as ChatAgentTimeoutError; with
      // the caller's signal still live, the abort was this attempt's timer.
      if (err instanceof ChatAgentTimeoutError) throw new ModelAttemptTimeoutError(model);
      throw err;
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onParentAbort);
    }
  };

  let lastError: unknown;
  for (let index = 0; index < ordered.length; index += 1) {
    const model = ordered[index]!;
    try {
      const result = await callModel(model);
      primaryCooldownUntil.delete(model);
      return result;
    } catch (err) {
      if (err instanceof ChatAgentTimeoutError) throw err;
      const timedOut = err instanceof ModelAttemptTimeoutError;
      if (!timedOut && (!(err instanceof OpenRouterError) || !shouldFallback(err.status))) throw err;
      lastError = err;
      primaryCooldownUntil.set(model, Date.now() + PRIMARY_COOLDOWN_MS);
      if (index + 1 >= ordered.length) break;
      // Log every hop: if the whole chain fails, only the last error reaches
      // the route, and a persistently broken model would stay invisible.
      if (timedOut) {
        console.error("[chat] model attempt timed out; trying next", attemptTimeoutMs, model);
      } else if (index === 0) {
        console.error(
          "[chat] primary model failed; trying fallback",
          (err as OpenRouterError).status,
          model,
          summarizeOpenRouterErrorBody((err as OpenRouterError).body),
        );
      } else {
        console.error(
          "[chat] fallback model failed; trying next",
          (err as OpenRouterError).status,
          model,
          summarizeOpenRouterErrorBody((err as OpenRouterError).body),
        );
      }
    }
  }
  throw lastError;
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
