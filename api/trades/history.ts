import { z } from "zod";
import {
  badRequest,
  internalError,
  json,
  methodNotAllowed,
  queryBool,
  queryInt,
} from "../_lib/api-utils.js";
import { historicalTradesResponse, loadHistoricalTrades } from "../_lib/trades.js";

/**
 * GET /api/trades/history?leagueId=&refresh=&season=
 *
 * Replaces `getHistoricalTrades`.
 *
 * May be slow (walks the Sleeper previous_league chain for dynasty leagues);
 * vercel.json sets maxDuration: 120 for this route.
 */

const querySchema = z.object({
  leagueId: z.string().min(1),
  refresh: z.boolean().optional().default(false),
  season: z.number().int().positive().optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "https://localhost");
    const parsed = querySchema.safeParse({
      leagueId: url.searchParams.get("leagueId") ?? "",
      refresh: queryBool(url, "refresh", false),
      season: queryInt(url, "season"),
    });
    if (!parsed.success) {
      return badRequest("Invalid query params.", parsed.error.issues);
    }

    const result = await loadHistoricalTrades(parsed.data.leagueId, parsed.data.refresh, parsed.data.season);

    // Validate against the response contract before returning.
    const validated = historicalTradesResponse.safeParse(result);
    if (!validated.success) {
      return internalError(new Error("Trade history failed response validation."));
    }
    return json(validated.data);
  } catch (err) {
    return internalError(err);
  }
}

export const config = { maxDuration: 120 };
