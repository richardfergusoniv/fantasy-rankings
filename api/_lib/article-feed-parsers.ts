/**
 * Non-RSS article source parsers for refresh-article-feeds.
 * Pure functions over fetched bodies — no I/O.
 */

import {
  canonicalArticleUrl,
  decodeXmlEntities,
  stripHtml,
  truncateSummary,
} from "./article-feed-text.js";
import type { NflNewsTeamCode } from "./player-news-shared.js";

export type ParsedFeedItem = {
  title: string;
  url: string;
  guid: string;
  publishedAt: Date | null;
  summary: string;
  categories: string[];
};

// ---------------------------------------------------------------------------
// WordPress REST (Denver Post / Sun Sentinel)
// ---------------------------------------------------------------------------

type WpRestPost = {
  date_gmt?: unknown;
  link?: unknown;
  title?: { rendered?: unknown } | unknown;
  excerpt?: { rendered?: unknown } | unknown;
};

/** `date_gmt` from WP often omits `Z`; treat naive values as UTC. */
export function parseWpRestDateGmt(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(withZone);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function parseWpRestPostsJson(body: string): ParsedFeedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: ParsedFeedItem[] = [];
  const seen = new Set<string>();
  for (const row of parsed as WpRestPost[]) {
    const titleRaw =
      row.title && typeof row.title === "object" && row.title !== null && "rendered" in row.title
        ? String((row.title as { rendered?: unknown }).rendered ?? "")
        : "";
    const excerptRaw =
      row.excerpt && typeof row.excerpt === "object" && row.excerpt !== null && "rendered" in row.excerpt
        ? String((row.excerpt as { rendered?: unknown }).rendered ?? "")
        : "";
    const title = stripHtml(titleRaw);
    const link = typeof row.link === "string" ? row.link : "";
    const url = canonicalArticleUrl(link);
    if (!title || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const dateRaw = typeof row.date_gmt === "string" ? row.date_gmt : "";
    items.push({
      title,
      url,
      guid: url,
      publishedAt: parseWpRestDateGmt(dateRaw),
      summary: truncateSummary(stripHtml(excerptRaw)),
      categories: [],
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Google News sitemap (SI OnSI, Fantasy Life)
// ---------------------------------------------------------------------------

export const SI_ONSI_TEAM_SLUG_TO_CODE: Readonly<Record<string, NflNewsTeamCode>> = {
  "49ers": "SF",
  bears: "CHI",
  bengals: "CIN",
  bills: "BUF",
  broncos: "DEN",
  browns: "CLE",
  buccaneers: "TB",
  cardinals: "ARI",
  chargers: "LAC",
  chiefs: "KC",
  colts: "IND",
  commanders: "WAS",
  cowboys: "DAL",
  dolphins: "MIA",
  eagles: "PHI",
  falcons: "ATL",
  giants: "NYG",
  jaguars: "JAX",
  jets: "NYJ",
  lions: "DET",
  packers: "GB",
  panthers: "CAR",
  patriots: "NE",
  raiders: "LV",
  rams: "LAR",
  ravens: "BAL",
  saints: "NO",
  seahawks: "SEA",
  steelers: "PIT",
  texans: "HOU",
  titans: "TEN",
  vikings: "MIN",
};

const SI_ONSI_PATH_RE = /^\/nfl\/([^/]+)\/onsi\//i;

export function siOnsiTeamFromUrl(url: string): NflNewsTeamCode | null {
  try {
    const path = new URL(url).pathname;
    const match = path.match(SI_ONSI_PATH_RE);
    if (!match?.[1]) return null;
    const slug = match[1].toLowerCase();
    return SI_ONSI_TEAM_SLUG_TO_CODE[slug] ?? null;
  } catch {
    return null;
  }
}

function parseNewsSitemapDate(raw: string): Date | null {
  if (!raw.trim()) return null;
  const ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/**
 * Parse a Google news-sitemap `<url>` list.
 * Optional `urlFilter` drops entries before mapping (e.g. SI OnSI paths).
 */
export function parseNewsSitemapXml(
  xml: string,
  options?: {
    urlFilter?: (url: string) => boolean;
  },
): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const block = match[1] ?? "";
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    const loc = decodeXmlEntities(locMatch?.[1] ?? "").trim();
    const url = canonicalArticleUrl(loc);
    if (!url) continue;
    if (options?.urlFilter && !options.urlFilter(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const titleMatch =
      block.match(/<news:title>([\s\S]*?)<\/news:title>/i)
      ?? block.match(/<title>([\s\S]*?)<\/title>/i);
    const title = stripHtml(titleMatch?.[1] ?? "");
    if (!title) continue;
    const dateMatch =
      block.match(/<news:publication_date>([\s\S]*?)<\/news:publication_date>/i)
      ?? block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);
    const publishedAt = parseNewsSitemapDate(stripHtml(dateMatch?.[1] ?? ""));
    items.push({
      title,
      url,
      guid: url,
      publishedAt,
      summary: "",
      categories: [],
    });
  }
  return items;
}

export function parseSiOnsiNewsSitemap(xml: string): ParsedFeedItem[] {
  return parseNewsSitemapXml(xml, {
    urlFilter: (url) => siOnsiTeamFromUrl(url) !== null,
  });
}

export function parseFantasyLifeNewsSitemap(xml: string): ParsedFeedItem[] {
  return parseNewsSitemapXml(xml, {
    urlFilter: (url) => {
      try {
        return new URL(url).pathname.toLowerCase().startsWith("/articles/");
      } catch {
        return false;
      }
    },
  });
}

/** FL+ / premium page marker (escaped Next payload or plain JSON). */
export function detectFantasyLifePremiumFromHtml(html: string): boolean {
  if (/\\?"isPremium\\?"\s*:\s*true\b/i.test(html)) return true;
  if (/\\?"flPlus\\?"\s*:\s*true\b/i.test(html)) return true;
  if (/"isAccessibleForFree"\s*:\s*"false"/i.test(html)) return true;
  if (/"isAccessibleForFree"\s*:\s*false\b/i.test(html)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// ESPN site API
// ---------------------------------------------------------------------------

type EspnNewsArticle = {
  type?: unknown;
  premium?: unknown;
  headline?: unknown;
  description?: unknown;
  published?: unknown;
  links?: { web?: { href?: unknown } } | unknown;
};

export function parseEspnNflNewsJson(body: string): ParsedFeedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const articles = (parsed as { articles?: unknown }).articles;
  if (!Array.isArray(articles)) return [];
  const items: ParsedFeedItem[] = [];
  const seen = new Set<string>();
  for (const row of articles as EspnNewsArticle[]) {
    const type = typeof row.type === "string" ? row.type : "";
    if (type.toLowerCase() === "media") continue;
    if (row.premium === true || row.premium === 1 || row.premium === "true") continue;
    const title = typeof row.headline === "string" ? row.headline.trim() : "";
    const links = row.links && typeof row.links === "object" ? (row.links as { web?: { href?: unknown } }) : null;
    const href = typeof links?.web?.href === "string" ? links.web.href : "";
    const url = canonicalArticleUrl(href);
    if (!title || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const summary = typeof row.description === "string" ? truncateSummary(stripHtml(row.description)) : "";
    const publishedAt =
      typeof row.published === "string" && row.published.trim()
        ? (() => {
            const ms = Date.parse(row.published.trim());
            return Number.isFinite(ms) ? new Date(ms) : null;
          })()
        : null;
    items.push({
      title,
      url,
      guid: url,
      publishedAt,
      summary,
      categories: [],
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 247Sports Browns listing
// ---------------------------------------------------------------------------

const BROWNS_ARTICLE_RE =
  /https?:\/\/(?:www\.)?247sports\.com\/nfl\/cleveland-browns\/article\/([^"?#\s]+)-(\d+)\/?/gi;

export type Browns247ListingItem = {
  id: string;
  title: string;
  url: string;
};

/**
 * Titles + numeric ids from the Browns team page. No dates on the listing —
 * callers page-fetch new ids for `datePublished`.
 */
export function parse247BrownsListingHtml(html: string): Browns247ListingItem[] {
  const byId = new Map<string, Browns247ListingItem>();
  for (const match of html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/(?:www\.)?247sports\.com\/nfl\/cleveland-browns\/article\/[^"']+-(\d+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1] ?? "";
    const id = match[2] ?? "";
    const title = stripHtml(match[3] ?? "").replace(/\s+/g, " ").trim();
    if (!id || !href) continue;
    if (!title || /^cleveland browns\s*\|\s*nfl$/i.test(title) || title.length < 12) continue;
    const url = canonicalArticleUrl(href.endsWith("/") ? href : `${href}/`) ?? href;
    const prev = byId.get(id);
    if (!prev || title.length > prev.title.length) {
      byId.set(id, { id, title, url });
    }
  }
  // Fallback: bare href scan when anchors lack usable text.
  if (byId.size === 0) {
    for (const match of html.matchAll(BROWNS_ARTICLE_RE)) {
      const slug = match[1] ?? "";
      const id = match[2] ?? "";
      if (!id) continue;
      const href = `https://247sports.com/nfl/cleveland-browns/article/${slug}-${id}/`;
      const title = slug.replace(/-/g, " ").trim();
      if (!byId.has(id)) byId.set(id, { id, title, url: href });
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.id) - Number(a.id));
}

/** Pull `datePublished` from article HTML (JSON-LD / Open Graph / itemprop). */
export function extractArticlePublishedAtFromHtml(html: string): Date | null {
  const patterns = [
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /property=["']article:published_time["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+property=["']article:published_time["']/i,
    /itemprop=["']datePublished["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+itemprop=["']datePublished["']/i,
    /name=["']pubdate["']\s+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (!match?.[1]) continue;
    const ms = Date.parse(decodeXmlEntities(match[1]).trim());
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return null;
}

export function browns247ListingToFeedItems(
  listing: readonly Browns247ListingItem[],
  publishedById: ReadonlyMap<string, Date | null>,
): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  for (const row of listing) {
    if (!publishedById.has(row.id)) continue;
    const publishedAt = publishedById.get(row.id) ?? null;
    items.push({
      title: row.title,
      url: row.url,
      guid: `247sports:browns:${row.id}`,
      publishedAt,
      summary: "",
      categories: [],
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Footballguys /news HTML
// ---------------------------------------------------------------------------

const FBG_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthNumber(token: string): number | null {
  const key = token.slice(0, 3).toLowerCase();
  return FBG_MONTHS[key] ?? null;
}

/**
 * US Eastern offset hours (EST=5, EDT=4) for a local civil wall time.
 * Uses the article's hour/minute — not a noon stand-in — so fall-back mornings
 * (e.g. Sun Nov 1, 12:30 AM) stay on EDT until 02:00 EDT.
 */
export function usEasternOffsetHours(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
): number {
  // Spring forward: 02:00 EST → 03:00 EDT on 2nd Sunday in March.
  // Fall back: 02:00 EDT → 01:00 EST on 1st Sunday in November.
  const secondSundayMarch = nthWeekdayOfMonth(year, 3, 0, 2);
  const firstSundayNovember = nthWeekdayOfMonth(year, 11, 0, 1);
  const startUtc = Date.UTC(year, 2, secondSundayMarch, 7, 0, 0); // 02:00 EST = 07:00 UTC
  const endUtc = Date.UTC(year, 10, firstSundayNovember, 6, 0, 0); // 02:00 EDT = 06:00 UTC
  // Prefer the EDT reading when that instant still falls inside the DST window
  // (covers pre-transition early mornings on fall-back day; ambiguous 1:xx AM
  // prefers the earlier EDT occurrence, which matches FBG's usual cadence).
  const asEdtUtc = Date.UTC(year, month - 1, day, hour + 4, minute, 0);
  if (asEdtUtc >= startUtc && asEdtUtc < endUtc) return 4;
  return 5;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  let count = 0;
  for (let day = 1; day <= 31; day += 1) {
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCMonth() !== month - 1) break;
    if (dt.getUTCDay() === weekday) {
      count += 1;
      if (count === n) return day;
    }
  }
  return 1;
}

/**
 * Parse Footballguys listing timestamps like `Fri Oct 30, 07:16 PM` (ET, no year).
 * Picks the year so the instant is not in the future (beyond a small skew) and
 * prefers the candidate closest to `now`.
 */
export function parseFootballguysEtTimestamp(raw: string, now = new Date()): Date | null {
  const match = raw
    .trim()
    .match(
      /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i,
    );
  if (!match) return null;
  const month = monthNumber(match[1] ?? "");
  const day = Number(match[2]);
  let hour = Number(match[3]);
  const minute = Number(match[4]);
  const ampm = (match[5] ?? "").toUpperCase();
  if (!month || !Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const years = [now.getUTCFullYear(), now.getUTCFullYear() - 1];
  const skewMs = 2 * 60 * 60 * 1000;
  let best: Date | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const year of years) {
    const offset = usEasternOffsetHours(year, month, day, hour, minute);
    const utcMs = Date.UTC(year, month - 1, day, hour + offset, minute, 0);
    if (!Number.isFinite(utcMs)) continue;
    const candidate = new Date(utcMs);
    if (candidate.getTime() - now.getTime() > skewMs) continue;
    const distance = Math.abs(now.getTime() - candidate.getTime());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

const FBG_TEAM_NAME_TO_CODE: Readonly<Record<string, NflNewsTeamCode>> = {
  Cardinals: "ARI",
  Falcons: "ATL",
  Ravens: "BAL",
  Bills: "BUF",
  Panthers: "CAR",
  Bears: "CHI",
  Bengals: "CIN",
  Browns: "CLE",
  Cowboys: "DAL",
  Broncos: "DEN",
  Lions: "DET",
  Packers: "GB",
  Texans: "HOU",
  Colts: "IND",
  Jaguars: "JAX",
  Chiefs: "KC",
  Raiders: "LV",
  Chargers: "LAC",
  Rams: "LAR",
  Dolphins: "MIA",
  Vikings: "MIN",
  Patriots: "NE",
  Saints: "NO",
  Giants: "NYG",
  Jets: "NYJ",
  Eagles: "PHI",
  Steelers: "PIT",
  "49ers": "SF",
  Seahawks: "SEA",
  Buccaneers: "TB",
  Titans: "TEN",
  Commanders: "WAS",
};

export function footballguysTeamHintFromTitle(title: string): NflNewsTeamCode | null {
  const team = title.split("|")[0]?.trim() ?? "";
  return FBG_TEAM_NAME_TO_CODE[team] ?? null;
}

export type FootballguysParsedItem = ParsedFeedItem & {
  footballguysId: string;
  playerUrl: string | null;
  playerName: string | null;
  analysis: string;
};

/**
 * Server-rendered https://www.footballguys.com/news items keyed by `<a name="ID">`.
 * Skips subscriber `/article` links as the item URL (news anchors only).
 */
export function parseFootballguysNewsHtml(html: string, now = new Date()): FootballguysParsedItem[] {
  const parts = html.split(/(?=<a\s+name="\d+">)/i);
  const items: FootballguysParsedItem[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const idMatch = part.match(/<a\s+name="(\d+)">/i);
    if (!idMatch?.[1]) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const titleMatch = part.match(/font-size\s*:\s*18px["']?\s*>\s*([^<]+)</i);
    const title = decodeXmlEntities(titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;

    const dateMatch = part.match(
      /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{1,2}:\d{2}\s+[AP]M)/i,
    );
    const publishedAt = dateMatch?.[0] ? parseFootballguysEtTimestamp(dateMatch[0], now) : null;

    const paragraphs = [...part.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1] ?? "").trim())
      .filter((p) => p && !/^footballguys view/i.test(p));
    const summaryText = paragraphs[0] ?? "";

    const viewMatch = part.match(/<b>\s*Footballguys view\s*<\/b>\s*:\s*([\s\S]*?)<\/td>/i);
    const analysis = viewMatch ? stripHtml(viewMatch[1] ?? "").trim() : "";

    const playerMatch = part.match(
      /href=["'](https?:\/\/(?:www\.)?footballguys\.com\/player\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const playerUrl = playerMatch?.[1] ? canonicalArticleUrl(playerMatch[1]) : null;
    const playerName = playerMatch?.[2]
      ? stripHtml(playerMatch[2]).replace(/\s+player page$/i, "").trim()
      : null;

    // Anchor URL is the stable item link (not /articles).
    const url = `https://www.footballguys.com/news#${id}`;
    const summaryParts = [summaryText, analysis ? `Footballguys view: ${analysis}` : ""]
      .filter(Boolean)
      .join(" ");

    items.push({
      title,
      url,
      guid: `footballguys:news:${id}`,
      publishedAt,
      summary: truncateSummary(summaryParts),
      categories: [],
      footballguysId: id,
      playerUrl,
      playerName,
      analysis,
    });
  }
  return items;
}
