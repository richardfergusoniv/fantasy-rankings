/**
 * Standing chat preferences: short notes injected into the system prompt.
 * Written only via remember_preference / forget_preference tools.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db.js";

export const CHAT_MAX_PREFERENCES = 8;
export const CHAT_MAX_PREFERENCE_CHARS = 160;

export type ChatPreference = {
  id: string;
  content: string;
  leagueId: string | null;
};

type PreferenceToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const PREFERENCE_CHAT_TOOL_DEFINITIONS: PreferenceToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "remember_preference",
      description:
        "Save a standing user preference only when they clearly state one that should apply later (e.g. rebuilding in a dynasty league, prefer upside). Do not save one-off questions. Optional leagueId scopes it.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Short preference in the user's words",
          },
          leagueId: {
            type: "string",
            description: "Optional Sleeper league id when the preference is league-specific",
          },
        },
        required: ["content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_preference",
      description: "Remove a standing preference by id from the system prompt list.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Preference id" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

const rememberSchema = z
  .object({
    content: z.string().trim().min(1).max(CHAT_MAX_PREFERENCE_CHARS),
    leagueId: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const forgetSchema = z.object({ id: z.string().trim().min(1).max(80) }).strict();

export async function listChatPreferences(userId: string): Promise<ChatPreference[]> {
  const rows = await db
    .select({
      id: schema.chatPreferences.id,
      content: schema.chatPreferences.content,
      leagueId: schema.chatPreferences.leagueId,
    })
    .from(schema.chatPreferences)
    .where(eq(schema.chatPreferences.userId, userId))
    .orderBy(asc(schema.chatPreferences.createdAt))
    .limit(CHAT_MAX_PREFERENCES);
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    leagueId: row.leagueId ?? null,
  }));
}

/** Collapse control/newline characters so preferences cannot forge prompt lines. */
export function normalizePreferenceText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

export function appendChatPreferences(systemPrompt: string, preferences: ChatPreference[]): string {
  const lines = preferences.map((pref) => {
    const content = normalizePreferenceText(pref.content);
    const leagueId = pref.leagueId ? normalizePreferenceText(pref.leagueId) : "";
    if (!content) return null;
    const scope = leagueId ? ` league=${leagueId}` : "";
    return `- id=${pref.id}${scope}: ${content}`;
  }).filter((line): line is string => Boolean(line));
  const block = [
    "Standing preferences (honor these). Call remember_preference only when the user clearly states a lasting preference; forget_preference to remove by id.",
    lines.length > 0 ? lines.join("\n") : "(none)",
  ].join("\n");
  return `${systemPrompt}\n\n${block}`;
}

export async function toolRememberPreference(
  userId: string,
  rawArgs: unknown,
): Promise<unknown> {
  const parsed = rememberSchema.safeParse(rawArgs && typeof rawArgs === "object" ? rawArgs : {});
  if (!parsed.success) {
    return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
  }
  const content = normalizePreferenceText(parsed.data.content).slice(0, CHAT_MAX_PREFERENCE_CHARS);
  if (!content) return { ok: false, error: "Invalid arguments." };
  const leagueId = parsed.data.leagueId
    ? normalizePreferenceText(parsed.data.leagueId).slice(0, 80) || null
    : null;
  const existing = await listChatPreferences(userId);
  const duplicate = existing.find(
    (item) =>
      item.content.toLowerCase() === content.toLowerCase()
      && (item.leagueId ?? null) === leagueId,
  );
  if (duplicate) {
    return { ok: true, preference: duplicate, alreadySaved: true };
  }
  if (existing.length >= CHAT_MAX_PREFERENCES) {
    return {
      ok: false,
      error: `Preference cap (${CHAT_MAX_PREFERENCES}) reached. Forget one first.`,
    };
  }
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.chatPreferences).values({
    id,
    userId,
    leagueId,
    content,
    createdAt: now,
    updatedAt: now,
  });
  return {
    ok: true,
    preference: { id, content, leagueId },
  };
}

export async function toolForgetPreference(
  userId: string,
  rawArgs: unknown,
): Promise<unknown> {
  const parsed = forgetSchema.safeParse(rawArgs && typeof rawArgs === "object" ? rawArgs : {});
  if (!parsed.success) {
    return { ok: false, error: "Invalid arguments.", issues: parsed.error.issues };
  }
  const rowFilter = and(
    eq(schema.chatPreferences.id, parsed.data.id),
    eq(schema.chatPreferences.userId, userId),
  );
  const rows = await db
    .select({ id: schema.chatPreferences.id })
    .from(schema.chatPreferences)
    .where(rowFilter)
    .limit(1);
  if (!rows[0]) return { ok: false, error: "Preference not found." };
  await db.delete(schema.chatPreferences).where(rowFilter);
  return { ok: true, deleted: true, id: parsed.data.id };
}

export async function dispatchPreferenceChatTool(
  name: string,
  rawArgs: unknown,
  userId: string,
): Promise<unknown | null> {
  switch (name) {
    case "remember_preference":
      return toolRememberPreference(userId, rawArgs);
    case "forget_preference":
      return toolForgetPreference(userId, rawArgs);
    default:
      return null;
  }
}
