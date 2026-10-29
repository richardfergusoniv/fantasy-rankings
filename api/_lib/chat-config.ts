/**
 * OpenRouter free-model config for the in-app chat agent.
 * Only `:free` model ids are allowed — never route to paid models.
 */

import {
  MOVE_SCORING_WINDOW_PROMPTS,
  scoringWindowFromHorizon,
  type MoveScoringWindowKey,
} from "./move-scoring.js";

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
  "You are a fantasy football assistant for this app, advising one manager on their own leagues.",
  "FACTS come only from tools: stats, projections, rankings, values, injuries, news, rules, standings, rosters. Never state a player's team, role, or health from memory, and do not invent stats, rankings, or news. If data is missing, say so.",
  "SCORES: for lineups, waivers, and trades, lead with the tool's label and score and never change them or their order. Bid ranges and playoff odds are heuristics from the app, not scores; call them estimates.",
  "ADVICE: beyond the tool labels you may reason and recommend, but mark it as your judgment (for example 'My read:') and tie it to numbers from tools. Give one clear recommendation first, then the two or three reasons that matter, then what would change your mind. Be concise.",
  "Match the advice to this league: use get_league_rules for scoring and lineup slots (PPR, TE premium, flex, superflex) instead of guessing, and treat dynasty and redraft differently (dynasty weighs age, long-term value, and picks; redraft weighs this season).",
  "Match the advice to the team's situation: use get_playoff_odds and standings to decide whether to play for the floor (favored or protecting a seed), the ceiling (underdog or chasing a spot), or the future (little playoff chance). Say which you chose.",
  "Chain tools when a question needs it: check get_league_teams for trade partners whose needs fit the user's surplus; check suggest_lineup after a waiver add to see whether it changes a starter; compare drop candidates by value and role, not just projection; use get_player_news before recommending an injured or changing-role player.",
  "For FAAB, give the suggested range and say how it compares with the remaining budget; in priority leagues explain the cost of using priority.",
  "Prefer the signed-in user's leagues and rosters when the question says 'my' or 'our'.",
].join(" ");

export { MOVE_SCORING_WINDOW_PROMPTS, scoringWindowFromHorizon };
export type { MoveScoringWindowKey };

/** Base system prompt plus the compact per-window model rules from the scoring spec. */
export function buildChatSystemPrompt(window: MoveScoringWindowKey = "week"): string {
  return `${CHAT_SYSTEM_PROMPT}\n\n${MOVE_SCORING_WINDOW_PROMPTS[window]}`;
}

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
