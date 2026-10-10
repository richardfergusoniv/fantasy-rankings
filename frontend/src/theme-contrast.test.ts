import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const themePath = join(dirname(fileURLToPath(import.meta.url)), "theme.css");

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

function resolveVar(vars: Record<string, string>, name: string, depth = 0): string {
  if (depth > 20) throw new Error(`Circular CSS variable reference near ${name}`);
  const raw = vars[name];
  if (raw == null) throw new Error(`Missing CSS variable ${name}`);
  const ref = raw.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolveVar(vars, ref[1], depth + 1);
  return raw;
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
  const css = readFileSync(themePath, "utf8");
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

  it("keeps optimized-change projection amber readable on Look D canvas and panel", () => {
    const warning = resolveVar(vars, "--warning");
    expect(warning.toLowerCase()).toBe("#f5c16a");
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
