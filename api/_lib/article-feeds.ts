import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { encodeSourceCachePayload, decodeSourceCachePayload } from "./source-cache-payload.js";
import { isHttpOrHttpsUrl } from "./http-url.js";
import { loadNflPlayersMap } from "./nfl-players-cache.js";
import {
  X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT,
  buildXNewsMentionNeedles,
  findMentionedPlayerIds,
  normalizeTextForMentions,
  xNewsAttachPlayerCap,
  type XNewsMentionNeedle,
} from "./x-news-mentions.js";
import {
  NFL_NEWS_TEAM_CODES,
  buildPlayerNewsNameIndex,
  filterDuplicateDrafts,
  isValidNflNewsTeam,
  normalizeNewsTeam,
  retentionCutoff,
  stableNewsId,
  type NflNewsTeamCode,
  type PlayerNewsNameIndex,
  type PlayerNewsNameIndexEntry,
  type SharedNewsDraft,
} from "./player-news-shared.js";
import { sportsTeamCodes } from "./team-situational.js";

/**
 * Poll RSS/Atom article feeds into shared_player_news (source='article').
 * Invoked as cron job `refresh-article-feeds` — no new Vercel function.
 */

export const ARTICLE_FEEDS_CACHE_KEY = "article-feeds-v1";
export const ARTICLE_FEEDS_USER_AGENT = "fantasy-rankings-article-feeds/1.0 (+https://github.com/richardfergusoniv/fantasy-rankings)";
export const ARTICLE_FEED_TIMEOUT_MS = 8_000;
export const ARTICLE_PAGE_TIMEOUT_MS = 5_000;
export const ARTICLE_FEEDS_JOB_BUDGET_MS = 50_000;
export const ARTICLE_SUMMARY_MAX_CHARS = 280;

/** Tracking / share params stripped for canonical URL dedupe. */
const TRACKING_QUERY_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "gbraid", "wbraid", "mc_cid", "mc_eid", "igshid", "si",
  "ref", "ref_src", "s", "smid", "ncid",
]);

export type ArticleFeedAllowlist =
  | { kind: "category"; values: readonly string[] }
  | { kind: "path"; prefixes: readonly string[] }
  | { kind: "none" };

export type ArticleFeedSource = {
  name: string;
  domain: string;
  feedUrl: string;
  allowlist: ArticleFeedAllowlist;
  /** Soft signal for ranking; not used to drop items. */
  downrank: boolean;
  /** Known team for beat blogs (last-name + team matching). */
  teamHint?: NflNewsTeamCode;
  /** Strip a fixed title prefix before filtering / storage. */
  titlePrefixStrip?: string;
  /** When true, fetch each new article page to detect PFF premium paywall. */
  checkPffPremium?: boolean;
};

/**
 * Working native feeds only. Skipped (Richard): paywalled Athletic / Fantasy Points,
 * RotoWire news blurbs, Google-News-only USA Today / SI / Pewter / CFR / Denver Post /
 * Sun Sentinel, and unusable ESPN / ETR / 4for4 / etc.
 */
export const ARTICLE_FEED_SOURCES: readonly ArticleFeedSource[] = [
  {
    name: "FantasyPros",
    domain: "fantasypros.com",
    feedUrl: "https://www.fantasypros.com/feed/",
    allowlist: { kind: "category", values: ["NFL"] },
    downrank: false,
  },
  {
    name: "RotoWire",
    domain: "rotowire.com",
    feedUrl: "https://www.rotowire.com/rss/articles.php?sport=NFL",
    allowlist: { kind: "none" },
    downrank: false,
    titlePrefixStrip: "New RotoWire NFL article:",
  },
  {
    name: "NBC Sports",
    domain: "nbcsports.com",
    feedUrl: "https://www.nbcsports.com/fantasy/football.rss",
    allowlist: { kind: "none" },
    downrank: false,
  },
  {
    name: "ProFootballTalk",
    domain: "nbcsports.com",
    feedUrl: "https://www.nbcsports.com/profootballtalk.rss",
    allowlist: { kind: "none" },
    downrank: false,
  },
  {
    name: "PFF",
    domain: "pff.com",
    feedUrl: "https://www.pff.com/feed",
    allowlist: {
      kind: "category",
      values: ["NFL", "Fantasy", "Team & Player News", "Team and Player News"],
    },
    downrank: false,
    checkPffPremium: true,
  },
  {
    name: "Yahoo Sports",
    domain: "sports.yahoo.com",
    feedUrl: "https://sports.yahoo.com/nfl/rss/",
    allowlist: { kind: "none" },
    downrank: false,
  },
  {
    name: "PFN",
    domain: "profootballnetwork.com",
    feedUrl: "https://www.profootballnetwork.com/fantasy-football/feed/",
    allowlist: { kind: "none" },
    downrank: false,
  },
  {
    name: "RotoViz",
    domain: "rotoviz.com",
    feedUrl: "https://www.rotoviz.com/feed/",
    allowlist: { kind: "none" },
    downrank: false,
  },
  {
    name: "FantasyLabs",
    domain: "fantasylabs.com",
    feedUrl: "https://www.fantasylabs.com/feed/",
    allowlist: { kind: "none" },
    downrank: true,
  },
  {
    name: "Acme Packing Company",
    domain: "acmepackingcompany.com",
    feedUrl: "https://www.acmepackingcompany.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "GB",
  },
  {
    name: "Arrowhead Pride",
    domain: "arrowheadpride.com",
    feedUrl: "https://www.arrowheadpride.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "KC",
  },
  {
    name: "Bolts From The Blue",
    domain: "boltsfromtheblue.com",
    feedUrl: "https://www.boltsfromtheblue.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "LAC",
  },
  {
    name: "Turf Show Times",
    domain: "turfshowtimes.com",
    feedUrl: "https://www.turfshowtimes.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "LAR",
  },
  {
    name: "Big Blue View",
    domain: "bigblueview.com",
    feedUrl: "https://www.bigblueview.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "NYG",
  },
  {
    name: "The Phinsider",
    domain: "thephinsider.com",
    feedUrl: "https://www.thephinsider.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "MIA",
  },
  {
    name: "Stampede Blue",
    domain: "stampedeblue.com",
    feedUrl: "https://www.stampedeblue.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "IND",
  },
  {
    name: "Big Cat Country",
    domain: "bigcatcountry.com",
    feedUrl: "https://www.bigcatcountry.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "JAX",
  },
  {
    name: "Hogs Haven",
    domain: "hogshaven.com",
    feedUrl: "https://www.hogshaven.com/rss/index.xml",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "WAS",
  },
  {
    name: "JoeBucsFan",
    domain: "joebucsfan.com",
    feedUrl: "https://www.joebucsfan.com/feed/",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "TB",
  },
  {
    name: "Raiders Beat",
    domain: "raidersbeat.com",
    feedUrl: "https://raidersbeat.com/feed/",
    allowlist: { kind: "none" },
    downrank: false,
    teamHint: "LV",
  },
];

