import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tickerItemKind } from "./ticker-news";

const srcDir = dirname(fileURLToPath(import.meta.url));
const feedCss = readFileSync(join(srcDir, "theme", "feed.css"), "utf8");
const appTsx = readFileSync(join(srcDir, "App.tsx"), "utf8");
const sharedTsx = readFileSync(join(srcDir, "shared.tsx"), "utf8");

/** One selector's declaration block inside the desktop media query. */
function desktopRule(css: string, selector: string): string {
  const mediaStart = css.indexOf("@media (min-width: 760px)");
  if (mediaStart < 0) throw new Error("feed.css is missing the desktop media query");
  const ruleStart = css.indexOf(`${selector} {`, mediaStart);
  if (ruleStart < 0) throw new Error(`feed.css is missing ${selector} in the desktop media query`);
  const end = css.indexOf("}", ruleStart);
  return css.slice(ruleStart, end);
}

describe("desktop league-sticky layout", () => {
  it("sizes the week column to its content so the picker cannot cover the refresh control", () => {
    const rule = desktopRule(feedCss, ".league-sticky");
    expect(rule).toMatch(/grid-template-columns:\s*max-content/);
  });

  it("keeps a gap between the week column and the league picker", () => {
    const rule = desktopRule(feedCss, ".league-sticky");
    expect(rule).toMatch(/column-gap:\s*\d+px/);
  });
});

describe("tickerItemKind", () => {
  it("renders items with no action target as text, not buttons", () => {
    expect(tickerItemKind({})).toBe("text");
    expect(tickerItemKind({ playerId: undefined })).toBe("text");
  });

  it("prefers news, then links, then players", () => {
    expect(tickerItemKind({ newsItem: {}, href: "https://x", playerId: "1" })).toBe("news");
    expect(tickerItemKind({ href: "https://x", playerId: "1" })).toBe("link");
    expect(tickerItemKind({ playerId: "1" })).toBe("player");
  });
});

describe("ticker and matchup accessible names", () => {
  it("keeps ticker items self-named: no aria-label overriding the visible text", () => {
    const mapStart = appTsx.indexOf("repeatedItems.map");
    const tickerBlock = appTsx.slice(mapStart, appTsx.indexOf("</section>", mapStart));
    expect(tickerBlock).not.toMatch(/aria-label=/);
    // Extra detail goes on the description so the name stays the visible wording.
    expect(tickerBlock).toMatch(/aria-description=\{isCopy \? undefined : "Opens in a new tab"\}/);
  });

  it("renders no-target ticker items as a span", () => {
    expect(appTsx).toMatch(/<span className=\{className\}/);
  });

  it("names the matchup button with its visible label plus the matchup quality", () => {
    expect(sharedTsx).toMatch(/const ariaLabel = quality \? `\$\{base\}, \$\{quality\}` : base;/);
    expect(sharedTsx).toMatch(/aria-label=\{ariaLabel\} aria-description="View matchup data"/);
  });
});
