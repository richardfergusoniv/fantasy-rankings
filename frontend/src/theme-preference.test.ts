import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  nextThemePreference,
  parseThemePreference,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./theme-preference";

describe("theme preference", () => {
  it("falls back to the device for anything unrecognised", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    for (const raw of [null, undefined, "", "system", "auto", "LIGHT", 3]) {
      expect(parseThemePreference(raw)).toBe("system");
    }
  });

  it("cycles device, light, dark and back", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});

describe("first-paint script", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("reads the same storage key the app writes", () => {
    expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
  });

  it("paints the same colors the app applies", () => {
    expect(html).toContain(`html[data-theme="light"]`);
    expect(html).toContain(`html[data-theme="dark"]`);
    for (const color of Object.values(THEME_COLORS)) expect(html).toContain(color);
  });
});
