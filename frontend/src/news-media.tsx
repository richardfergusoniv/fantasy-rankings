import type { NewsMediaItem } from "../../api/_lib/player-news-shared";
import { isHttpOrHttpsUrl } from "../../api/_lib/http-url";

/**
 * Keep only media entries whose bindable URLs are http(s). Ingest already
 * filters, but read paths re-check before rendering (same defense-in-depth as
 * `sourceUrl` elsewhere in the UI).
 */
export function safeNewsMediaItems(
  media: readonly NewsMediaItem[] | null | undefined,
): NewsMediaItem[] {
  const out: NewsMediaItem[] = [];
  for (const item of media ?? []) {
    if (!isHttpOrHttpsUrl(item.url)) continue;
    const previewUrl =
      item.previewUrl && isHttpOrHttpsUrl(item.previewUrl) ? item.previewUrl : undefined;
    out.push({
      type: item.type,
      url: item.url,
      ...(previewUrl ? { previewUrl } : {}),
      ...(item.alt ? { alt: item.alt } : {}),
    });
  }
  return out;
}

/**
 * Media attachments on a news item (charts, graphs, film clips).
 * Images open the source URL in a new tab; videos render inline with a
 * poster and no autoplay. `compact` renders small thumbnails for list rows.
 */
export function NewsMedia({
  media,
  compact = false,
}: {
  media: readonly NewsMediaItem[] | null | undefined;
  compact?: boolean;
}) {
  const items = safeNewsMediaItems(media);
  if (items.length === 0) return null;
  return (
    <div className={compact ? "news-media is-compact" : "news-media"}>
      {items.map((item, index) =>
        item.type === "video" ? (
          <video
            key={`${item.url}:${index}`}
            className="news-media-video"
            controls
            preload="none"
            playsInline
            poster={item.previewUrl}
            src={item.url}
            aria-label={item.alt ?? "Video attached to this post"}
          />
        ) : compact ? (
          <a
            key={`${item.url}:${index}`}
            className="news-media-thumb"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-label={item.alt ? `${item.alt} (opens in a new tab)` : "Open attached image in a new tab"}
          >
            <img src={item.previewUrl ?? item.url} alt={item.alt ?? ""} loading="lazy" />
          </a>
        ) : (
          <a
            key={`${item.url}:${index}`}
            className="news-media-image"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-label={item.alt ? `${item.alt} (opens in a new tab)` : "Open attached image in a new tab"}
          >
            <img src={item.url} alt={item.alt ?? ""} loading="lazy" />
          </a>
        ),
      )}
    </div>
  );
}
