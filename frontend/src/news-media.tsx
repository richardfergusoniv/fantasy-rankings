import type { NewsMediaItem } from "../../api/_lib/player-news-shared";

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
  const items = (media ?? []).filter((item) => item.url);
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
