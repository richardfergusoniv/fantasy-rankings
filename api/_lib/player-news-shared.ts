import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Pure helpers for the shared player-news pipeline and X ingest.
 * Kept free of DB / network so vitest can cover validation and dedupe.
 */

export const PLAYER_NEWS_RETENTION_DAYS = 30;
export const PLAYER_NEWS_NOTES_SNAPSHOT_KEY = "player-news-notes-snapshot-v1";

export type PlayerNewsSource = "sleeper" | "x" | "nflverse";
export type PlayerNewsKind = "roster" | "waiver" | "headline";

export type SharedNewsDraft = {
  id: string;
  playerId: string;
  player: string;
  team: string;
  change: string;
  newsType: PlayerNewsKind;
  roleContext: string;
  source: PlayerNewsSource;
  sourceLabel: string;
  sourceUrl: string;
  author: string | null;
  externalId: string | null;
  publishedAt: Date | null;
  signal: string | null;
  score: number | null;
};

export type NotesSnapshotEntry = {
  injuryNotes: string | null;
  newsUpdated: string | null;
};

export type NotesSnapshot = Record<string, NotesSnapshotEntry>;

const newsTypeSchema = z.enum(["roster", "waiver", "headline"]);
const sourceSchema = z.enum(["sleeper", "x", "nflverse"]);

export const xNewsItemSchema = z
  .object({
    player_id: z.string().min(1).max(80).optional(),
    player_name: z.string().min(1).max(160).optional(),
    text: z.string().min(1).max(4000),
    author_handle: z.string().min(1).max(80),
    source_url: z.string().url().max(500),
    post_id: z.string().min(1).max(80),
    published_at: z.string().datetime(),
    signal: z.string().min(1).max(80).optional(),
    score: z.number().int().min(0).max(100).optional(),
  })
  .refine((item) => Boolean(item.player_id || item.player_name), {
    message: "Each item needs player_id or player_name.",
  });

export const xNewsBatchSchema = z.object({
  items: z.array(xNewsItemSchema).min(1).max(100),
});

export type XNewsItem = z.infer<typeof xNewsItemSchema>;

export function retentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PLAYER_NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function stableNewsId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Prefer (source, externalId); fall back to sourceUrl. */
export function dedupeKey(source: PlayerNewsSource, externalId: string | null, sourceUrl: string): string {
  if (externalId && externalId.trim()) return `${source}:${externalId.trim()}`;
  return `url:${sourceUrl.trim()}`;
}

export function signalToNewsType(signal: string | null | undefined): PlayerNewsKind {
  const normalized = (signal ?? "").trim().toLowerCase();
  switch (normalized) {
    case "waiver":
    case "pickup":
      return "waiver";
    case "breaking":
    case "headline":
      return "headline";
    case "injury":
    case "status":
    case "roster":
    case "":
      return "roster";
    default:
      return "roster";
  }
}

export function parseNotesSnapshot(payload: string | undefined): NotesSnapshot {
  if (!payload) return {};
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: NotesSnapshot = {};
    for (const [playerId, raw] of Object.entries(value)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const entry = raw as Record<string, unknown>;
      const injuryNotes = typeof entry.injuryNotes === "string" || entry.injuryNotes === null
        ? (entry.injuryNotes as string | null)
        : null;
      const newsUpdated = typeof entry.newsUpdated === "string" || entry.newsUpdated === null
        ? (entry.newsUpdated as string | null)
        : typeof entry.newsUpdated === "number"
          ? String(entry.newsUpdated)
          : null;
      out[playerId] = { injuryNotes, newsUpdated };
    }
    return out;
  } catch {
    return {};
  }
}

