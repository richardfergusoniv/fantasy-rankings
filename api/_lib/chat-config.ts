/**
 * OpenRouter free-model config for the in-app chat agent.
 * Only `:free` model ids are allowed — never route to paid models.
 */

export const DEFAULT_OPENROUTER_MODEL = "thinkingmachines/inkling:free";
export const FALLBACK_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Cap tool-calling rounds per user question. */
export const CHAT_MAX_TOOL_STEPS = 8;

/** Max characters accepted in a single user message. */
export const CHAT_MAX_INPUT_CHARS = 2_000;

/** Max prior messages accepted from the client (excluding the new user turn). */
export const CHAT_MAX_HISTORY_MESSAGES = 20;

/** Per-user question budget. */
export const CHAT_RATE_LIMIT_MAX = 20;
export const CHAT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** Stay under the Vercel Hobby 60s function cap across tool steps. */
export const CHAT_AGENT_DEADLINE_MS = 55_000;

export const CHAT_SYSTEM_PROMPT = [
  "You are a fantasy football assistant for this app.",
  "Answer only from tool results. Cite numbers from tools.",
  "When suggesting lineups, waivers, or trades, cite the projections, values, or power-rank numbers the suggestion is based on.",
  "If data is missing, say so. Be concise. Do not invent stats, rankings, or news.",
  "Prefer the signed-in user's leagues and rosters when the question says 'my' or 'our'.",
].join(" ");

export function isFreeOpenRouterModel(modelId: string): boolean {
  return modelId.trim().endsWith(":free");
}

/**
 * Resolve the primary model. Optional `OPENROUTER_MODEL` must end in `:free`;
 * otherwise the default free tool-capable model is used.
 */
export function resolveOpenRouterModel(envModel = process.env.OPENROUTER_MODEL): string {
  const trimmed = envModel?.trim() ?? "";
  if (trimmed && isFreeOpenRouterModel(trimmed)) return trimmed;
  return DEFAULT_OPENROUTER_MODEL;
}

export function resolveOpenRouterFallbackModel(): string {
  const primary = resolveOpenRouterModel();
  if (primary === FALLBACK_OPENROUTER_MODEL) return DEFAULT_OPENROUTER_MODEL;
  return FALLBACK_OPENROUTER_MODEL;
}

export function readOpenRouterApiKey(env = process.env): string | null {
  const key = env.OPENROUTER_API_KEY?.trim();
  return key ? key : null;
}
