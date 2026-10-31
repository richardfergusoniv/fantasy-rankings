import { createHash } from "node:crypto";
import { z } from "zod";
import { isHttpOrHttpsUrl } from "./http-url.js";
import { isAllowedNewsTag } from "./player-news-badges.js";
import { decodeSourceCachePayload } from "./source-cache-payload.js";

export {
  DYNASTY_NEWS_TAG,
  isSleeperTimestampOnlyNews,
  newsVisibleInContext,
  SLEEPER_TIMESTAMP_ONLY_ROLE_CONTEXT,
} from "./player-news-filters.js";
export {
  ALLOWED_NEWS_TAGS,
  CRYPTIC_NEWS_TAG,
  X_SOURCE_ROLE_TAGS,
  articleOutletBadgeLabel,
  isAllowedNewsTag,
  selectNewsBadges,
  type AllowedNewsTag,
  type NewsBadge,
  type NewsBadges,
  type NewsBadgeTone,
  type XSourceRoleTag,
} from "./player-news-badges.js";

/**
 * Pure helpers for the shared player-news pipeline and X ingest.
 * Kept free of DB / network so vitest can cover validation and dedupe.
 */

export const PLAYER_NEWS_RETENTION_DAYS = 30;
export const PLAYER_NEWS_NOTES_SNAPSHOT_KEY = "player-news-notes-snapshot-v1";

export type PlayerNewsSource = "sleeper" | "x" | "nflverse" | "article";
export type PlayerNewsKind = "roster" | "waiver" | "headline";
export type PlayerNewsScope = "player" | "team" | "league";

/** Canonical NFL team codes after {@link normalizeNewsTeam} (JAC→JAX, etc.). */
export const NFL_NEWS_TEAM_CODES = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
] as const;

export type NflNewsTeamCode = (typeof NFL_NEWS_TEAM_CODES)[number];

const NFL_NEWS_TEAM_CODE_SET: ReadonlySet<string> = new Set(NFL_NEWS_TEAM_CODES);

export function isValidNflNewsTeam(team: string | null | undefined): team is NflNewsTeamCode {
  return Boolean(team && NFL_NEWS_TEAM_CODE_SET.has(team));
}

export type SharedNewsDraft = {
  id: string;
  /** Null for team/league-scoped X rows. */
  playerId: string | null;
  player: string;
  /** Null for league-scoped X rows. */
  team: string | null;
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
  tags: string[];
  scope: PlayerNewsScope;
};

/**
 * Tags on X ingest: unknown / malformed values are dropped (not rejected).
 * Allowlist: dynasty, cryptic, + X source-role tags (insider, beat, analyst,
 * rumor, team-account, player). Max 5 after filtering (fits role + dynasty +
 * cryptic).
 */
const newsTagsFieldSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return value;
  return normalizeNewsTags(value.filter((entry): entry is string => typeof entry === "string"));
}, z.array(z.string().min(1).max(32)).max(5).optional());

export type NotesSnapshotEntry = {
  injuryNotes: string | null;
  newsUpdated: string | null;
};

export type NotesSnapshot = Record<string, NotesSnapshotEntry>;

const newsTypeSchema = z.enum(["roster", "waiver", "headline"]);
const sourceSchema = z.enum(["sleeper", "x", "nflverse", "article"]);

const xNewsScopeSchema = z.enum(["player", "team", "league"]);

/**
 * X ingest producer contract:
 * - scope "player" (default): Prefer `player_id` (Sleeper id) whenever known.
 *   Name matching is a fallback and will drop ambiguous last-name-only rows
 *   unless `team` is also sent.
 * - scope "team": `team` required (valid NFL code; JAC/LA/WSH/… normalized).
 *   No player resolve / attach — one row with player_id null.
 * - scope "league": no player and no team — one row with player_id and team null.
 */
export const xNewsItemSchema = z
  .object({
    /** Defaults to "player" when omitted. */
    scope: xNewsScopeSchema.optional(),
    player_id: z.string().min(1).max(80).optional(),
    player_name: z.string().min(1).max(160).optional(),
    /**
     * NFL team code. Required for scope "team" (and for last-name-only player
     * name resolve). Ignored / forbidden for scope "league".
     */
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
    /**
     * Optional tags: dynasty, cryptic, and/or one X source-role tag
     * (`insider` | `beat` | `analyst` | `rumor` | `team-account` | `player`).
     * Unknown tags are dropped; they do not reject the item.
     */
    tags: newsTagsFieldSchema,
  })
  .superRefine((item, ctx) => {
    const scope = item.scope ?? "player";
    switch (scope) {
      case "player": {
        if (!item.player_id && !item.player_name) {
          ctx.addIssue({
            code: "custom",
            message: "Each item needs player_id or player_name (prefer player_id).",
            path: ["player_id"],
          });
        }
        break;
      }
      case "team": {
        const team = normalizeNewsTeam(item.team);
        if (!isValidNflNewsTeam(team)) {
          ctx.addIssue({
            code: "custom",
            message: "scope \"team\" requires a valid NFL team code.",
            path: ["team"],
          });
        }
        break;
      }
      case "league": {
        if (item.player_id || item.player_name) {
          ctx.addIssue({
            code: "custom",
            message: "scope \"league\" must not include player_id or player_name.",
            path: ["player_id"],
          });
        }
        if (item.team) {
          ctx.addIssue({
            code: "custom",
            message: "scope \"league\" must not include team.",
            path: ["team"],
          });
        }
        break;
      }
      default: {
        const _exhaustive: never = scope;
        void _exhaustive;
        break;
      }
    }
  });

