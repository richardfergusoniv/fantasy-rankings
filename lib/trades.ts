import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Historical trades logic, extracted from app/server/src/actions.ts.
 *
 * Hatch → Vercel transformations:
 * - `ctx.db<typeof schema>()` → imported `db` singleton
 * - `ctx: Ctx` parameters removed
 * - `z` from "zod" instead of "@hatch/space-sdk"
 * - `seasonLongFormatForLeague(...).isDynasty` → simplified `isDynastyLeague()`
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLEEPER_BASE = "https://api.sleeper.app/v1";
const SLEEPER_USER_ID = process.env.OWNER_SLEEPER_USER_ID?.trim() ?? "";
const HISTORICAL_TRADES_CACHE_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_PLAYERS_CACHE_KEY = "sleeper-players-nfl";
const HISTORICAL_PLAYERS_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Sleeper API types
// ---------------------------------------------------------------------------

type SleeperLeague = {
  league_id: string;
  name: string;
  season?: string;
  previous_league_id?: string | null;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: { type?: number; reserve_slots?: number; taxi_slots?: number; draft_rounds?: number };
  total_rosters?: number;
};

type SleeperRoster = {
  roster_id: number;
  owner_id?: string;
  players?: string[];
  starters?: string[];
  settings?: { wins?: number; losses?: number; ties?: number };
  metadata?: { team_name?: string };
};

type SleeperUser = {
  user_id: string;
  display_name?: string;
  metadata?: { team_name?: string };
};

type SleeperTransaction = {
  transaction_id?: string;
  type?: string;
  status?: string;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  draft_picks?: Array<{
    season?: string;
    round?: number;
    roster_id?: number;
    previous_owner_id?: number;
    owner_id?: number;
  }> | null;
  waiver_budget?: Array<{ sender?: number; receiver?: number; amount?: number }> | null;
  created?: number;
  leg?: number;
};

type SleeperPlayer = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
  injury_status?: string | null;
  injury_notes?: string | null;
  status?: string | null;
  years_exp?: number | null;
};

type SleeperDraft = {
  draft_id?: string;
  league_id?: string | null;
  season?: string;
  status?: string;
  type?: string;
  start_time?: number | null;
  last_picked?: number | null;
  settings?: { rounds?: number; teams?: number };
  draft_order?: Record<string, number>;
  slot_to_roster_id?: Record<string, number | null>;
  metadata?: { name?: string };
};

type SleeperDraftPick = {
  pick_no?: number;
  round?: number;
  draft_slot?: number;
  roster_id?: number | null;
  picked_by?: string | number | null;
  player_id?: string;
  metadata?: { first_name?: string; last_name?: string; team?: string; position?: string; player_id?: string };
};

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

const historicalTradePlayerSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  position: z.string(),
  fromRosterId: z.number().int().nullable(),
});

const historicalTradePickSchema = z.object({
  season: z.number().int(),
  round: z.number().int(),
  description: z.string(),
  fromRosterId: z.number().int().nullable(),
  draftedPlayerId: z.string().nullable(),
  draftedPlayerName: z.string().nullable(),
});

const historicalTradeTeamSchema = z.object({
  rosterId: z.number().int(),
  ownerId: z.string().nullable(),
  teamName: z.string(),
  isUserTeam: z.boolean(),
  assets: z.object({
    players: z.array(historicalTradePlayerSchema),
    picks: z.array(historicalTradePickSchema),
    faabReceived: z.number().int(),
  }),
});

const historicalTradeSchema = z.object({
  id: z.string(),
  season: z.number().int(),
  week: z.number().int(),
  createdAt: z.string().datetime(),
  teams: z.array(historicalTradeTeamSchema),
});