export function normalizeNewsUpdated(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

export function newsUpdatedToDate(value: string | null): Date | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    // Sleeper sometimes sends seconds, sometimes ms.
    const ms = n < 1e12 ? n * 1000 : n;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildInjuryStatusDraft(input: {
  playerId: string;
  player: string;
  team: string;
  previousStatus: string | null;
  nextStatus: string | null;
  checkedAt: Date;
}): SharedNewsDraft {
  const externalId = `injury-status:${input.playerId}:${input.nextStatus ?? "none"}`;
  const sourceUrl = `https://sleeper.app/players/nfl/${encodeURIComponent(input.playerId)}?news=${encodeURIComponent(externalId)}`;
  return {
    id: stableNewsId(["sleeper", externalId]),
    playerId: input.playerId,
    player: input.player,
    team: input.team,
    change: `Injury status changed from ${input.previousStatus ?? "No designation"} to ${input.nextStatus ?? "No designation"}.`,
    newsType: "roster",
    roleContext: "Sleeper injury-status change detected by the scheduled check.",
    source: "sleeper",
    sourceLabel: "Sleeper",
    sourceUrl,
    author: null,
    externalId,
    publishedAt: input.checkedAt,
    signal: "injury",
    score: null,
  };
}

export function buildInjuryNotesDraft(input: {
  playerId: string;
  player: string;
  team: string;
  previousNotes: string | null;
  nextNotes: string | null;
  newsUpdated: string | null;
  checkedAt: Date;
}): SharedNewsDraft | null {
  const nextNotes = input.nextNotes?.trim() || null;
  const previousNotes = input.previousNotes?.trim() || null;
  if (!nextNotes || nextNotes === previousNotes) return null;
  const publishedAt = newsUpdatedToDate(input.newsUpdated) ?? input.checkedAt;
  const externalId = `injury-notes:${input.playerId}:${stableNewsId([nextNotes, input.newsUpdated ?? ""])}`;
  const sourceUrl = `https://sleeper.app/players/nfl/${encodeURIComponent(input.playerId)}?news=${encodeURIComponent(externalId)}`;
  return {
    id: stableNewsId(["sleeper", externalId]),
    playerId: input.playerId,
    player: input.player,
    team: input.team,
    change: nextNotes,
    newsType: "roster",
    roleContext: previousNotes
      ? "Sleeper injury notes updated."
      : "New Sleeper injury notes.",
    source: "sleeper",
    sourceLabel: "Sleeper",
    sourceUrl,
    author: null,
    externalId,
    publishedAt,
    signal: "injury_notes",
    score: null,
  };
}

export function buildNewsUpdatedDraft(input: {
  playerId: string;
  player: string;
  team: string;
  previousUpdated: string | null;
  nextUpdated: string | null;
  injuryNotes: string | null;
  checkedAt: Date;
}): SharedNewsDraft | null {
  const nextUpdated = normalizeNewsUpdated(input.nextUpdated);
  const previousUpdated = normalizeNewsUpdated(input.previousUpdated);
  if (!nextUpdated || nextUpdated === previousUpdated) return null;
  // Prefer the notes item when notes also changed; news_updated alone still
  // surfaces a lightweight status ping when notes are empty/unchanged.
  const notes = input.injuryNotes?.trim() || null;
  if (notes) return null;
  const publishedAt = newsUpdatedToDate(nextUpdated) ?? input.checkedAt;
  const externalId = `news-updated:${input.playerId}:${nextUpdated}`;
  const sourceUrl = `https://sleeper.app/players/nfl/${encodeURIComponent(input.playerId)}?news=${encodeURIComponent(externalId)}`;
  return {
    id: stableNewsId(["sleeper", externalId]),
    playerId: input.playerId,
    player: input.player,
    team: input.team,
    change: `${input.player} has a Sleeper news update.`,
    newsType: "roster",
    roleContext: "Sleeper news_updated timestamp changed without new injury notes.",
    source: "sleeper",
    sourceLabel: "Sleeper",
    sourceUrl,
    author: null,
    externalId,
    publishedAt,
    signal: "news_updated",
    score: null,
  };
}

export function normalizePlayerNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolvePlayerIdFromName(
  playerName: string,
  nameIndex: Map<string, string>,
): string | null {
  return nameIndex.get(normalizePlayerNameKey(playerName)) ?? null;
}

export function buildXNewsDraft(
  item: XNewsItem,
  resolved: { playerId: string; player: string; team: string },
): SharedNewsDraft {
  const handle = item.author_handle.replace(/^@/, "");
  const newsType = signalToNewsType(item.signal);
  return {
    id: stableNewsId(["x", item.post_id]),
    playerId: resolved.playerId,
    player: resolved.player,
    team: resolved.team,
    change: item.text.trim(),
    newsType,
    roleContext: `Posted by @${handle} on X.`,
    source: "x",
    sourceLabel: `@${handle}`,
    sourceUrl: item.source_url.trim(),
    author: `@${handle}`,
    externalId: item.post_id.trim(),
    publishedAt: new Date(item.published_at),
    signal: item.signal?.trim() || null,
    score: item.score ?? null,
  };
}

export function filterDuplicateDrafts(drafts: SharedNewsDraft[]): SharedNewsDraft[] {
  const seen = new Set<string>();
  const out: SharedNewsDraft[] = [];
  for (const draft of drafts) {
    const key = dedupeKey(draft.source, draft.externalId, draft.sourceUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }
  return out;
}

export function asPlayerNewsSource(value: string): PlayerNewsSource {
  const parsed = sourceSchema.safeParse(value);
  return parsed.success ? parsed.data : "sleeper";
}

export function asPlayerNewsKind(value: string): PlayerNewsKind {
  const parsed = newsTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "roster";
}