export const xNewsBatchSchema = z.object({
  items: z.array(xNewsItemSchema).min(1).max(100),
});

export type XNewsItem = z.infer<typeof xNewsItemSchema>;

export function xNewsItemScope(item: Pick<XNewsItem, "scope">): PlayerNewsScope {
  return item.scope ?? "player";
}

export function retentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PLAYER_NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function stableNewsId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Normalize optional ingest tags: lowercase, trim, dedupe, keep allowlisted
 * tags only, cap at 5. Unknown tags are dropped so producers can evolve
 * without rejecting whole items.
 */
export function normalizeNewsTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || !isAllowedNewsTag(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * In-batch / write dedupe.
 * - player: one row per (post, player)
 * - team: one row per (post, team)
 * - league: one row per post
 * Prefer externalId when present; fall back to sourceUrl.
 */
export function dedupeKey(
  source: PlayerNewsSource,
  externalId: string | null,
  sourceUrl: string,
  playerId: string | null,
  scope: PlayerNewsScope = "player",
  team: string | null = null,
): string {
  const base = externalId && externalId.trim()
    ? `${source}:${externalId.trim()}`
    : `url:${sourceUrl.trim()}`;
  switch (scope) {
    case "player":
      return `${base}:${(playerId ?? "").trim()}`;
    case "team":
      return `${base}:team:${(team ?? "").trim()}`;
    case "league":
      return `${base}:league`;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
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
    tags: [],
    scope: "player",
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
    tags: [],
    scope: "player",
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
  // Practice reports / roundups often extract just "Amon-Ra" (→ "amon ra"),
  // which would otherwise miss Sleeper's "Amon-Ra St. Brown".
  "amon ra": "amon ra st brown",
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
  /** Optional Sleeper first_name — multi-token firsts (e.g. Amon-Ra) index too. */
  firstName?: string | null;
  /** Optional Sleeper last_name — compound lasts (e.g. St. Brown) index too. */
  lastName?: string | null;
};

function pushHit(map: Map<string, string[]>, key: string, playerId: string): void {
  if (!key) return;
  const ids = map.get(key) ?? [];
  ids.push(playerId);
  map.set(key, ids);
}

/**
 * Build lookup maps from roster rows. Ambiguous names are left out of
 * `byName` / `byNameTeam` / `byLastNameTeam` so callers cannot silently pick
 * the wrong player; use `player_id` or a unique name(+team) match instead.
 *
 * Also indexes unique multi-token first names (Amon-Ra → "amon ra") and
 * compound last names (St. Brown → "st brown"|team) when provided.
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
    if (nameKey) {
      pushHit(nameHits, nameKey, entry.playerId);
      pushHit(nameTeamHits, nameTeamKey(nameKey, team), entry.playerId);
      const last = lastNameFromKey(nameKey);
      if (last) pushHit(lastTeamHits, nameTeamKey(last, team), entry.playerId);
    }

    // Hyphenated / multi-token first names appear alone in beat reports.
    const firstKey = entry.firstName ? normalizePlayerNameKey(entry.firstName) : "";
    if (firstKey && playerNameTokenCount(firstKey) >= 2 && firstKey !== nameKey) {
      pushHit(nameHits, firstKey, entry.playerId);
      pushHit(nameTeamHits, nameTeamKey(firstKey, team), entry.playerId);
    }

    // Compound surnames (St. Brown) need the full last-name key, not only
    // the final token ("brown"), so "St. Brown"+DET resolves uniquely.
    const lastKeyFull = entry.lastName ? normalizePlayerNameKey(entry.lastName) : "";
    if (lastKeyFull && playerNameTokenCount(lastKeyFull) >= 2) {
      pushHit(lastTeamHits, nameTeamKey(lastKeyFull, team), entry.playerId);
      pushHit(nameTeamHits, nameTeamKey(lastKeyFull, team), entry.playerId);
    }
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
    // Compound surnames (e.g. "St. Brown") are multi-token but still live in
    // byLastNameTeam under the full last-name key when indexed from Sleeper.
    const compoundLast = index.byLastNameTeam.get(nameTeamKey(nameKey, team));
    if (compoundLast) {
      const meta = index.byId.get(compoundLast);
      if (meta) return { playerId: compoundLast, player: meta.player, team: meta.team };
    }
  }

  const byName = index.byName.get(nameKey);
  if (!byName) return null;
  const meta = index.byId.get(byName);
  return meta ? { playerId: byName, player: meta.player, team: meta.team } : null;
}

function xNewsDraftBase(item: XNewsItem): Omit<
  SharedNewsDraft,
  "id" | "playerId" | "player" | "team" | "scope"
> {
  const handle = item.author_handle.replace(/^@/, "");
  const postId = item.post_id.trim();
  return {
    change: item.text.trim(),
    newsType: signalToNewsType(item.signal),
    roleContext: `Posted by @${handle} on X.`,
    source: "x",
    sourceLabel: `@${handle}`,
    sourceUrl: item.source_url.trim(),
    author: `@${handle}`,
    externalId: postId,
    publishedAt: new Date(item.published_at),
    signal: item.signal?.trim() || null,
    score: item.score ?? null,
    tags: normalizeNewsTags(item.tags),
  };
}

export function buildXNewsDraft(
  item: XNewsItem,
  resolved: { playerId: string; player: string; team: string },
): SharedNewsDraft {
  const postId = item.post_id.trim();
  return {
    ...xNewsDraftBase(item),
    // Include playerId so the same X post can produce distinct PKs per player.
    id: stableNewsId(["x", postId, resolved.playerId]),
    playerId: resolved.playerId,
    player: resolved.player,
    team: resolved.team,
    scope: "player",
  };
}

/** One team-scoped row; no player resolve. `team` must already be canonical. */
export function buildXNewsTeamDraft(item: XNewsItem, team: NflNewsTeamCode): SharedNewsDraft {
  const postId = item.post_id.trim();
  return {
    ...xNewsDraftBase(item),
    id: stableNewsId(["x", postId, "team", team]),
    playerId: null,
    player: team,
    team,
    scope: "team",
  };
}

/** One league-scoped row; no player or team. */
export function buildXNewsLeagueDraft(item: XNewsItem): SharedNewsDraft {
  const postId = item.post_id.trim();
  return {
    ...xNewsDraftBase(item),
    id: stableNewsId(["x", postId, "league"]),
    playerId: null,
    player: "NFL",
    team: null,
    scope: "league",
  };
}

export function filterDuplicateDrafts(drafts: SharedNewsDraft[]): SharedNewsDraft[] {
  const seen = new Set<string>();
  const out: SharedNewsDraft[] = [];
  for (const draft of drafts) {
    const key = dedupeKey(
      draft.source,
      draft.externalId,
      draft.sourceUrl,
      draft.playerId,
      draft.scope,
      draft.team,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }
  return out;
}

/**
 * Pure ingest branching: player scope fans out via `resolvePlayerIds`; team and
 * league scopes write a single row each (no player attach).
 */
export function collectXNewsDrafts(
  items: ReadonlyArray<XNewsItem>,
  resolvePlayerIds: (item: XNewsItem) => string[],
  playerMeta: (playerId: string) => { player: string; team: string } | null,
): { drafts: SharedNewsDraft[]; unresolved: string[] } {
  const drafts: SharedNewsDraft[] = [];
  const unresolved: string[] = [];

  for (const item of items) {
    const scope = xNewsItemScope(item);
    switch (scope) {
      case "player": {
        const playerIds = resolvePlayerIds(item);
        if (playerIds.length === 0) {
          unresolved.push(item.player_id ?? item.player_name ?? item.post_id);
          break;
        }
        for (const playerId of playerIds) {
          const meta = playerMeta(playerId);
          if (!meta) continue;
          drafts.push(
            buildXNewsDraft(item, {
              playerId,
              player: meta.player,
              team: meta.team,
            }),
          );
        }
        break;
      }
      case "team": {
        const team = normalizeNewsTeam(item.team);
        if (!isValidNflNewsTeam(team)) {
          unresolved.push(item.team ?? item.post_id);
          break;
        }
        drafts.push(buildXNewsTeamDraft(item, team));
        break;
      }
      case "league": {
        drafts.push(buildXNewsLeagueDraft(item));
        break;
      }
      default: {
        const _exhaustive: never = scope;
        void _exhaustive;
        break;
      }
    }
  }

  return { drafts, unresolved };
}

export function asPlayerNewsSource(value: string): PlayerNewsSource {
  const parsed = sourceSchema.safeParse(value);
  return parsed.success ? parsed.data : "sleeper";
}

export function asPlayerNewsKind(value: string): PlayerNewsKind {
  const parsed = newsTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "roster";
}
