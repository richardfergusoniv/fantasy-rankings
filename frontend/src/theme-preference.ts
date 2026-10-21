export type ThemePreference = "system" | "light" | "dark";

/** The inline script in index.html reads this same key before first paint. */
export const THEME_STORAGE_KEY = "fantasy-rankings-theme";

export const THEME_COLORS = { light: "#f4f5f7", dark: "#0e1014" } as const;

const ORDER: ThemePreference[] = ["system", "light", "dark"];

export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

export function themePreferenceLabel(preference: ThemePreference): string {
  return preference === "system" ? "Match device" : preference === "light" ? "Light" : "Dark";
}

export function readStoredTheme(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeStoredTheme(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private windows and blocked storage still get the choice for this visit.
  }
}

/**
 * Pin the page to one scheme, or release it to the device. The stylesheet maps `data-theme` to `color-scheme`,
 * which every `light-dark()` token follows; the browser-chrome color has to be set here.
 */
export function applyThemePreference(preference: ThemePreference, doc: Document = document): void {
  const root = doc.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const system = meta.dataset.systemContent ?? meta.content;
    meta.dataset.systemContent = system;
    meta.content = preference === "system" ? system : THEME_COLORS[preference];
  }
}
