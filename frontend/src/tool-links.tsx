import type { MouseEvent as ReactMouseEvent } from "react";

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
