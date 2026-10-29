import {
  PLAYER_NAME_KEY_ALIASES,
  playerNameTokenCount,
  type PlayerNewsNameIndex,
  type PlayerNewsNameIndexEntry,
} from "./player-news-shared.js";

/**
 * In-repo half of Richard’s X → player-news-x producer contract:
 * expand post text into uniquely resolvable Sleeper `player_id`s, subject to
 * attach caps (ranking mega-lists stay on the explicit extract only).
 */

/** Max players (explicit + text mentions) before text expansion is skipped. */
export const X_NEWS_ATTACH_PLAYER_CAP_DEFAULT = 6;

/** Higher attach cap when the post looks like a practice / injury report. */
export const X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT = 15;

/**
 * Scan ceiling when collecting mention candidates. Cap checks need at most
 * {@link X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT} + 1 distinct ids.
 */
export const X_NEWS_MENTION_SCAN_LIMIT = X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT + 1;

/** Minimum tokens for a mention needle (blocks bare surnames like "Brown"). */
export const X_NEWS_MENTION_MIN_TOKENS = 2;

/**
 * Case-insensitive practice / injury markers. Matched as whole tokens / phrases
 * against {@link normalizeTextForMentions} output (space-bounded).
 */
export const X_NEWS_PRACTICE_INJURY_MARKERS = [
  "did not practice",
  "full participant",
  "injury report",
  "practice report",
  "dnp",
  "limited",
  "lp",
  "fp",
  "questionable",
  "doubtful",
  "out",
  "estimated",
] as const;

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

/**
 * True when post text looks like a practice / injury report (raises the
 * attach cap to {@link X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT}).
 */
export function looksLikeXNewsPracticeOrInjuryReport(text: string): boolean {
  const haystack = ` ${normalizeTextForMentions(text)} `;
  if (haystack.trim().length === 0) return false;
  for (const marker of X_NEWS_PRACTICE_INJURY_MARKERS) {
    const needle = ` ${normalizeTextForMentions(marker)} `;
    if (haystack.includes(needle)) return true;
  }
  return false;
}

/** Attach cap for this post text (default vs practice / injury report). */
export function xNewsAttachPlayerCap(text: string): number {
  return looksLikeXNewsPracticeOrInjuryReport(text)
    ? X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT
    : X_NEWS_ATTACH_PLAYER_CAP_DEFAULT;
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
  limit = X_NEWS_MENTION_SCAN_LIMIT,
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
 * Union of the explicit resolve target (if any) and text mentions, subject to
 * attach caps:
 * - Explicit `player_id` / name extract always attaches when resolvable.
 * - Text expansion runs only when |explicit ∪ mentions| ≤ cap (6, or 15 for
 *   practice / injury reports). Above the cap, skip expansion entirely —
 *   do not truncate to the first N mentions.
 */
export function resolveXNewsPlayerIdsForItem(
  item: { player_id?: string; player_name?: string; team?: string; text: string },
  index: PlayerNewsNameIndex,
  needles: ReadonlyArray<XNewsMentionNeedle>,
  resolvePrimary: (
    item: { player_id?: string; player_name?: string; team?: string },
    index: PlayerNewsNameIndex,
  ) => { playerId: string } | null,
): string[] {
  const cap = xNewsAttachPlayerCap(item.text);

  const explicit: string[] = [];
  const seen = new Set<string>();
  const push = (playerId: string, into: string[]) => {
    if (seen.has(playerId)) return;
    if (!index.byId.has(playerId)) return;
    seen.add(playerId);
    into.push(playerId);
  };

  const primary = resolvePrimary(item, index);
  if (primary) push(primary.playerId, explicit);

  // Need cap+1 distinct candidates in the union to know expansion would overflow.
  const mentioned = findMentionedPlayerIds(item.text, needles, cap + 1);
  const union = [...explicit];
  for (const playerId of mentioned) {
    push(playerId, union);
  }

  if (union.length > cap) {
    return explicit;
  }
  return union;
}
