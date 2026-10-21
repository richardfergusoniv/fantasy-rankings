import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));
const themeEntryPath = join(srcDir, "theme.css");

/** theme.css only @imports ./theme/*.css; tests read the whole cascade in import order. */
function readTheme(): string {
  const entry = readFileSync(themeEntryPath, "utf8");
  const parts = [...entry.matchAll(/@import\s+"\.\/(theme\/[\w-]+\.css)";/g)].map((m) => readFileSync(join(srcDir, m[1]), "utf8"));
  if (parts.length === 0) throw new Error("theme.css imports no ./theme/*.css files");
  return parts.join("\n");
}

function extractRootBlock(css: string): string {
  const start = css.indexOf(":root {");
  if (start < 0) throw new Error("Could not find :root block in theme.css");
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("Unclosed :root block in theme.css");
}

function parseCssVars(rootBlock: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rootBlock)) !== null) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

type ThemeMode = "dark" | "light";

/** Splits `light-dark(a, b)` on its top-level comma and returns the side for the mode. */
function pickMode(raw: string, mode: ThemeMode): string {
  const match = /^light-dark\((.*)\)$/.exec(raw);
  if (!match) return raw;
  const inner = match[1];
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "(") depth += 1;
    else if (inner[i] === ")") depth -= 1;
    else if (inner[i] === "," && depth === 0) {
      const [light, dark] = [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
      return mode === "light" ? light : dark;
    }
  }
  throw new Error(`Malformed light-dark() value: ${raw}`);
}

