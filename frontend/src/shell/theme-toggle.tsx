import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import {
  applyThemePreference,
  nextThemePreference,
  readStoredTheme,
  themePreferenceLabel,
  writeStoredTheme,
} from "../theme-preference";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const [preference, setPreference] = useState(readStoredTheme);
  const Icon = ICONS[preference];
  const next = nextThemePreference(preference);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        applyThemePreference(next);
        writeStoredTheme(next);
        setPreference(next);
      }}
      aria-label={`Theme: ${themePreferenceLabel(preference)}. Switch to ${themePreferenceLabel(next)}`}
      title={`Theme: ${themePreferenceLabel(preference)}`}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
