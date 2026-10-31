/**
 * Pure badge selection for shared player-news cards and ticker items.
 * Kept free of DOM / DB so vitest and the frontend can share one mapping.
 */

import { DYNASTY_NEWS_TAG } from "./player-news-filters.js";

/** Source-role tags the X producer attaches (exactly one per X item). */
export const X_SOURCE_ROLE_TAGS = [
  "insider",
  "beat",
  "analyst",
  "rumor",
  "team-account",
  "player",
] as const;

export type XSourceRoleTag = (typeof X_SOURCE_ROLE_TAGS)[number];

/**
 * Extra tag for cryptic player-account posts (emoji-only, faith, "business is
 * business"). Not a source-role tag — primary stays Player / role; this is a
 * secondary low-confidence marker.
 */
export const CRYPTIC_NEWS_TAG = "cryptic";

/** Tags accepted on ingest; unknown values are dropped, not rejected. */
export const ALLOWED_NEWS_TAGS = [
  DYNASTY_NEWS_TAG,
  CRYPTIC_NEWS_TAG,
  ...X_SOURCE_ROLE_TAGS,
] as const;

export type AllowedNewsTag = (typeof ALLOWED_NEWS_TAGS)[number];

const ALLOWED_NEWS_TAG_SET: ReadonlySet<string> = new Set(ALLOWED_NEWS_TAGS);
const X_SOURCE_ROLE_TAG_SET: ReadonlySet<string> = new Set(X_SOURCE_ROLE_TAGS);

export function isAllowedNewsTag(tag: string): tag is AllowedNewsTag {
  return ALLOWED_NEWS_TAG_SET.has(tag);
}

export function isXSourceRoleTag(tag: string): tag is XSourceRoleTag {
  return X_SOURCE_ROLE_TAG_SET.has(tag);
}

export type NewsBadgeTone = "neutral" | "rumor" | "muted";

export type NewsBadge = {
  key: string;
  label: string;
  tone: NewsBadgeTone;
};

export type NewsBadges = {
  primary: NewsBadge;
  secondary: NewsBadge[];
};

export type NewsBadgeItem = {
  source: "sleeper" | "x" | "nflverse" | "article" | string;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  tags?: readonly string[] | null;
  scope?: "player" | "team" | "league" | string | null;
};

const X_ROLE_BADGE_LABEL: Record<XSourceRoleTag, string> = {
  insider: "Insider",
  beat: "Beat writer",
  analyst: "Analyst",
  rumor: "Rumor",
  "team-account": "Team account",
  player: "Player",
};

/** Short outlet names for compact badges; falls back to stored sourceLabel. */
const ARTICLE_OUTLET_SHORT_NAMES: Readonly<Record<string, string>> = {
  profootballtalk: "PFT",
  "pro football talk": "PFT",
  pft: "PFT",
  espn: "ESPN",
  "nbc sports": "NBC",
  nbcsports: "NBC",
  "yahoo sports": "Yahoo",
  yahoo: "Yahoo",
  fantasypros: "FantasyPros",
  rotowire: "RotoWire",
  pff: "PFF",
  pfn: "PFN",
  rotoviz: "RotoViz",
  fantasylabs: "FantasyLabs",
};

const ARTICLE_HOST_OUTLETS: Readonly<Record<string, string>> = {
  "espn.com": "ESPN",
  "www.espn.com": "ESPN",
  "fantasy.espn.com": "ESPN",
  "nbcsports.com": "NBC",
  "www.nbcsports.com": "NBC",
  "profootballtalk.nbcsports.com": "PFT",
  "fantasypros.com": "FantasyPros",
  "www.fantasypros.com": "FantasyPros",
  "rotowire.com": "RotoWire",
  "www.rotowire.com": "RotoWire",
  "pff.com": "PFF",
  "www.pff.com": "PFF",
  "profootballnetwork.com": "PFN",
  "www.profootballnetwork.com": "PFN",
  "sports.yahoo.com": "Yahoo",
  "yahoo.com": "Yahoo",
  "rotoviz.com": "RotoViz",
  "www.rotoviz.com": "RotoViz",
  "fantasylabs.com": "FantasyLabs",
  "www.fantasylabs.com": "FantasyLabs",
};

function normalizeOutletKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Outlet badge label for article rows. */
export function articleOutletBadgeLabel(
  sourceLabel: string | null | undefined,
  sourceUrl: string | null | undefined,
): string {
  const label = sourceLabel?.trim() || "";
  if (label) {
    const short = ARTICLE_OUTLET_SHORT_NAMES[normalizeOutletKey(label)];
    if (short) return short;
    return label;
  }
  const host = hostFromUrl(sourceUrl);
  if (host) {
    const fromHost = ARTICLE_HOST_OUTLETS[host] ?? ARTICLE_HOST_OUTLETS[host.replace(/^www\./, "")];
    if (fromHost) return fromHost;
    const bare = host.replace(/^www\./, "").split(".")[0];
    if (bare) {
      const short = ARTICLE_OUTLET_SHORT_NAMES[normalizeOutletKey(bare)];
      if (short) return short;
      return bare.charAt(0).toUpperCase() + bare.slice(1);
    }
  }
  return "Article";
}

function hostFromUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function firstRoleTag(tags: readonly string[]): XSourceRoleTag | null {
  for (const tag of tags) {
    if (tag === "rumor") return "rumor";
  }
  for (const tag of tags) {
    if (isXSourceRoleTag(tag) && tag !== "rumor") return tag;
  }
  return null;
}

function primaryBadgeForItem(item: NewsBadgeItem, tags: readonly string[]): NewsBadge {
  if (tags.includes("rumor")) {
    return { key: "rumor", label: "Rumor", tone: "rumor" };
  }

  const role = firstRoleTag(tags);
  if (role) {
    return { key: role, label: X_ROLE_BADGE_LABEL[role], tone: "neutral" };
  }

  switch (item.source) {
    case "article":
      return {
        key: "article",
        label: articleOutletBadgeLabel(item.sourceLabel, item.sourceUrl),
        tone: "neutral",
      };
    case "sleeper":
      return { key: "sleeper", label: "Sleeper", tone: "neutral" };
    case "nflverse": {
      const label = item.sourceLabel?.trim();
      return {
        key: "nflverse",
        label: label && label.length > 0 ? label : "Data",
        tone: "neutral",
      };
    }
    case "x":
      return { key: "x", label: "X", tone: "neutral" };
    default: {
      const label = item.sourceLabel?.trim();
      return {
        key: "source",
        label: label && label.length > 0 ? label : "News",
        tone: "neutral",
      };
    }
  }
}

/**
 * One primary type badge, plus Cryptic / Dynasty / Team / League secondaries.
 * Priority: rumor → X role → article outlet → sleeper → nflverse → bare X.
 * Cryptic (when tagged) leads the secondary list as a muted low-confidence mark.
 */
export function selectNewsBadges(item: NewsBadgeItem): NewsBadges {
  const tags = item.tags ?? [];
  const primary = primaryBadgeForItem(item, tags);
  const secondary: NewsBadge[] = [];

  if (tags.includes(CRYPTIC_NEWS_TAG)) {
    secondary.push({ key: "cryptic", label: "Cryptic", tone: "muted" });
  }

  if (tags.includes(DYNASTY_NEWS_TAG)) {
    secondary.push({ key: "dynasty", label: "Dynasty", tone: "neutral" });
  }

  const scope = item.scope ?? "player";
  if (scope === "team") {
    secondary.push({ key: "scope-team", label: "Team", tone: "neutral" });
  } else if (scope === "league") {
    secondary.push({ key: "scope-league", label: "League", tone: "neutral" });
  }

  return { primary, secondary };
}
