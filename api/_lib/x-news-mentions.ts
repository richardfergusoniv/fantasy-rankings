import {
  PLAYER_NAME_KEY_ALIASES,
  playerNameTokenCount,
  type PlayerNewsNameIndex,
  type PlayerNewsNameIndexEntry,
} from "./player-news-shared.js";

/**
 * In-repo half of Richard’s X → player-news-x producer contract:
 * expand post text into every uniquely resolvable Sleeper `player_id`.
 * The external pusher may still send a single extract; ingest attaches all
 * mentioned priority/roster names so roundups do not drop Amon-Ra et al.
 */

/** Soft cap so a viral mega-list cannot fan out unbounded rows. */
export const X_NEWS_MENTION_PLAYER_LIMIT = 20;

/** Minimum tokens for a mention needle (blocks bare surnames like "Brown"). */
export const X_NEWS_MENTION_MIN_TOKENS = 2;

export type XNewsMentionNeedle = {
  /** Space-separated lowercase key (no alias expansion). */
  needle: string;
  playerId: string;
};

/**
 * Normalize free text for needle scanning: lowercase, strip punctuation to
 * spaces, collapse A.J. → aj. Does **not** apply {@link PLAYER_NAME_KEY_ALIASES}
 * so short first names like "Amon-Ra" stay "amon ra".
 */
export function normalizeTextForMentions(text: string): string {
  const tokens = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Mirror player-news-shared collapseSingleLetterTokens (kept local to avoid
  // exporting a private helper for one call site).
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
  return collapsed.join(" ");
}

function addNeedle(
  map: Map<string, string | null>,
  needle: string,
  playerId: string,
): void {
  if (!needle || playerNameTokenCount(needle) < X_NEWS_MENTION_MIN_TOKENS) return;
  const existing = map.get(needle);
  if (existing === undefined) {
    map.set(needle, playerId);
    return;
  }
  if (existing !== null && existing !== playerId) {
    // Ambiguous needle — never attach silently.
    map.set(needle, null);
  }
}

/**
 * Build longest-first mention needles from the roster name index.
 * Includes unique full-name keys, reverse aliases, and multi-token first names.
 */
export function buildXNewsMentionNeedles(
  entries: ReadonlyArray<PlayerNewsNameIndexEntry>,
  index: PlayerNewsNameIndex,
): XNewsMentionNeedle[] {
  const map = new Map<string, string | null>();

  for (const [key, playerId] of index.byName) {
    addNeedle(map, key, playerId);
  }

  for (const [alias, canonical] of Object.entries(PLAYER_NAME_KEY_ALIASES)) {
    const playerId = index.byName.get(canonical);
    if (playerId) addNeedle(map, alias, playerId);
  }

  for (const entry of entries) {
    if (!index.byId.has(entry.playerId)) continue;
    const first = entry.firstName?.trim();
    if (!first) continue;
    // Raw first-name key (no alias expand) so "Amon-Ra" → "amon ra".
    const firstKey = normalizeTextForMentions(first);
    addNeedle(map, firstKey, entry.playerId);
  }

  return [...map.entries()]
    .flatMap(([needle, playerId]) => (playerId ? [{ needle, playerId }] : []))
    .sort((a, b) => {
      const tokenDiff = playerNameTokenCount(b.needle) - playerNameTokenCount(a.needle);
      if (tokenDiff !== 0) return tokenDiff;
      return b.needle.length - a.needle.length;
    });
}

/**
 * Find unique player ids mentioned in `text` via longest-first word-boundary
 * needle match. Overlapping shorter needles on an already-matched span are skipped.
 */
export function findMentionedPlayerIds(
  text: string,
  needles: ReadonlyArray<XNewsMentionNeedle>,
  limit = X_NEWS_MENTION_PLAYER_LIMIT,
): string[] {
  if (!text.trim() || needles.length === 0 || limit <= 0) return [];

  const haystack = ` ${normalizeTextForMentions(text)} `;
  if (haystack.trim().length === 0) return [];

  const used = new Array<boolean>(haystack.length).fill(false);
  const found: string[] = [];
  const seen = new Set<string>();

  for (const { needle, playerId } of needles) {
    if (found.length >= limit) break;
    if (seen.has(playerId)) continue;

    const pattern = ` ${needle} `;
    let from = 0;
    while (from < haystack.length) {
      const at = haystack.indexOf(pattern, from);
      if (at < 0) break;
      const start = at + 1; // skip leading space in pattern
      const end = start + needle.length;
      let overlaps = false;
      for (let i = start; i < end; i += 1) {
        if (used[i]) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = start; i < end; i += 1) used[i] = true;
        seen.add(playerId);
        found.push(playerId);
        break;
      }
      from = at + 1;
    }
  }

  return found;
}

/**
 * Union of the explicit resolve target (if any) and every text mention.
 * Dedupes; explicit id stays even when absent from the text.
 */
export function resolveXNewsPlayerIdsForItem(
  item: { player_id?: string; player_name?: string; team?: string; text: string },
  index: PlayerNewsNameIndex,
  needles: ReadonlyArray<XNewsMentionNeedle>,
  resolvePrimary: (
    item: { player_id?: string; player_name?: string; team?: string },
    index: PlayerNewsNameIndex,
  ) => { playerId: string } | null,
  limit = X_NEWS_MENTION_PLAYER_LIMIT,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (playerId: string) => {
    if (seen.has(playerId) || ids.length >= limit) return;
    if (!index.byId.has(playerId)) return;
    seen.add(playerId);
    ids.push(playerId);
  };

  const primary = resolvePrimary(item, index);
  if (primary) push(primary.playerId);

  for (const playerId of findMentionedPlayerIds(item.text, needles, limit)) {
    push(playerId);
  }

  return ids;
}