export const historicalTradesResponse = z.object({
  trades: z.array(historicalTradeSchema),
  seasons: z.array(z.number().int()),
  asOf: z.string(),
  isStale: z.boolean(),
  sourceErrors: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Fetch utilities
// ---------------------------------------------------------------------------

async function withDeadline<T>(operation: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error("Source request timed out"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  return await withDeadline(
    (async () => {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      return (await response.json()) as T;
    })(),
    15000,
    () => controller.abort(),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDynastyLeague(league: SleeperLeague): boolean {
  return league.settings?.type === 2 || league.name.toLowerCase().includes("dynasty");
}

function ordinalRound(value: number): string {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}

function sleeperTeamName(roster: SleeperRoster, usersById: Map<string, SleeperUser>): string {
  const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
  return (
    roster.metadata?.team_name ??
    owner?.metadata?.team_name ??
    owner?.display_name ??
    `Team ${roster.roster_id}`
  );
}

type KickerChainEntry = {
  ordinal: number;
  round: number;
  kickerDrafterRosterId: number;
  rookiePickerRosterId: number;
  rookiePlayerId: string;
};

type PlaceholderDraftResolution = {
  season: number;
  cutoffMs: number;
  maxRound: number;
  kickerChain: KickerChainEntry[];
};

type HistoricalDraftResolution = {
  byOriginalPick: Map<string, string>;
  placeholderByLeagueId: Map<string, PlaceholderDraftResolution>;
};

const historicalDraftPickMapEntriesSchema = z.array(z.tuple([z.string(), z.string()]));
const kickerChainEntrySchema = z.object({
  ordinal: z.number().int(),
  round: z.number().int(),
  kickerDrafterRosterId: z.number().int(),
  rookiePickerRosterId: z.number().int(),
  rookiePlayerId: z.string(),
});
const historicalDraftPickMapCacheSchema = z.object({
  entries: historicalDraftPickMapEntriesSchema,
  placeholders: z.array(
    z.object({
      leagueId: z.string(),
      season: z.number().int(),
      cutoffMs: z.number(),
      maxRound: z.number().int(),
      kickerChain: z.array(kickerChainEntrySchema),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Draft pick map
// ---------------------------------------------------------------------------

async function loadHistoricalDraftPickMap(
  rootLeagueId: string,
  leagueChain: SleeperLeague[],
  forceRefresh: boolean,
): Promise<HistoricalDraftResolution> {
  const cacheKey = `historical-draft-pick-map:${rootLeagueId}`;
  const cachedRows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, cacheKey))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && !forceRefresh) {
    try {
      const parsed = historicalDraftPickMapCacheSchema.parse(JSON.parse(cached.payload));
      return {
        byOriginalPick: new Map(parsed.entries),
        placeholderByLeagueId: new Map(
          parsed.placeholders.map((placeholder) => [
            placeholder.leagueId,
            {
              season: placeholder.season,
              cutoffMs: placeholder.cutoffMs,
              maxRound: placeholder.maxRound,
              kickerChain: placeholder.kickerChain,
            } satisfies PlaceholderDraftResolution,
          ]),
        ),
      };
    } catch {
      try {
        return {
          byOriginalPick: new Map(historicalDraftPickMapEntriesSchema.parse(JSON.parse(cached.payload))),
          placeholderByLeagueId: new Map(),
        };
      } catch {
        // Rebuild a malformed cache entry from Sleeper's immutable draft history.
      }
    }
  }

  const draftedPlayersByOriginalPick = new Map<string, string>();
  const placeholderByLeagueId = new Map<string, PlaceholderDraftResolution>();
  for (const league of leagueChain) {
    try {
      const [rosters, drafts] = await Promise.all([
        fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`),
        fetchJson<SleeperDraft[]>(`${SLEEPER_BASE}/league/${league.league_id}/drafts`),
      ]);
      const rosterIdByOwnerId = new Map(
        rosters.flatMap((roster) =>
          roster.owner_id ? [[roster.owner_id, roster.roster_id] as const] : [],
        ),
      );
      const draftsWithPicks: Array<{ draft: SleeperDraft; picks: SleeperDraftPick[] }> = [];
      for (const draft of drafts) {
        if (!draft.draft_id) continue;
        try {
          let resolvedDraft = draft;
          try {
            const draftDetail = await fetchJson<SleeperDraft>(`${SLEEPER_BASE}/draft/${draft.draft_id}`);
            resolvedDraft = { ...draft, ...draftDetail };
          } catch {
            // The league draft list still provides the legacy draft_order fallback when detail is unavailable.
          }
          const picks = await fetchJson<SleeperDraftPick[]>(`${SLEEPER_BASE}/draft/${draft.draft_id}/picks`);
          draftsWithPicks.push({ draft: resolvedDraft, picks });
        } catch {
          // An unreadable draft should not prevent other drafts in this league from contributing.
        }
      }

      const rookiePlayerBySnakePick = new Map<string, Map<number, string>>();
      for (const snake of draftsWithPicks) {
        if (snake.draft.type !== "snake" || !snake.draft.draft_id) continue;
        const draftSeason = Number(snake.draft.season ?? league.season);
        if (!Number.isInteger(draftSeason)) continue;
        const kickerPicks = snake.picks
          .filter((pick) => pick.metadata?.position === "K")
          .sort((a, b) => Number(a.pick_no ?? 0) - Number(b.pick_no ?? 0));
        if (kickerPicks.length === 0) continue;
        const linear = draftsWithPicks.find(
          (candidate) =>
            candidate.draft.type === "linear" &&
            Number(candidate.draft.season ?? league.season) === draftSeason &&
            candidate.picks.length === kickerPicks.length,
        );
        if (!linear) continue;
        const linearPickByNumber = new Map<number, SleeperDraftPick>();
        for (const pick of [...linear.picks].sort((a, b) => Number(a.pick_no ?? 0) - Number(b.pick_no ?? 0))) {
          const pickNo = Number(pick.pick_no);
          if (Number.isInteger(pickNo)) linearPickByNumber.set(pickNo, pick);
        }
        const rookieBySnakePickNo = new Map<number, string>();
        kickerPicks.forEach((kickerPick, index) => {
          const snakePickNo = Number(kickerPick.pick_no);
          const rookiePick = linearPickByNumber.get(index + 1);
          const rookiePlayerId = rookiePick?.player_id ?? rookiePick?.metadata?.player_id;
          if (Number.isInteger(snakePickNo) && rookiePlayerId) {
            rookieBySnakePickNo.set(snakePickNo, rookiePlayerId);
          }
        });
        rookiePlayerBySnakePick.set(snake.draft.draft_id, rookieBySnakePickNo);

        const linearMaxRound = Math.max(
          0,
          ...linear.picks.map((pick) => Number(pick.round)).filter(Number.isInteger),
        );
        const picksPerRound = linearMaxRound > 0 ? kickerPicks.length / linearMaxRound : 0;
        if (linearMaxRound > 0 && Number.isInteger(picksPerRound) && picksPerRound > 0) {
          const kickerChain: KickerChainEntry[] = [];
          kickerPicks.forEach((kickerPick, index) => {
            const ordinal = index + 1;
            const round = Math.ceil(ordinal / picksPerRound);
            const kickerPickedBy = kickerPick.picked_by;
            const kickerDrafterRosterId =
              kickerPickedBy === null || kickerPickedBy === undefined
                ? undefined
                : rosterIdByOwnerId.get(String(kickerPickedBy));
            const rookiePick = linearPickByNumber.get(ordinal);
            const rookiePickedBy = rookiePick?.picked_by;
            const rookiePickerRosterId =
              rookiePickedBy === null || rookiePickedBy === undefined
                ? undefined
                : rosterIdByOwnerId.get(String(rookiePickedBy));
            const rookiePlayerId = rookiePick?.player_id ?? rookiePick?.metadata?.player_id;
            if (
              kickerDrafterRosterId !== undefined &&
              rookiePickerRosterId !== undefined &&
              rookiePlayerId &&
              round >= 1 &&
              round <= linearMaxRound
            ) {
              kickerChain.push({
                ordinal,
                round,
                kickerDrafterRosterId,
                rookiePickerRosterId,
                rookiePlayerId,
              });
            }
          });
          const cutoffMs = Number(snake.draft.last_picked);
          if (Number.isFinite(cutoffMs) && cutoffMs > 0 && kickerChain.length > 0) {
            const existing = placeholderByLeagueId.get(league.league_id);
            if (!existing || cutoffMs > existing.cutoffMs) {
              placeholderByLeagueId.set(league.league_id, {
                season: draftSeason,
                cutoffMs,
                maxRound: linearMaxRound,
                kickerChain,
              });
            }
          }
        }
      }

      for (const { draft, picks } of draftsWithPicks) {
        const rosterIdByDraftSlot = new Map<number, number>();
        for (const [rawSlot, rawRosterId] of Object.entries(draft.slot_to_roster_id ?? {})) {
          if (rawSlot.trim() === "" || rawRosterId === null) continue;
          const slot = Number(rawSlot);
          const rosterId = Number(rawRosterId);
          if (Number.isInteger(slot) && Number.isInteger(rosterId)) {
            rosterIdByDraftSlot.set(slot, rosterId);
          }
        }
        if (rosterIdByDraftSlot.size === 0) {
          for (const [ownerId, rawSlot] of Object.entries(draft.draft_order ?? {})) {
            const slot = Number(rawSlot);
            const rosterId = rosterIdByOwnerId.get(ownerId);
            if (Number.isInteger(slot) && rosterId !== undefined) {
              rosterIdByDraftSlot.set(slot, rosterId);
            }
          }
        }
        const draftSeason = Number(draft.season ?? league.season);
        if (!Number.isInteger(draftSeason)) continue;
        const rookieBySnakePickNo = draft.draft_id ? rookiePlayerBySnakePick.get(draft.draft_id) : undefined;
        for (const pick of picks) {
          const round = Number(pick.round);
          const draftSlot = Number(pick.draft_slot);
          const pickedPlayerId = pick.player_id ?? pick.metadata?.player_id;
          const mappedRookiePlayerId =
            draft.type === "snake" && pick.metadata?.position === "K"
              ? rookieBySnakePickNo?.get(Number(pick.pick_no))
              : undefined;
          const playerId = mappedRookiePlayerId ?? pickedPlayerId;
          const originalRosterId = rosterIdByDraftSlot.get(draftSlot);
          if (!Number.isInteger(round) || originalRosterId === undefined || !playerId) continue;
          draftedPlayersByOriginalPick.set(`${draftSeason}:${round}:${originalRosterId}`, playerId);
        }
      }
    } catch {
      // A league without readable rosters or drafts should not block the rest of the chain.
    }
  }

  const fetchedAt = new Date();
  const payload = JSON.stringify({
    entries: [...draftedPlayersByOriginalPick.entries()],
    placeholders: [...placeholderByLeagueId.entries()].map(([leagueId, placeholder]) => ({
      leagueId,
      season: placeholder.season,
      cutoffMs: placeholder.cutoffMs,
      maxRound: placeholder.maxRound,
      kickerChain: placeholder.kickerChain,
    })),
  });
  await db.insert(schema.sourceCache).values({ cacheKey, payload, fetchedAt }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload, fetchedAt },
  });
  return { byOriginalPick: draftedPlayersByOriginalPick, placeholderByLeagueId };
}

function parseHistoricalPlayerMap(payload: string): Record<string, SleeperPlayer> {
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Sleeper player cache is malformed.");
  }
  return parsed as Record<string, SleeperPlayer>;
}

async function loadHistoricalPlayerMap(forceRefresh: boolean): Promise<Record<string, SleeperPlayer>> {
  const cachedRows = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, HISTORICAL_PLAYERS_CACHE_KEY))
    .limit(1);
  const cached = cachedRows[0];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt.getTime() < HISTORICAL_PLAYERS_CACHE_MS) {
    try {
      return parseHistoricalPlayerMap(cached.payload);
    } catch {
      // Replace malformed cached player metadata below.
    }
  }

  try {
    const fresh = await fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`);
    const fetchedAt = new Date();
    const payload = JSON.stringify(fresh);
    await db.insert(schema.sourceCache).values({ cacheKey: HISTORICAL_PLAYERS_CACHE_KEY, payload, fetchedAt }).onConflictDoUpdate({
      target: schema.sourceCache.cacheKey,
      set: { payload, fetchedAt },
    });
    return fresh;
  } catch (error) {
    if (cached) {
      try {
        return parseHistoricalPlayerMap(cached.payload);
      } catch {
        // Preserve the original Sleeper fetch failure when no usable cache exists.
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Season fetcher
// ---------------------------------------------------------------------------

async function fetchHistoricalSeason(
  league: SleeperLeague,
  players: Record<string, SleeperPlayer>,
  draftResolution: HistoricalDraftResolution,
): Promise<z.infer<typeof historicalTradeSchema>[]> {
  const [rosters, users] = await Promise.all([
    fetchJson<SleeperRoster[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`),
    fetchJson<SleeperUser[]>(`${SLEEPER_BASE}/league/${league.league_id}/users`),
  ]);
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const rostersById = new Map(rosters.map((roster) => [roster.roster_id, roster]));
  const draftedPlayersByOriginalPick = draftResolution.byOriginalPick;
  const placeholder = league.league_id ? draftResolution.placeholderByLeagueId.get(league.league_id) : undefined;
  const season = Number(league.season ?? 0);
  const trades = new Map<string, z.infer<typeof historicalTradeSchema>>();

  const weeklyTransactions = await Promise.all(
    Array.from({ length: 18 }, (_, index) => {
      const round = index + 1;
      return fetchJson<SleeperTransaction[]>(`${SLEEPER_BASE}/league/${league.league_id}/transactions/${round}`).then(
        (transactions) => ({ round, transactions }),
      );
    }),
  );

  for (const { round, transactions } of weeklyTransactions) {
    for (const transaction of transactions) {
      if (transaction.type !== "trade" || transaction.status !== "complete") continue;
      const transactionId = transaction.transaction_id;
      const rosterIds = transaction.roster_ids ?? [];
      if (!transactionId || rosterIds.length < 2) continue;
      const adds = transaction.adds ?? {};
      const drops = transaction.drops ?? {};
      const picks = transaction.draft_picks ?? [];
      const waiverBudget = transaction.waiver_budget ?? [];
      const createdMs = typeof transaction.created === "number" ? transaction.created : 0;
      const rookiePickByAsset = new Map<(typeof picks)[number], string | null>();
      if (placeholder) {
        type GroupEntry = { pick: (typeof picks)[number]; trader: number; round: number };
        const groups = new Map<string, GroupEntry[]>();
        for (const pick of picks) {
          const pickSeason = Number(pick.season);
          const pickRound = Number(pick.round);
          if (!Number.isInteger(pickSeason) || !Number.isInteger(pickRound)) continue;
          if (pickSeason !== placeholder.season) continue;
          if (createdMs < placeholder.cutoffMs) continue;
          rookiePickByAsset.set(pick, null);
          if (pickRound > placeholder.maxRound) continue;
          const trader = pick.previous_owner_id ?? null;
          if (trader === null) continue;
          const groupKey = `${pickSeason}:${pickRound}:${trader}`;
          const entry: GroupEntry = { pick, trader, round: pickRound };
          const group = groups.get(groupKey);
          if (group) group.push(entry);
          else groups.set(groupKey, [entry]);
        }
        for (const group of groups.values()) {
          const first = group[0];
          if (!first) continue;
          const { trader, round } = first;
          const matches = placeholder.kickerChain
            .filter(
              (entry) =>
                entry.round === round &&
                entry.kickerDrafterRosterId === trader &&
                entry.rookiePickerRosterId !== trader,
            )
            .sort((a, b) => a.ordinal - b.ordinal);
          group.forEach(({ pick }, index) => {
            rookiePickByAsset.set(pick, matches[index]?.rookiePlayerId ?? null);
          });
        }
      }
      const teams = rosterIds.map((rosterId) => {
        const roster = rostersById.get(rosterId);
        const ownerId = roster?.owner_id ?? null;
        const receivedPlayers = Object.entries(adds)
          .filter(([, destinationRosterId]) => destinationRosterId === rosterId)
          .map(([playerId]) => {
            const player = players[playerId];
            const name =
              player?.full_name ?? ([player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown player");
            return {
              playerId,
              name,
              position: player?.position ?? "N/A",
              fromRosterId: drops[playerId] ?? null,
            };
          });
        const receivedPicks = picks
          .filter((pick) => pick.owner_id === rosterId)
          .flatMap((pick) => {
            const pickSeason = Number(pick.season);
            const pickRound = Number(pick.round);
            if (!Number.isInteger(pickSeason) || !Number.isInteger(pickRound)) return [];
            const originalRosterId = pick.roster_id ?? pick.previous_owner_id ?? null;
            const draftedPlayerId = rookiePickByAsset.has(pick)
              ? (rookiePickByAsset.get(pick) ?? null)
              : originalRosterId === null
                ? null
                : (draftedPlayersByOriginalPick.get(`${pickSeason}:${pickRound}:${originalRosterId}`) ?? null);
            const draftedPlayer = draftedPlayerId ? players[draftedPlayerId] : undefined;
            const draftedPlayerName = draftedPlayer
              ? (draftedPlayer.full_name ?? ([draftedPlayer.first_name, draftedPlayer.last_name].filter(Boolean).join(" ") || null))
              : null;
            return [
              {
                season: pickSeason,
                round: pickRound,
                description: `${pickSeason} ${ordinalRound(pickRound)}-round pick`,
                fromRosterId: pick.previous_owner_id ?? pick.roster_id ?? null,
                draftedPlayerId,
                draftedPlayerName,
              },
            ];
          });
        const faabReceived = waiverBudget
          .filter((entry) => entry.receiver === rosterId && typeof entry.amount === "number")
          .reduce((total, entry) => total + (entry.amount ?? 0), 0);
        return {
          rosterId,
          ownerId,
          teamName: roster ? sleeperTeamName(roster, usersById) : `Team ${rosterId}`,
          isUserTeam: ownerId === SLEEPER_USER_ID,
          assets: { players: receivedPlayers, picks: receivedPicks, faabReceived },
        };
      });
      const created = createdMs;
      trades.set(
        transactionId,
        historicalTradeSchema.parse({
          id: transactionId,
          season,
          week: transaction.leg ?? round,
          createdAt: new Date(created).toISOString(),
          teams,
        }),
      );
    }
  }
  return [...trades.values()].sort((a, b) => b.week - a.week || b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export async function loadHistoricalTrades(
  leagueId: string,
  forceRefresh: boolean,
  requestedSeason?: number,
): Promise<z.infer<typeof historicalTradesResponse>> {
  const sourceErrors: string[] = [];
  const currentLeague = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${leagueId}`);
  const dynasty = isDynastyLeague(currentLeague);
  const leagueChain: SleeperLeague[] = [];
  const seen = new Set<string>();
  let cursor: SleeperLeague | null = currentLeague;
  while (cursor && !seen.has(cursor.league_id) && leagueChain.length < 20) {
    leagueChain.push(cursor);
    seen.add(cursor.league_id);
    if (!dynasty) break;
    const previousId: string | null | undefined = cursor.previous_league_id;
    if (!previousId || previousId === "0") break;
    try {
      cursor = await fetchJson<SleeperLeague>(`${SLEEPER_BASE}/league/${previousId}`);
    } catch {
      sourceErrors.push("An older Sleeper season could not be loaded.");
      break;
    }
  }

  const draftResolution = await loadHistoricalDraftPickMap(leagueId, leagueChain, forceRefresh);

  const currentSeason = Number(currentLeague.season ?? 0);
  const seasons = [
    ...new Set(
      leagueChain
        .map((league) => Number(league.season ?? 0))
        .filter((season) => Number.isInteger(season) && season > 0),
    ),
  ].sort((a, b) => b - a);
  const requestedLeagues =
    requestedSeason === undefined
      ? leagueChain
      : leagueChain.filter((league) => Number(league.season ?? 0) === requestedSeason);
  let playerMap: Record<string, SleeperPlayer> | null = null;
  const collected: z.infer<typeof historicalTradeSchema>[] = [];
  let newestFetch = new Date(0);
  let isStale = false;

  for (const league of requestedLeagues) {
    const season = Number(league.season ?? 0);
    if (!Number.isInteger(season) || season <= 0) continue;
    const cacheId = `${league.league_id}:${season}`;
    const cachedRows = await db
      .select()
      .from(schema.historicalTrades)
      .where(eq(schema.historicalTrades.id, cacheId))
      .limit(1);
    const cached = cachedRows[0];
    const isCurrentSeason = season === currentSeason;
    const cachedIsFresh = cached ? !isCurrentSeason || Date.now() - cached.fetchedAt.getTime() < HISTORICAL_TRADES_CACHE_MS : false;
    if (cached && !forceRefresh && (!isCurrentSeason || cachedIsFresh)) {
      try {
        collected.push(...z.array(historicalTradeSchema).parse(JSON.parse(cached.payload)));
        if (cached.fetchedAt > newestFetch) newestFetch = cached.fetchedAt;
        if (isCurrentSeason && !cachedIsFresh) isStale = true;
        continue;
      } catch {
        // Malformed cache is replaced by a fresh Sleeper snapshot below.
      }
    }
    try {
      playerMap ??= await loadHistoricalPlayerMap(forceRefresh);
      const fresh = await fetchHistoricalSeason(league, playerMap, draftResolution);
      const fetchedAt = new Date();
      await db.insert(schema.historicalTrades).values({
        id: cacheId,
        rootLeagueId: leagueId,
        sleeperLeagueId: league.league_id,
        season,
        payload: JSON.stringify(fresh),
        fetchedAt,
      }).onConflictDoUpdate({
        target: schema.historicalTrades.id,
        set: { rootLeagueId: leagueId, payload: JSON.stringify(fresh), fetchedAt },
      });
      collected.push(...fresh);
      if (fetchedAt > newestFetch) newestFetch = fetchedAt;
    } catch {
      if (cached) {
        try {
          collected.push(...z.array(historicalTradeSchema).parse(JSON.parse(cached.payload)));
          if (cached.fetchedAt > newestFetch) newestFetch = cached.fetchedAt;
          isStale = true;
          sourceErrors.push(`${season} could not refresh; showing the saved trade history.`);
          continue;
        } catch {
          // Honest season-level empty state below.
        }
      }
      sourceErrors.push(`${season} trade history is temporarily unavailable.`);
    }
  }

  return historicalTradesResponse.parse({
    trades: collected.sort(
      (a, b) => b.season - a.season || b.week - a.week || b.createdAt.localeCompare(a.createdAt),
    ),
    seasons,
    asOf: (newestFetch.getTime() > 0 ? newestFetch : new Date()).toISOString(),
    isStale,
    sourceErrors,
  });
}