function resolveVar(vars: Record<string, string>, name: string, mode: ThemeMode = "dark", depth = 0): string {
  if (depth > 20) throw new Error(`Circular CSS variable reference near ${name}`);
  const raw = vars[name];
  if (raw == null) throw new Error(`Missing CSS variable ${name}`);
  const value = pickMode(raw, mode);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolveVar(vars, ref[1], mode, depth + 1);
  return value;
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const hex = color.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(hex);
  if (short) {
    const [r, g, b] = short[1].split("").map((c) => Number.parseInt(c + c, 16));
    return { r, g, b };
  }
  const full = /^#([0-9a-f]{6})$/.exec(hex);
  if (!full) throw new Error(`Expected hex color, got ${color}`);
  const n = full[1];
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Look D theme contrast", () => {
  const css = readTheme();
  const vars = parseCssVars(extractRootBlock(css));

  const canvas = resolveVar(vars, "--background");
  const panel = resolveVar(vars, "--card");
  const link = resolveVar(vars, "--link");
  const onAccent = resolveVar(vars, "--on-accent");
  const primaryForeground = resolveVar(vars, "--primary-foreground");
  const primary = resolveVar(vars, "--primary");
  const action = resolveVar(vars, "--action");
  const border = resolveVar(vars, "--border");
  const dim = resolveVar(vars, "--dim");
  const dangerText = resolveVar(vars, "--danger-text");
  const opponentRow = resolveVar(vars, "--opponent-row");
  const foreground = resolveVar(vars, "--foreground");
  const strengthReadable = resolveVar(vars, "--stat-strength-readable");
  const strengthSoft = resolveVar(vars, "--stat-strength-soft");
  const weaknessReadable = resolveVar(vars, "--stat-weakness-readable");
  const weaknessSoft = resolveVar(vars, "--stat-weakness-soft");

  it("keeps amber labels readable on canvas and panel", () => {
    expect(contrastRatio(link, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(link, panel)).toBeGreaterThanOrEqual(4.5);
    expect(link.toLowerCase()).toBe("#f5c16a");
  });

  it("keeps optimized-total projection amber readable on Look D canvas and panel", () => {
    const winner = resolveVar(vars, "--winner");
    expect(winner.toLowerCase()).toBe("#f5c16a");
    expect(contrastRatio(winner, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(winner, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps warnings readable and distinct from the amber action color", () => {
    const warning = resolveVar(vars, "--warning");
    expect(warning.toLowerCase()).not.toBe(resolveVar(vars, "--link").toLowerCase());
    expect(contrastRatio(warning, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(warning, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses dark ink on amber primary, not white", () => {
    expect(primary.toLowerCase()).toBe("#f0b429");
    expect(action.toLowerCase()).toBe("#f0b429");
    expect(onAccent.toLowerCase()).toBe("#14120a");
    expect(primaryForeground.toLowerCase()).toBe("#14120a");
    expect(onAccent.toLowerCase()).not.toBe("#ffffff");
    expect(primaryForeground.toLowerCase()).not.toBe("#ffffff");
    expect(contrastRatio(onAccent, primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primaryForeground, action)).toBeGreaterThanOrEqual(4.5);
  });

  it("meets non-text divider contrast on panel", () => {
    expect(contrastRatio(border, panel)).toBeGreaterThanOrEqual(3);
  });

  it("keeps dim captions readable on panel", () => {
    expect(contrastRatio(dim, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps danger text readable on canvas", () => {
    expect(contrastRatio(dangerText, canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps opponent row text readable", () => {
    expect(opponentRow.toLowerCase()).toBe("#323a46");
    expect(contrastRatio(foreground, opponentRow)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps soft/tough readable text on soft fills", () => {
    expect(contrastRatio(strengthReadable, strengthSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(weaknessReadable, weaknessSoft)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Token hygiene", () => {
  it("has no raw hex colors in theme.css outside :root", () => {
    const css = readTheme();
    const root = extractRootBlock(css);
    const rest = css.replace(root, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const raw = [...rest.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g)].map((m) => m[0]);
    expect(raw).toEqual([]);
  });
});

describe("Row divider contrast", () => {
  const vars = parseCssVars(extractRootBlock(readTheme()));
  const divider = resolveVar(vars, "--row-divider");

  it("keeps list-row dividers near 3:1 on canvas and panel", () => {
    expect(contrastRatio(divider, resolveVar(vars, "--background"))).toBeGreaterThanOrEqual(2.9);
    expect(contrastRatio(divider, resolveVar(vars, "--card"))).toBeGreaterThanOrEqual(2.6);
  });
});

describe("Roster highlight", () => {
  const vars = parseCssVars(extractRootBlock(readTheme()));
  const highlight = resolveVar(vars, "--roster-highlight");
  const bg = resolveVar(vars, "--roster-highlight-bg");

  it("is not the action/link amber", () => {
    expect(highlight.toLowerCase()).not.toBe(resolveVar(vars, "--action").toLowerCase());
    expect(highlight.toLowerCase()).not.toBe(resolveVar(vars, "--link").toLowerCase());
  });

  it("stays readable on its tint and with dark ink as a fill", () => {
    expect(contrastRatio(highlight, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(resolveVar(vars, "--on-roster-highlight"), highlight)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Radius tokens", () => {
  it("keeps small-tag radii on --radius-xs instead of a bare 4px", () => {
    const css = readTheme();
    expect(css.match(/border-radius\s*:\s*4px\s*(?:!important\s*)?(?=[;}])/g) ?? []).toEqual([]);
  });
});

describe("Light theme contrast", () => {
  const vars = parseCssVars(extractRootBlock(readTheme()));
  const light = (name: string) => resolveVar(vars, name, "light");
  const canvas = light("--background");
  const panel = light("--card");

  it("declares both schemes", () => {
    expect(extractRootBlock(readTheme())).toContain("color-scheme: light dark;");
  });

  it("keeps text, dim text and links readable on canvas and panel", () => {
    for (const name of ["--foreground", "--dim", "--link", "--link-hover", "--ui-accent-foreground"]) {
      expect(contrastRatio(light(name), canvas), `${name} on canvas`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light(name), panel), `${name} on panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps semantic text readable on its tint and on the panel", () => {
    for (const [fg, bg] of [
      ["--stat-strength-readable", "--stat-strength-soft"],
      ["--stat-weakness-readable", "--stat-weakness-soft"],
      ["--roster-highlight", "--roster-highlight-bg"],
      ["--ticker-text", "--ticker-bg"],
      ["--ticker-dim", "--ticker-bg"],
      ["--ticker-up", "--ticker-bg"],
      ["--ticker-down", "--ticker-bg"],
    ] as const) {
      expect(contrastRatio(light(fg), light(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const name of ["--positive", "--negative", "--winner", "--warning", "--roster-highlight", "--danger-text"]) {
      expect(contrastRatio(light(name), panel), `${name} on panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps ink readable on filled chips", () => {
    expect(contrastRatio(light("--on-roster-highlight"), light("--roster-highlight"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light("--on-accent"), light("--winner-fill"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light("--on-accent"), light("--action"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps borders and chart series visible against the panel", () => {
    expect(contrastRatio(light("--border"), panel)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(light("--row-divider"), panel)).toBeGreaterThanOrEqual(2.6);
    for (const name of ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-ma7", "--chart-ma30"]) {
      expect(contrastRatio(light(name), panel), `${name} on panel`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the amber action, roster teal and warning distinct", () => {
    const hues = [light("--link"), light("--roster-highlight"), light("--warning")].map((c) => c.toLowerCase());
    expect(new Set(hues).size).toBe(3);
  });
});

describe("Focus outlines", () => {
  it("use --ring, not the fixed amber --accent that disappears on light surfaces", () => {
    const css = readTheme();
    expect(css.match(/outline\s*:[^;]*var\(--accent\)[^;]*;/g) ?? []).toEqual([]);
  });
});

describe("Theme file layout", () => {
  it("keeps theme.css as imports only, so rule order lives in one visible list", () => {
    const entry = readFileSync(themeEntryPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rest = entry.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("@import"));
    expect(rest).toEqual([]);
  });

  it("imports overrides.css last", () => {
    const imports = [...readFileSync(themeEntryPath, "utf8").matchAll(/@import\s+"\.\/theme\/([\w-]+)\.css";/g)].map((m) => m[1]);
    expect(imports.at(-1)).toBe("overrides");
  });
});

describe("Data marks on light surfaces", () => {
  const vars = parseCssVars(extractRootBlock(readTheme()));
  const light = (name: string) => resolveVar(vars, name, "light");

  it("keeps amber bars and markers visible on white, their pale track and the grey bar track", () => {
    expect(contrastRatio(light("--data-mark"), light("--card"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(light("--data-mark"), light("--accent-soft"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(light("--data-mark"), light("--surface-2"))).toBeGreaterThanOrEqual(3);
  });

  it("leaves the dark value where it was", () => {
    expect(resolveVar(vars, "--data-mark").toLowerCase()).toBe(resolveVar(vars, "--accent").toLowerCase());
  });

  it("does not draw data marks with the fixed accent amber", () => {
    const css = readTheme();
    const marks = [".tier-cliff-bar i", ".boom-bust-projection", ".player-chart-peek i b", ".boom-bust-median-mark"];
    for (const selector of marks) {
      const rule = css.split("\n").find((line) => line.startsWith(selector));
      expect(rule, selector).toBeDefined();
      expect(rule, selector).not.toMatch(/background:\s*var\(--accent\)/);
    }
  });
});
