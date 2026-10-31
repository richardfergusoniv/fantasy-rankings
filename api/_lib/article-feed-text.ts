import { isHttpOrHttpsUrl } from "./http-url.js";

export const ARTICLE_SUMMARY_MAX_CHARS = 280;

/** Tracking / share params stripped for canonical URL dedupe. */
const TRACKING_QUERY_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "gbraid", "wbraid", "mc_cid", "mc_eid", "igshid", "si",
  "ref", "ref_src", "s", "smid", "ncid",
]);

/**
 * Decode a single XML/HTML entity reference. One pass only — avoids the
 * CodeQL double-unescape pattern of replacing `&amp;` then numeric entities.
 */
function decodeOneXmlEntity(entity: string): string {
  const lower = entity.toLowerCase();
  switch (lower) {
    case "&nbsp;":
      return " ";
    case "&amp;":
      return "&";
    case "&lt;":
      return "<";
    case "&gt;":
      return ">";
    case "&quot;":
      return "\"";
    case "&apos;":
      return "'";
    default: {
      if (/^&#x[0-9a-f]+;$/i.test(entity)) {
        const code = Number.parseInt(entity.slice(3, -1), 16);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      if (/^&#\d+;$/.test(entity)) {
        const code = Number(entity.slice(2, -1));
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return entity;
    }
  }
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, decodeOneXmlEntity);
}

export function stripHtml(value: string): string {
  // Expand CDATA before tag stripping so titles like `<![CDATA[Headline]]>`
  // are not discarded as a single bogus tag (the only `>` is at the end).
  // Then remove script/style before entity decoding so encoded tags stay inert.
  // Closing tags use \b[^>]* so junk like `</script\t\n bar>` still matches (CodeQL).
  const expanded = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  return decodeXmlEntities(
    expanded
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
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

/**
 * Canonical article URL for dedupe. Strips tracking query params and ordinary
 * `#section` fragments, but keeps bare numeric hashes (`#12345`) so anchor
 * URLs like Footballguys `/news#id` stay unique.
 */
export function canonicalArticleUrl(rawUrl: string): string | null {
  if (!rawUrl.trim() || !isHttpOrHttpsUrl(rawUrl.trim())) return null;
  try {
    const url = new URL(rawUrl.trim());
    const numericHash = /^#\d+$/.test(url.hash) ? url.hash : "";
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
    url.hash = numericHash;
    return url.toString();
  } catch {
    return null;
  }
}
