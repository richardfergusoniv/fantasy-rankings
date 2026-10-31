import { Badge } from "@/components/ui/badge";
import {
  selectNewsBadges,
  type NewsBadge,
  type NewsBadgeItem,
} from "../../api/_lib/player-news-badges";

function badgeClassName(badge: NewsBadge): string {
  return badge.tone === "rumor" ? "news-type-badge is-rumor" : "news-type-badge";
}

/** Compact type badges for news cards (primary + Dynasty / Team / League). */
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
        variant={primary.tone === "rumor" ? "accent" : "secondary"}
        size="compact"
        className={badgeClassName(primary)}
      >
        {primary.label}
      </Badge>
      {secondary.map((badge) => (
        <Badge
          key={badge.key}
          variant="secondary"
          size="compact"
          className="news-type-badge"
        >
          {badge.label}
        </Badge>
      ))}
    </span>
  );
}

export { selectNewsBadges };
export type { NewsBadgeItem };
