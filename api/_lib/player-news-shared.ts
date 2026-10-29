import { createHash } from "node:crypto";
import { z } from "zod";
import { isHttpOrHttpsUrl } from "./http-url.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";

export {
  isSleeperTimestampOnlyNews,
  SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
} from "./player-news-filters.js";

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

/**
 * X ingest producer contract:
 * Prefer `player_id` (Sleeper id) whenever known. Name matching is a fallback
 * and will drop ambiguous last-name-only rows unless `team` is also sent.
 */
export const xNewsItemSchema = z
  .object({
    player_id: z.string().min(1).max(80).optional(),
    player_name: z.string().min(1).max(160).optional(),
    /** Optional NFL team code; required to resolve last-name-only `player_name`. */
    team: z.string().min(1).max(8).optional(),
    text: z.string().min(1).max(4000),
    author_handle: z.string().min(1).max(80),
    // z.string().url() accepts javascript:/data:/file:; allowlist http(s) only.
    source_url: z.string().url().max(500).refine(isHttpOrHttpsUrl, {
      message: "source_url must be an http or https URL.",
    }),
    post_id: z.string().min(1).max(80),
    published_at: z.string().datetime(),
    signal: z.string().min(1).max(80).optional(),
    score: z.number().int().min(0).max(100).optional(),
  })
  .refine((item) => Boolean(item.player_id || item.player_name), {
    message: "Each item needs player_id or player_name (prefer player_id).",
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

/**
 * In-batch / write dedupe: one row per (post, player).
 * Prefer (source, externalId, playerId); fall back to (sourceUrl, playerId).
 */
export function dedupeKey(
  source: PlayerNewsSource,
  externalId: string | null,
  sourceUrl: string,
  playerId: string,
): string {
  const player = playerId.trim();
  if (externalId && externalId.trim()) return `${source}:${externalId.trim()}:${player}`;
  return `url:${sourceUrl.trim()}:${player}`;
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
    const value: unknown = decodeSourceCachePayload(payload);
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

/**
 * Formerly emitted a lightweight ping when Sleeper's news_updated timestamp
 * changed without new injury notes. Those rows were meaningless in the ticker
 * ("…has a Sleeper news update.") — creation is disabled. Existing rows are
 * filtered on read via {@link isSleeperTimestampOnlyNews}.
 */
export function buildNewsUpdatedDraft(_input: {
  playerId: string;
  player: string;
  team: string;
  previousUpdated: string | null;
  nextUpdated: string | null;
  injuryNotes: string | null;
  checkedAt: Date;
}): SharedNewsDraft | null {
  return null;
}

/** Trailing generational / ordinal suffixes stripped from name keys. */
const GENERATIONAL_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Alternate normalized keys → canonical key matching Sleeper `full_name`
 * after {@link normalizePlayerNameKey} (spaces kept; initials collapsed).
 */
export const PLAYER_NAME_KEY_ALIASES: Readonly<Record<string, string>> = {
  // Wan'Dale → "wan dale …"; producers often emit "Wandale …".
  "wandale robinson": "wan dale robinson",
};

function collapseSingleLetterTokens(tokens: string[]): string[] {
  const collapsed: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.length !== 1) {
      collapsed.push(token);
      continue;
    }
    let run = token;
    while (i + 1 < tokens.length && tokens[i + 1]!.length === 1) {
      i += 1;
      run += tokens[i]!;
    }
    collapsed.push(run);
  }
  return collapsed;
}

/**
 * Space-separated name key for X / prop-line matching.
 * Strips Jr/Sr/II–V, collapses A.J. → aj, applies {@link PLAYER_NAME_KEY_ALIASES}.
 */
export function normalizePlayerNameKey(name: string): string {
  const tokens = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && GENERATIONAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  const key = collapseSingleLetterTokens(tokens).join(" ");
  return PLAYER_NAME_KEY_ALIASES[key] ?? key;
}

export function playerNameTokenCount(normalizedKey: string): number {
  if (!normalizedKey) return 0;
  return normalizedKey.split(/\s+/).filter(Boolean).length;
}

export function isLastNameOnlyKey(normalizedKey: string): boolean {
  return playerNameTokenCount(normalizedKey) === 1;
}

export function lastNameFromKey(normalizedKey: string): string {
  const parts = normalizedKey.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Align JAC/LA/… with roster team codes used in the name index. */
export function normalizeNewsTeam(team: string | null | undefined): string | null {
  if (!team) return null;
  const raw = team.trim().toUpperCase();
  if (!raw) return null;
  if (raw === "JAC") return "JAX";
  if (raw === "LA") return "LAR";
  if (raw === "LVR" || raw === "OAK") return "LV";
  if (raw === "WSH") return "WAS";
  return raw;
}

export function nameTeamKey(nameKey: string, team: string): string {
  return `${nameKey}|${team}`;
}

export type PlayerNewsNameIndex = {
  byId: Map<string, { player: string; team: string }>;
  /** Unique full-name key → playerId (ambiguous names omitted). */
  byName: Map<string, string>;
  /** `${fullNameKey}|${team}` → playerId. */
  byNameTeam: Map<string, string>;
  /** `${lastName}|${team}` → playerId when unique on that team. */
  byLastNameTeam: Map<string, string>;
};

export type PlayerNewsNameIndexEntry = {
  playerId: string;
  player: string;
  team: string;
};

/**
 * Build lookup maps from roster rows. Ambiguous names are left out of
 * `byName` / `byNameTeam` / `byLastNameTeam` so callers cannot silently pick
 * the wrong player; use `player_id` or a unique name(+team) match instead.
 */
export function buildPlayerNewsNameIndex(
  entries: ReadonlyArray<PlayerNewsNameIndexEntry>,
): PlayerNewsNameIndex {
  const byId = new Map<string, { player: string; team: string }>();
  const nameHits = new Map<string, string[]>();
  const nameTeamHits = new Map<string, string[]>();
  const lastTeamHits = new Map<string, string[]>();

  for (const entry of entries) {
    const team = normalizeNewsTeam(entry.team) ?? "FA";
    byId.set(entry.playerId, { player: entry.player, team });
    const nameKey = normalizePlayerNameKey(entry.player);
    if (!nameKey) continue;
    const ids = nameHits.get(nameKey) ?? [];
    ids.push(entry.playerId);
    nameHits.set(nameKey, ids);
    const nameTeam = nameTeamKey(nameKey, team);
    const nameTeamIds = nameTeamHits.get(nameTeam) ?? [];
    nameTeamIds.push(entry.playerId);
    nameTeamHits.set(nameTeam, nameTeamIds);
    const last = lastNameFromKey(nameKey);
    if (!last) continue;
    const lastKey = nameTeamKey(last, team);
    const lastIds = lastTeamHits.get(lastKey) ?? [];
    lastIds.push(entry.playerId);
    lastTeamHits.set(lastKey, lastIds);
  }

  const byName = new Map<string, string>();
  for (const [key, ids] of nameHits) {
    const unique = [...new Set(ids)];
    if (unique.length === 1) byName.set(key, unique[0]!);
  }

  const byNameTeam = new Map<string, string>();
  for (const [key, ids] of nameTeamHits) {
    const unique = [...new Set(ids)];
    if (unique.length === 1) byNameTeam.set(key, unique[0]!);
  }

  const byLastNameTeam = new Map<string, string>();
  for (const [key, ids] of lastTeamHits) {
    const unique = [...new Set(ids)];
    if (unique.length === 1) byLastNameTeam.set(key, unique[0]!);
  }

  return { byId, byName, byNameTeam, byLastNameTeam };
}

export function resolvePlayerIdFromName(
  playerName: string,
  nameIndex: Map<string, string>,
): string | null {
  return nameIndex.get(normalizePlayerNameKey(playerName)) ?? null;
}

/**
 * Resolve an X news item to a roster player.
 * Prefer `player_id`. Name fallback uses unique full-name keys; last-name-only
 * requires `team` and a unique last+team match (otherwise unresolved).
 */
export function resolveXNewsPlayer(
  item: Pick<XNewsItem, "player_id" | "player_name" | "team">,
  index: PlayerNewsNameIndex,
): { playerId: string; player: string; team: string } | null {
  const explicitId = item.player_id?.trim() || null;
  if (explicitId) {
    const meta = index.byId.get(explicitId);
    if (meta) return { playerId: explicitId, player: meta.player, team: meta.team };
  }

  const rawName = item.player_name?.trim();
  if (!rawName) return null;

  const nameKey = normalizePlayerNameKey(rawName);
  if (!nameKey) return null;
  const team = normalizeNewsTeam(item.team);

  // One-token names use last+team uniqueness only — never byNameTeam, which
  // keys on full normalized name and would bypass surname collision checks.
  if (isLastNameOnlyKey(nameKey)) {
    if (!team) return null;
    const lastHit = index.byLastNameTeam.get(nameTeamKey(nameKey, team));
    if (!lastHit) return null;
    const meta = index.byId.get(lastHit);
    return meta ? { playerId: lastHit, player: meta.player, team: meta.team } : null;
  }

  if (team) {
    const withTeam = index.byNameTeam.get(nameTeamKey(nameKey, team));
    if (withTeam) {
      const meta = index.byId.get(withTeam);
      if (meta) return { playerId: withTeam, player: meta.player, team: meta.team };
    }
  }

  const byName = index.byName.get(nameKey);
  if (!byName) return null;
  const meta = index.byId.get(byName);
  return meta ? { playerId: byName, player: meta.player, team: meta.team } : null;
}

export function buildXNewsDraft(
  item: XNewsItem,
  resolved: { playerId: string; player: string; team: string },
): SharedNewsDraft {
  const handle = item.author_handle.replace(/^@/, "");
  const newsType = signalToNewsType(item.signal);
  const postId = item.post_id.trim();
  return {
    // Include playerId so the same X post can produce distinct PKs per player.
    id: stableNewsId(["x", postId, resolved.playerId]),
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
    externalId: postId,
    publishedAt: new Date(item.published_at),
    signal: item.signal?.trim() || null,
    score: item.score ?? null,
  };
}

export function filterDuplicateDrafts(drafts: SharedNewsDraft[]): SharedNewsDraft[] {
  const seen = new Set<string>();
  const out: SharedNewsDraft[] = [];
  for (const draft of drafts) {
    const key = dedupeKey(draft.source, draft.externalId, draft.sourceUrl, draft.playerId);
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