// ---------------------------------------------------------------------------
// Cache payload (ETag validators + PFF premium verdicts)
// ---------------------------------------------------------------------------

export type FeedValidator = {
  etag?: string;
  lastModified?: string;
};

export type ArticleFeedsCachePayload = {
  feeds: Record<string, FeedValidator>;
  /** guid or canonical URL → true when premium (skip), false when free. */
  pffPremium: Record<string, boolean>;
};

export function emptyArticleFeedsCache(): ArticleFeedsCachePayload {
  return { feeds: {}, pffPremium: {} };
}

export function parseArticleFeedsCache(raw: string | null | undefined): ArticleFeedsCachePayload {
  if (!raw) return emptyArticleFeedsCache();
  try {
    const value: unknown = decodeSourceCachePayload(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptyArticleFeedsCache();
    const record = value as { feeds?: unknown; pffPremium?: unknown };
    const feeds: Record<string, FeedValidator> = {};
    if (record.feeds && typeof record.feeds === "object" && !Array.isArray(record.feeds)) {
      for (const [key, entry] of Object.entries(record.feeds as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const row = entry as { etag?: unknown; lastModified?: unknown };
        feeds[key] = {
          ...(typeof row.etag === "string" ? { etag: row.etag } : {}),
          ...(typeof row.lastModified === "string" ? { lastModified: row.lastModified } : {}),
        };
      }
    }
    const pffPremium: Record<string, boolean> = {};
    if (record.pffPremium && typeof record.pffPremium === "object" && !Array.isArray(record.pffPremium)) {
      for (const [key, verdict] of Object.entries(record.pffPremium as Record<string, unknown>)) {
        if (typeof verdict === "boolean") pffPremium[key] = verdict;
      }
    }
    return { feeds, pffPremium };
  } catch {
    return emptyArticleFeedsCache();
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => {
      const code = Number.parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

export function stripHtml(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSummary(value: string, max = ARTICLE_SUMMARY_MAX_CHARS): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const available = Math.max(1, max - 1);
  const candidate = clean.slice(0, available);
  const lastSpace = candidate.lastIndexOf(" ");
  const clipped = lastSpace >= Math.floor(available * 0.62) ? candidate.slice(0, lastSpace) : candidate;
  return `${clipped.trimEnd()}…`;
}

export function canonicalArticleUrl(rawUrl: string): string | null {
  if (!rawUrl.trim() || !isHttpOrHttpsUrl(rawUrl.trim())) return null;
  try {
    const url = new URL(rawUrl.trim());
    url.hash = "";
    const kept = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) continue;
      kept.append(key, value);
    }
    url.search = kept.toString() ? `?${kept.toString()}` : "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Stable non-null external_id for article rows. Team/league unique indexes from
 * 0016 are partial on `external_id IS NOT NULL` (no source_url uniques), so every
 * article row must set this — hash of the canonical URL, not a flaky feed guid.
 */
export function articleExternalId(canonicalUrl: string): string {
  return stableNewsId(["article-url", canonicalUrl]);
}

export function normalizeHeadlineKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Headline filter
// ---------------------------------------------------------------------------

const OTHER_SPORTS_RE =
  /\b(nba|mlb|nhl|wnba|mlb|ncaa|cfb|college football|ncaaf|march madness|ufc|mma|pga|golf|soccer|premier league|mls|formula\s*1|f1|tennis|wimbledon|world series|stanley cup|olympics)\b/i;

const BETTING_RE =
  /\b(promo code|betting bonus|best bets?|odds|props?|parlay|against the spread|\bats\b|spread picks?|moneyline|over\/under|betting odds|sportsbook|draftkings promo|fanduel promo|predictions?)\b/i;

const HOW_TO_WATCH_RE =
  /\b(how to watch|where to watch|kickoff time|start time|tv (?:channel|schedule)|live stream|streaming options)\b/i;

const GALLERY_RE = /\b(photos?|gallery|photo gallery|best pictures)\b/i;
const MOCK_DRAFT_RE = /\b(mock draft|7[- ]round mock)\b/i;
const QUIZ_RE = /\b(quiz|poll|trivia)\b/i;
const MERCH_RE = /\b(uniforms?|tickets?|merch|merchandise|giveaway|coupon)\b/i;
const HOT_TAKE_RE = /\b(skip bayless|stephen a\.? smith|hot take|unpopular opinion)\b/i;

/** Roster-action / fantasy-relevance terms that keep an item without a player name. */
export const ROSTER_ACTION_RE =
  /\b(injury(?:\s+status|\s+report)?|placed on ir|\bir\b|activated|signed|released|waived|traded|trade|depth chart|starter|starting|role|snaps?|usage|targets?|routes?|backfield|waiver|waivers|start\/sit|start-sit|buy[- ]low|sell[- ]high|stash|rankings?|practice report|did not practice|full participant|limited|questionable|doubtful|ruled out|out for|week[- ]to[- ]week|pup|nfi)\b/i;

export type HeadlineFilterInput = {
  title: string;
  url: string;
  summary?: string;
  categories?: readonly string[];
};

export type HeadlineFilterResult =
  | { pass: true; reason: "player_or_roster" }
  | { pass: false; reason: string };

export function passesHeadlineNoiseFilter(input: HeadlineFilterInput): HeadlineFilterResult {
  const title = input.title.trim();
  const url = input.url.trim();
  const blob = `${title} ${url}`;
  if (OTHER_SPORTS_RE.test(blob)) return { pass: false, reason: "other_sports" };
  if (BETTING_RE.test(blob)) return { pass: false, reason: "betting" };
  if (HOW_TO_WATCH_RE.test(blob)) return { pass: false, reason: "how_to_watch" };
  if (GALLERY_RE.test(title)) return { pass: false, reason: "gallery" };
  if (MOCK_DRAFT_RE.test(blob)) return { pass: false, reason: "mock_draft" };
  if (QUIZ_RE.test(title)) return { pass: false, reason: "quiz" };
  if (MERCH_RE.test(blob)) return { pass: false, reason: "merch" };
  if (HOT_TAKE_RE.test(blob)) return { pass: false, reason: "hot_take" };
  return { pass: true, reason: "player_or_roster" };
}

export function passesSourceAllowlist(
  source: ArticleFeedSource,
  input: HeadlineFilterInput,
): boolean {
  switch (source.allowlist.kind) {
    case "none":
      return true;
    case "category": {
      const cats = (input.categories ?? []).map((c) => c.trim().toLowerCase());
      if (cats.length === 0) {
        // PFF / FantasyPros without categories: fall through on path/title NFL hints.
        const blob = `${input.title} ${input.url}`.toLowerCase();
        return source.allowlist.values.some((v) => blob.includes(v.toLowerCase()));
      }
      return source.allowlist.values.some((v) => cats.includes(v.toLowerCase()));
    }
    case "path": {
      try {
        const path = new URL(input.url).pathname.toLowerCase();
        return source.allowlist.prefixes.some((prefix) => path.startsWith(prefix.toLowerCase()));
      } catch {
        return false;
      }
    }
    default: {
      const _exhaustive: never = source.allowlist;
      void _exhaustive;
      return false;
    }
  }
}

export function hasRosterActionTerm(title: string, summary = ""): boolean {
  return ROSTER_ACTION_RE.test(`${title} ${summary}`);
}

/**
 * Full headline filter: noise drop → allowlist → player mention or roster-action.
 * `hasPlayerMention` is supplied by the caller (name index available at job time).
 */
export function filterArticleHeadline(
  source: ArticleFeedSource,
  input: HeadlineFilterInput,
  hasPlayerMention: boolean,
): HeadlineFilterResult {
  const noise = passesHeadlineNoiseFilter(input);
  if (!noise.pass) return noise;
  if (!passesSourceAllowlist(source, input)) {
    return { pass: false, reason: "allowlist" };
  }
  if (hasPlayerMention || hasRosterActionTerm(input.title, input.summary ?? "")) {
    return { pass: true, reason: "player_or_roster" };
  }
  return { pass: false, reason: "no_player_or_roster" };
}

// ---------------------------------------------------------------------------
// Feed parsing (RSS 2.0 + Atom)
// ---------------------------------------------------------------------------

export type ParsedFeedItem = {
  title: string;
  url: string;
  guid: string;
  publishedAt: Date | null;
  summary: string;
  categories: string[];
};

function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const match = block.match(re);
  return match?.[1] ? stripHtml(match[1]) : "";
}

function tagAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["'][^>]*/?>`, "i");
  const match = block.match(re);
  return match?.[1]?.trim() ?? "";
}

function parseRssCategories(block: string): string[] {
  const out: string[] = [];
  for (const match of block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)) {
    const text = stripHtml(match[1] ?? "");
    if (text) out.push(text);
  }
  for (const match of block.matchAll(/<category\b[^>]*\bterm\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const text = decodeXmlEntities(match[1] ?? "").trim();
    if (text) out.push(text);
  }
  return [...new Set(out)];
}

function parseDate(raw: string): Date | null {
  if (!raw.trim()) return null;
  const ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function parseRssItem(block: string): ParsedFeedItem | null {
  const title = tagText(block, "title");
  const link = tagText(block, "link") || tagAttr(block, "link", "href");
  const guid = tagText(block, "guid") || link;
  const pubDate = tagText(block, "pubDate") || tagText(block, "dc:date");
  const description = tagText(block, "description") || tagText(block, "content:encoded");
  if (!title || !link) return null;
  const url = canonicalArticleUrl(link) ?? link.trim();
  return {
    title,
    url,
    guid: guid || url,
    publishedAt: parseDate(pubDate),
    summary: truncateSummary(description),
    categories: parseRssCategories(block),
  };
}

function parseAtomEntry(block: string): ParsedFeedItem | null {
  const title = tagText(block, "title");
  // Prefer rel="alternate" even when a rel="self"/enclosure link appears first.
  const alternate = block.match(/<link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)
    ?? block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']alternate["'][^>]*>/i);
  let link = alternate?.[1]?.trim() ?? "";
  if (!link) {
    for (const match of block.matchAll(/<link\b([^>]*)>/gi)) {
      const attrs = match[1] ?? "";
      if (/\brel\s*=\s*["'](?:self|enclosure|related|via)["']/i.test(attrs)) continue;
      const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      if (href?.[1]) {
        link = href[1].trim();
        break;
      }
    }
  }
  if (!link) link = tagText(block, "link");
  const id = tagText(block, "id") || link;
  const published = tagText(block, "published") || tagText(block, "updated");
  const summary = tagText(block, "summary") || tagText(block, "content");
  if (!title || !link) return null;
  const url = canonicalArticleUrl(link) ?? link.trim();
  return {
    title,
    url,
    guid: id || url,
    publishedAt: parseDate(published),
    summary: truncateSummary(summary),
    categories: parseRssCategories(block),
  };
}

export function parseFeedXml(xml: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const parsed = parseRssItem(match[1] ?? "");
    if (!parsed) continue;
    const key = parsed.guid || parsed.url;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const parsed = parseAtomEntry(match[1] ?? "");
    if (!parsed) continue;
    const key = parsed.guid || parsed.url;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }
  return items;
}

// ---------------------------------------------------------------------------
// PFF premium detection
// ---------------------------------------------------------------------------

export function detectPffPremiumFromHtml(html: string): boolean {
  if (/PremiumArticlePaywall/i.test(html)) return true;
  if (/"isAccessibleForFree"\s*:\s*"false"/i.test(html)) return true;
  if (/"isAccessibleForFree"\s*:\s*false\b/i.test(html)) return true;
  return false;
}

export async function fetchTextWithTimeout(
  url: string,
  options: {
    timeoutMs: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<{ ok: boolean; status: number; body: string; etag?: string; lastModified?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": ARTICLE_FEEDS_USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
        ...options.headers,
      },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    };
  } catch {
    return { ok: false, status: 0, body: "" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

// ---------------------------------------------------------------------------
// Player / team matching
// ---------------------------------------------------------------------------

const FANTASY_ARTICLE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K"]);

export function isArticleEligiblePlayer(
  entry: PlayerNewsNameIndexEntry & { position?: string | null },
): boolean {
  const position = (entry.position ?? "").toUpperCase();
  if (!FANTASY_ARTICLE_POSITIONS.has(position)) return false;
  const team = normalizeNewsTeam(entry.team);
  return isValidNflNewsTeam(team);
}

/**
 * Multi-word / nickname needles for team detection. Word-boundary matched on
 * normalized text so ordinary words like "was" / "no" are not treated as WAS / NO.
 */
const ARTICLE_TEAM_NAME_NEEDLES: ReadonlyArray<{ needle: string; code: NflNewsTeamCode }> = [
  { needle: "arizona cardinals", code: "ARI" }, { needle: "cardinals", code: "ARI" },
  { needle: "atlanta falcons", code: "ATL" }, { needle: "falcons", code: "ATL" },
  { needle: "baltimore ravens", code: "BAL" }, { needle: "ravens", code: "BAL" },
  { needle: "buffalo bills", code: "BUF" }, { needle: "bills", code: "BUF" },
  { needle: "carolina panthers", code: "CAR" }, { needle: "panthers", code: "CAR" },
  { needle: "chicago bears", code: "CHI" }, { needle: "bears", code: "CHI" },
  { needle: "cincinnati bengals", code: "CIN" }, { needle: "bengals", code: "CIN" },
  { needle: "cleveland browns", code: "CLE" }, { needle: "browns", code: "CLE" },
  { needle: "dallas cowboys", code: "DAL" }, { needle: "cowboys", code: "DAL" },
  { needle: "denver broncos", code: "DEN" }, { needle: "broncos", code: "DEN" },
  { needle: "detroit lions", code: "DET" }, { needle: "lions", code: "DET" },
  { needle: "green bay packers", code: "GB" }, { needle: "packers", code: "GB" },
  { needle: "houston texans", code: "HOU" }, { needle: "texans", code: "HOU" },
  { needle: "indianapolis colts", code: "IND" }, { needle: "colts", code: "IND" },
  { needle: "jacksonville jaguars", code: "JAX" }, { needle: "jaguars", code: "JAX" },
  { needle: "kansas city chiefs", code: "KC" }, { needle: "chiefs", code: "KC" },
  { needle: "las vegas raiders", code: "LV" }, { needle: "raiders", code: "LV" },
  { needle: "los angeles chargers", code: "LAC" }, { needle: "chargers", code: "LAC" },
  { needle: "los angeles rams", code: "LAR" }, { needle: "rams", code: "LAR" },
  { needle: "miami dolphins", code: "MIA" }, { needle: "dolphins", code: "MIA" },
  { needle: "minnesota vikings", code: "MIN" }, { needle: "vikings", code: "MIN" },
  { needle: "new england patriots", code: "NE" }, { needle: "patriots", code: "NE" },
  { needle: "new orleans saints", code: "NO" }, { needle: "saints", code: "NO" },
  { needle: "new york giants", code: "NYG" }, { needle: "giants", code: "NYG" },
  { needle: "new york jets", code: "NYJ" }, { needle: "jets", code: "NYJ" },
  { needle: "philadelphia eagles", code: "PHI" }, { needle: "eagles", code: "PHI" },
  { needle: "pittsburgh steelers", code: "PIT" }, { needle: "steelers", code: "PIT" },
  { needle: "san francisco 49ers", code: "SF" }, { needle: "49ers", code: "SF" },
  { needle: "seattle seahawks", code: "SEA" }, { needle: "seahawks", code: "SEA" },
  { needle: "tampa bay buccaneers", code: "TB" }, { needle: "buccaneers", code: "TB" },
  { needle: "tennessee titans", code: "TEN" }, { needle: "titans", code: "TEN" },
  { needle: "washington commanders", code: "WAS" }, { needle: "commanders", code: "WAS" },
];

/**
 * Detect a single NFL team from article text / URL / feed hint.
 * Returns null when zero or multiple teams are mentioned (ambiguous).
 * Bare abbreviations like WAS/NO are only accepted when written in ALL CAPS
 * so ordinary words ("was", "no") do not steal the match.
 */
export function detectArticleTeam(
  text: string,
  options?: { teamHint?: NflNewsTeamCode | null; url?: string },
): NflNewsTeamCode | null {
  if (options?.teamHint && isValidNflNewsTeam(options.teamHint)) {
    return options.teamHint;
  }
  const haystack = `${text} ${options?.url ?? ""}`;
  const codes = new Set<string>();

  // Longest nickname / full-name needles first.
  const normalized = ` ${normalizeTextForMentions(haystack)} `;
  const needles = [...ARTICLE_TEAM_NAME_NEEDLES].sort((a, b) => b.needle.length - a.needle.length);
  for (const { needle, code } of needles) {
    if (normalized.includes(` ${needle} `)) codes.add(code);
  }

  // Bare team codes only as uppercase tokens in the original text (not "was"/"no").
  for (const code of NFL_NEWS_TEAM_CODES) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${code}(?:[^A-Za-z0-9]|$)`);
    if (re.test(haystack)) codes.add(code);
  }

  // URL path team hints via sportsTeamCodes (short exact codes / names only).
  if (options?.url) {
    for (const code of sportsTeamCodes(options.url)) {
      const normalizedCode = normalizeNewsTeam(code);
      if (isValidNflNewsTeam(normalizedCode)) codes.add(normalizedCode);
    }
  }

  if (codes.size === 1) return [...codes][0] as NflNewsTeamCode;
  return null;
}

/**
 * Match players mentioned in title+summary.
 * Full first+last (and aliases) via mention needles; last-name-only only when
 * `team` is known and the surname is unique on that roster.
 */
export function matchArticlePlayers(
  text: string,
  index: PlayerNewsNameIndex,
  needles: ReadonlyArray<XNewsMentionNeedle>,
  team: NflNewsTeamCode | null,
): string[] {
  const capScan = X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT + 1;
  const fullNameHits = findMentionedPlayerIds(text, needles, capScan);
  const seen = new Set(fullNameHits);
  const out = [...fullNameHits];

  // Last names already covered by a full-name hit must not attach a different
  // teammate with the same surname via teamHint (e.g. "Josh Allen" on a
  // Packers blog must not also match a GB Allen).
  const claimedLastNames = new Set<string>();
  for (const playerId of fullNameHits) {
    const meta = index.byId.get(playerId);
    if (!meta) continue;
    const last = normalizeTextForMentions(meta.player).split(/\s+/).filter(Boolean).at(-1);
    if (last) claimedLastNames.add(last);
  }

  if (team) {
    const haystack = ` ${normalizeTextForMentions(text)} `;
    for (const [key, playerId] of index.byLastNameTeam) {
      if (!key.endsWith(`|${team}`)) continue;
      const lastKey = key.slice(0, -(team.length + 1));
      if (!lastKey || seen.has(playerId)) continue;
      if (claimedLastNames.has(lastKey.split(/\s+/).at(-1) ?? lastKey)) continue;
      if (!haystack.includes(` ${lastKey} `)) continue;
      seen.add(playerId);
      out.push(playerId);
      if (out.length >= capScan) break;
    }
  }

  return out;
}

/**
 * Apply fan-out cap: ≤6 players (15 for practice/injury), else empty → caller
 * stores one league row instead.
 */
export function applyArticlePlayerCap(playerIds: readonly string[], text: string): {
  playerIds: string[];
  overCap: boolean;
} {
  const cap = xNewsAttachPlayerCap(text);
  if (playerIds.length > cap) {
    return { playerIds: [], overCap: true };
  }
  return { playerIds: [...playerIds], overCap: false };
}

export type ArticleScopeAssignment =
  | { scope: "player"; playerIds: string[] }
  | { scope: "team"; team: NflNewsTeamCode }
  | { scope: "league" }
  | { scope: "drop"; reason: string };

/**
 * Decide scope for a filtered article: player fan-out, team-only, league, or drop.
 */
export function assignArticleScope(input: {
  text: string;
  matchedPlayerIds: readonly string[];
  team: NflNewsTeamCode | null;
  fantasyRelevant: boolean;
}): ArticleScopeAssignment {
  const { playerIds, overCap } = applyArticlePlayerCap(input.matchedPlayerIds, input.text);
  if (overCap) {
    return { scope: "league" };
  }
  if (playerIds.length > 0) {
    return { scope: "player", playerIds };
  }
  if (input.team) {
    return { scope: "team", team: input.team };
  }
  if (input.fantasyRelevant) {
    return { scope: "league" };
  }
  return { scope: "drop", reason: "no_scope" };
}

export function buildArticleNewsDrafts(input: {
  source: ArticleFeedSource;
  item: ParsedFeedItem;
  headline: string;
  summary: string;
  assignment: Exclude<ArticleScopeAssignment, { scope: "drop" }>;
  playerMeta: (playerId: string) => { player: string; team: string } | null;
}): SharedNewsDraft[] {
  const { source, item, headline, summary, assignment, playerMeta } = input;
  const publishedAt = item.publishedAt;
  const sourceUrl = canonicalArticleUrl(item.url) ?? item.url;
  // Always set external_id so team/league partial uniques (0016) and the
  // player (source, external_id, player_id) unique can dedupe on conflict.
  const externalId = articleExternalId(sourceUrl);
  const base = {
    change: headline,
    newsType: "headline" as const,
    roleContext: summary,
    source: "article" as const,
    sourceLabel: source.name,
    sourceUrl,
    author: null,
    externalId,
    publishedAt,
    signal: null,
    // Explicit scores: null sorts as -1 in the ticker, so a "downrank" value of
    // 40 would incorrectly outrank ordinary articles. Baseline 55 / downrank 15.
    score: source.downrank ? 15 : 55,
    tags: [] as string[],
  };

  switch (assignment.scope) {
    case "player": {
      const drafts: SharedNewsDraft[] = [];
      for (const playerId of assignment.playerIds) {
        const meta = playerMeta(playerId);
        if (!meta) continue;
        drafts.push({
          ...base,
          id: stableNewsId(["article", externalId, playerId]),
          playerId,
          player: meta.player,
          team: meta.team,
          scope: "player",
        });
      }
      return drafts;
    }
    case "team":
      return [{
        ...base,
        id: stableNewsId(["article", externalId, "team", assignment.team]),
        playerId: null,
        player: assignment.team,
        team: assignment.team,
        scope: "team",
      }];
    case "league":
      return [{
        ...base,
        id: stableNewsId(["article", externalId, "league"]),
        playerId: null,
        player: "NFL",
        team: null,
        scope: "league",
      }];
    default: {
      const _exhaustive: never = assignment;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Job orchestration
// ---------------------------------------------------------------------------

export type ArticleFeedRunStatus = {
  name: string;
  feedUrl: string;
  status: "ok" | "not_modified" | "http_error" | "timeout" | "parse_error" | "skipped_budget";
  httpStatus: number;
  itemsSeen: number;
  itemsPassed: number;
  itemsInserted: number;
  premiumSkipped: number;
  error?: string;
};

export type RefreshArticleFeedsResult = {
  ok: true;
  job: "refresh-article-feeds";
  worked: true;
  feeds: ArticleFeedRunStatus[];
  inserted: number;
  purged: number;
  durationMs: number;
};

function playerLabel(player: { full_name?: string | null; first_name?: string | null; last_name?: string | null }): string {
  return player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
}

async function loadArticleNameIndex(): Promise<{
  index: PlayerNewsNameIndex;
  needles: XNewsMentionNeedle[];
}> {
  const players = await loadNflPlayersMap(false);
  const entries: Array<PlayerNewsNameIndexEntry & { position?: string | null }> = [];
  for (const [playerId, player] of Object.entries(players)) {
    const name = playerLabel(player);
    if (!name) continue;
    const entry = {
      playerId,
      player: name,
      team: player.team ?? "FA",
      firstName: player.first_name ?? null,
      lastName: player.last_name ?? null,
      position: player.position ?? null,
    };
    if (!isArticleEligiblePlayer(entry)) continue;
    entries.push(entry);
  }
  const index = buildPlayerNewsNameIndex(entries);
  const needles = buildXNewsMentionNeedles(entries, index);
  return { index, needles };
}

async function readFeedsCache(): Promise<ArticleFeedsCachePayload> {
  const rows = await db
    .select({ payload: schema.sourceCache.payload })
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, ARTICLE_FEEDS_CACHE_KEY))
    .limit(1);
  return parseArticleFeedsCache(rows[0]?.payload);
}

async function writeFeedsCache(payload: ArticleFeedsCachePayload): Promise<void> {
  const encoded = encodeSourceCachePayload(payload);
  await db
    .insert(schema.sourceCache)
    .values({
      cacheKey: ARTICLE_FEEDS_CACHE_KEY,
      payload: encoded,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: {
        payload: encoded,
        fetchedAt: new Date(),
      },
    });
}

async function loadRecentHeadlineKeys(now: Date): Promise<Set<string>> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ change: schema.sharedPlayerNews.change })
    .from(schema.sharedPlayerNews)
    .where(
      and(
        eq(schema.sharedPlayerNews.source, "article"),
        or(
          and(
            sql`${schema.sharedPlayerNews.publishedAt} is not null`,
            gte(schema.sharedPlayerNews.publishedAt, cutoff),
          ),
          and(
            isNull(schema.sharedPlayerNews.publishedAt),
            gte(schema.sharedPlayerNews.createdAt, cutoff),
          ),
        ),
      ),
    )
    .orderBy(desc(sql`coalesce(${schema.sharedPlayerNews.publishedAt}, ${schema.sharedPlayerNews.createdAt})`))
    .limit(2_000);
  const keys = new Set<string>();
  for (const row of rows) {
    const key = normalizeHeadlineKey(row.change);
    if (key) keys.add(key);
  }
  return keys;
}

async function insertArticleDrafts(drafts: SharedNewsDraft[]): Promise<number> {
  const unique = filterDuplicateDrafts(drafts);
  if (unique.length === 0) return 0;
  let inserted = 0;
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100).map((draft) => ({
      id: draft.id,
      playerId: draft.playerId,
      player: draft.player,
      team: draft.team,
      change: draft.change,
      newsType: draft.newsType,
      roleContext: draft.roleContext,
      source: draft.source,
      sourceLabel: draft.sourceLabel,
      sourceUrl: draft.sourceUrl,
      author: draft.author,
      externalId: draft.externalId,
      publishedAt: draft.publishedAt,
      signal: draft.signal,
      score: draft.score,
      tags: draft.tags,
      scope: draft.scope,
      createdAt: new Date(),
    }));
    const result = await db
      .insert(schema.sharedPlayerNews)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: schema.sharedPlayerNews.id });
    inserted += result.length;
  }
  return inserted;
}

async function purgeExpiredArticleNews(now = new Date()): Promise<number> {
  const cutoff = retentionCutoff(now);
  const deleted = await db
    .delete(schema.sharedPlayerNews)
    .where(
      or(
        and(
          sql`${schema.sharedPlayerNews.publishedAt} is not null`,
          lt(schema.sharedPlayerNews.publishedAt, cutoff),
        ),
        and(
          isNull(schema.sharedPlayerNews.publishedAt),
          lt(schema.sharedPlayerNews.createdAt, cutoff),
        ),
      ),
    )
    .returning({ id: schema.sharedPlayerNews.id });
  return deleted.length;
}

async function resolvePffPremium(input: {
  item: ParsedFeedItem;
  cache: ArticleFeedsCachePayload;
  remainingMs: number;
  signal?: AbortSignal;
}): Promise<{ premium: boolean; fetched: boolean; failed: boolean }> {
  const cacheKey = input.item.guid || input.item.url;
  if (Object.prototype.hasOwnProperty.call(input.cache.pffPremium, cacheKey)) {
    return { premium: input.cache.pffPremium[cacheKey]!, fetched: false, failed: false };
  }
  const urlKey = canonicalArticleUrl(input.item.url) ?? input.item.url;
  if (urlKey !== cacheKey && Object.prototype.hasOwnProperty.call(input.cache.pffPremium, urlKey)) {
    return { premium: input.cache.pffPremium[urlKey]!, fetched: false, failed: false };
  }
  if (input.remainingMs < ARTICLE_PAGE_TIMEOUT_MS + 500) {
    return { premium: true, fetched: false, failed: true };
  }
  const page = await fetchTextWithTimeout(input.item.url, {
    timeoutMs: Math.min(ARTICLE_PAGE_TIMEOUT_MS, input.remainingMs),
    signal: input.signal,
  });
  if (!page.ok || !page.body) {
    input.cache.pffPremium[cacheKey] = true; // fail closed: skip, don't refetch forever
    return { premium: true, fetched: true, failed: true };
  }
  const premium = detectPffPremiumFromHtml(page.body);
  input.cache.pffPremium[cacheKey] = premium;
  if (urlKey !== cacheKey) input.cache.pffPremium[urlKey] = premium;
  return { premium, fetched: true, failed: false };
}

/**
 * Cron entrypoint: poll all configured feeds and write matching rows.
 * Idempotent via unique indexes + ETag/If-Modified-Since + headline/URL dedupe.
 */
export async function refreshArticleFeeds(options?: {
  now?: Date;
  signal?: AbortSignal;
  sources?: readonly ArticleFeedSource[];
}): Promise<RefreshArticleFeedsResult> {
  const started = Date.now();
  const now = options?.now ?? new Date();
  const sources = options?.sources ?? ARTICLE_FEED_SOURCES;
  const deadline = started + ARTICLE_FEEDS_JOB_BUDGET_MS;

  const cache = await readFeedsCache();
  const { index, needles } = await loadArticleNameIndex();
  const recentHeadlines = await loadRecentHeadlineKeys(now);
  const seenUrls = new Set<string>();
  const feedStatuses: ArticleFeedRunStatus[] = [];
  let insertedTotal = 0;

  for (const source of sources) {
    const remaining = deadline - Date.now();
    if (remaining < ARTICLE_FEED_TIMEOUT_MS + 1_000) {
      feedStatuses.push({
        name: source.name,
        feedUrl: source.feedUrl,
        status: "skipped_budget",
        httpStatus: 0,
        itemsSeen: 0,
        itemsPassed: 0,
        itemsInserted: 0,
        premiumSkipped: 0,
        error: "job budget exhausted",
      });
      continue;
    }

    const validator = cache.feeds[source.feedUrl] ?? {};
    const conditionalHeaders: Record<string, string> = {};
    if (validator.etag) conditionalHeaders["if-none-match"] = validator.etag;
    if (validator.lastModified) conditionalHeaders["if-modified-since"] = validator.lastModified;

    const response = await fetchTextWithTimeout(source.feedUrl, {
      timeoutMs: Math.min(ARTICLE_FEED_TIMEOUT_MS, remaining),
      headers: conditionalHeaders,
      signal: options?.signal,
    });

    if (response.status === 304) {
      feedStatuses.push({
        name: source.name,
        feedUrl: source.feedUrl,
        status: "not_modified",
        httpStatus: 304,
        itemsSeen: 0,
        itemsPassed: 0,
        itemsInserted: 0,
        premiumSkipped: 0,
      });
      continue;
    }

    if (response.status === 0) {
      feedStatuses.push({
        name: source.name,
        feedUrl: source.feedUrl,
        status: "timeout",
        httpStatus: 0,
        itemsSeen: 0,
        itemsPassed: 0,
        itemsInserted: 0,
        premiumSkipped: 0,
        error: "fetch failed or timed out",
      });
      continue;
    }

    if (!response.ok) {
      feedStatuses.push({
        name: source.name,
        feedUrl: source.feedUrl,
        status: "http_error",
        httpStatus: response.status,
        itemsSeen: 0,
        itemsPassed: 0,
        itemsInserted: 0,
        premiumSkipped: 0,
        error: `HTTP ${response.status}`,
      });
      continue;
    }

    let items: ParsedFeedItem[];
    try {
      items = parseFeedXml(response.body);
    } catch (err) {
      feedStatuses.push({
        name: source.name,
        feedUrl: source.feedUrl,
        status: "parse_error",
        httpStatus: response.status,
        itemsSeen: 0,
        itemsPassed: 0,
        itemsInserted: 0,
        premiumSkipped: 0,
        error: err instanceof Error ? err.message : "parse failed",
      });
      continue;
    }

    let itemsPassed = 0;
    let itemsInserted = 0;
    let premiumSkipped = 0;
    /** True when a PFF page check was skipped for budget — do not advance ETag. */
    let premiumDeferred = false;
    const drafts: SharedNewsDraft[] = [];

    for (const rawItem of items) {
      let title = rawItem.title;
      if (source.titlePrefixStrip && title.startsWith(source.titlePrefixStrip)) {
        title = title.slice(source.titlePrefixStrip.length).trim();
      }
      const item: ParsedFeedItem = { ...rawItem, title };
      const canonical = canonicalArticleUrl(item.url) ?? item.url;
      if (seenUrls.has(canonical)) continue;

      const headlineKey = normalizeHeadlineKey(title);
      if (headlineKey && recentHeadlines.has(headlineKey)) continue;

      const textBlob = `${title} ${item.summary}`;
      const team = detectArticleTeam(textBlob, { teamHint: source.teamHint, url: item.url });
      const matched = matchArticlePlayers(textBlob, index, needles, team);
      const hasPlayer = matched.length > 0;
      const filter = filterArticleHeadline(
        source,
        {
          title,
          url: item.url,
          summary: item.summary,
          categories: item.categories,
        },
        hasPlayer,
      );
      if (!filter.pass) continue;

      if (source.checkPffPremium) {
        const premium = await resolvePffPremium({
          item,
          cache,
          remainingMs: deadline - Date.now(),
          signal: options?.signal,
        });
        if (premium.failed && !premium.fetched) {
          // Budget exhausted before the page fetch — keep prior validators so
          // the next poll re-reads the feed instead of 304-skipping forever.
          premiumDeferred = true;
          premiumSkipped += 1;
          continue;
        }
        if (premium.premium) {
          premiumSkipped += 1;
          continue;
        }
      }

      const fantasyRelevant = hasPlayer || hasRosterActionTerm(title, item.summary);
      const assignment = assignArticleScope({
        text: textBlob,
        matchedPlayerIds: matched,
        team,
        fantasyRelevant,
      });
      if (assignment.scope === "drop") continue;

      itemsPassed += 1;
      seenUrls.add(canonical);
      if (headlineKey) recentHeadlines.add(headlineKey);

      drafts.push(
        ...buildArticleNewsDrafts({
          source,
          item: { ...item, title, url: canonical },
          headline: title,
          summary: item.summary,
          assignment,
          playerMeta: (playerId) => index.byId.get(playerId) ?? null,
        }),
      );
    }

    if (drafts.length > 0) {
      itemsInserted = await insertArticleDrafts(drafts);
      insertedTotal += itemsInserted;
    }

    // Only advance ETag/Last-Modified when we fully processed premium checks.
    if (!premiumDeferred) {
      cache.feeds[source.feedUrl] = {
        ...(response.etag ? { etag: response.etag } : validator.etag ? { etag: validator.etag } : {}),
        ...(response.lastModified
          ? { lastModified: response.lastModified }
          : validator.lastModified
            ? { lastModified: validator.lastModified }
            : {}),
      };
    }

    feedStatuses.push({
      name: source.name,
      feedUrl: source.feedUrl,
      status: "ok",
      httpStatus: response.status,
      itemsSeen: items.length,
      itemsPassed,
      itemsInserted,
      premiumSkipped,
      ...(premiumDeferred ? { error: "premium checks deferred; validators not advanced" } : {}),
    });
  }

  await writeFeedsCache(cache);
  const purged = await purgeExpiredArticleNews(now);

  return {
    ok: true,
    job: "refresh-article-feeds",
    worked: true,
    feeds: feedStatuses,
    inserted: insertedTotal,
    purged,
    durationMs: Date.now() - started,
  };
}
