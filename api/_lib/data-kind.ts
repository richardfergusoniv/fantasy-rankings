/**
 * Path → kind for `api/data/[kind].ts`.
 *
 * Vercel rewrites keep the original pathname on the function request, so
 * `/api/trades/history` still ends in `history` — match that alias explicitly.
 * Direct `/api/data/:kind` paths use the final segment.
 */

export const DATA_KINDS = ["box-score", "pfn-tables", "value-history", "trades-history", "projected-standings"] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export function kindFromPath(pathname: string): DataKind | null {
  if (pathname.includes("/trades/history") || pathname.endsWith("/trades-history")) {
    return "trades-history";
  }
  if (pathname.endsWith("/projected-standings")) return "projected-standings";
  if (pathname.endsWith("/box-score")) return "box-score";
  if (pathname.endsWith("/pfn-tables")) return "pfn-tables";
  if (pathname.endsWith("/value-history")) return "value-history";
  return null;
}
