/**
 * Defense-in-depth URL helpers. Zod's `.url()` accepts `javascript:` / `data:` /
 * `file:`; prefer these when a string will be stored or rendered as an href.
 */

export function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
