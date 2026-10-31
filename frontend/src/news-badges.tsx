import { Badge } from "@/components/ui/badge";
import {
  selectNewsBadges,
  type NewsBadge,
  type NewsBadgeItem,
} from "../../api/_lib/player-news-badges";

function badgeClassName(badge: NewsBadge): string {
  switch (badge.tone) {
    case "rumor":
      return "news-type-badge is-rumor";
    case "muted":
      return "news-type-badge is-muted";
    case "neutral":
      return "news-type-badge";
    default: {
      const _exhaustive: never = badge.tone;
      return _exhaustive;
    }
  }
}

function badgeVariant(badge: NewsBadge): "accent" | "outline" | "secondary" {
  switch (badge.tone) {
    case "rumor":
      return "accent";
    case "muted":
      return "outline";
    case "neutral":
      return "secondary";
    default: {
      const _exhaustive: never = badge.tone;
      return _exhaustive;
    }
  }
}

/** Compact type badges for news cards (primary + Cryptic / Dynasty / Team / League). */
export function NewsTypeBadges({
  item,
  className,
}: {
  item: NewsBadgeItem;
  className?: string;
}) {
  const { primary, secondary } = selectNewsBadges(item);
  return (
    <span className={className ? `news-type-badges ${className}` : "news-type-badges"}>
      <Badge
        variant={badgeVariant(primary)}
        size="compact"
        className={badgeClassName(primary)}
      >
        {primary.label}
      </Badge>
      {secondary.map((badge) => (
        <Badge
          key={badge.key}
          variant={badgeVariant(badge)}
          size="compact"
          className={badgeClassName(badge)}
        >
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}

export { selectNewsBadges };
export type { NewsBadgeItem };
