import { json, methodNotAllowed } from "../_lib/api-utils.js";
import { handleBoxScore } from "../_lib/box-score.js";
import { handlePfnTables } from "../_lib/pfn-tables.js";
import { handleTradesHistory } from "../_lib/trades-history.js";
import { handleValueHistory } from "../_lib/value-history.js";

/**
 * GET /api/data/:kind
 *   kind = box-score | pfn-tables | value-history | trades-history
 *
 * Single function for four former read-only routes so the project stays
 * inside Vercel's Hobby function budget. Old URLs are rewritten in
 * vercel.json and keep the same query params, auth, and response shapes:
 *   /api/box-score          → /api/data/box-score
 *   /api/pfn-tables         → /api/data/pfn-tables
 *   /api/value-history      → /api/data/value-history
 *   /api/trades/history     → /api/data/trades-history
 */

const DATA_KINDS = ["box-score", "pfn-tables", "value-history", "trades-history"] as const;
type DataKind = (typeof DATA_KINDS)[number];

function isDataKind(value: string): value is DataKind {
  return (DATA_KINDS as readonly string[]).includes(value);
}

function kindFromPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url, "https://localhost");
  const kind = kindFromPath(url.pathname);
  if (!isDataKind(kind)) {
    return json({ ok: false, error: "Unknown data kind." }, 404);
  }
  switch (kind) {
    case "box-score":
      return handleBoxScore(req);
    case "pfn-tables":
      return handlePfnTables(req);
    case "value-history":
      return handleValueHistory(req);
    case "trades-history":
      return handleTradesHistory(req);
    default: {
      const _exhaustive: never = kind;
      return json({ ok: false, error: `Unhandled data kind: ${_exhaustive}` }, 500);
    }
  }
}

export async function POST(req: Request): Promise<Response> {
  void req;
  return methodNotAllowed(["GET"]);
}
