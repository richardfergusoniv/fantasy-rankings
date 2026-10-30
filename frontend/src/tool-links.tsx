import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ToolPlayerLink } from "./tool-player-link";

export type ToolLinkItem = {
  key: string;
  label: string;
  href: string;
  /** In-app navigation, used for an unmodified primary click. */
  onOpen: () => void;
};

/**
 * A row of links into the tools. Each is a real anchor, so open-in-new-tab and
 * copy-link work; a plain left click is intercepted for in-app navigation, like
 * the Waivers badge on the player sheet.
 */
export function ToolLinks({ label = "Open in", ariaLabel, links }: { label?: string; ariaLabel: string; links: ToolLinkItem[] }) {
  if (links.length === 0) return null;
  return (
    <nav className="tool-links" aria-label={ariaLabel}>
      <span className="tool-links-label">{label}</span>
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          className="tool-link"
          onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            link.onOpen();
          }}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * A player's name inside a tool row, linking to their card. Without a link (the
 * player did not resolve to a dashboard player) the children render unchanged.
 */
export function PlayerNameLink({ link, className, label, children }: { link: ToolPlayerLink | null; className?: string; label?: string; children: ReactNode }) {
  if (!link) return <>{children}</>;
  return (
    <a
      href={link.href}
      className={className ? `tool-player-link ${className}` : "tool-player-link"}
      aria-label={label}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        link.onOpen();
      }}
    >
      {children}
    </a>
  );
}

export type CrossToolLink = {
  href: string;
  onOpen: () => void;
};

/**
 * Compact badge that deep-links another dashboard surface (Game lines ↔ matchup).
 * Real anchor for open-in-new-tab; primary click stays in-app.
 */
export function CrossToolBadge({
  link,
  label,
  ariaLabel,
  className = "",
}: {
  link: CrossToolLink;
  label: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <a
      href={link.href}
      className={`matchup-reference-tag matchup-reference-button cross-tool-badge${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        link.onOpen();
      }}
    >
      <span className="matchup-reference-button-label">{label}</span>
    </a>
  );
}
