const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** Last name, skipping a suffix: "Cooper" for "Omar Cooper Jr.". */
export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts.at(-1)!.toLowerCase())) parts.pop();
  return parts.at(-1) ?? name;
}

/** "Hale" for "Marcus Hale", unless both players share a surname. */
export function comparisonShortName(name: string, other: string): string {
  const last = surname(name);
  return last.toLowerCase() === surname(other).toLowerCase() ? name : last;
}
