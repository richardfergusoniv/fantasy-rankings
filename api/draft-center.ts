import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./_lib/db.js";
import {
  internalError,
  json,
  queryBool,
  unauthorized,
} from "./_lib/api-utils.js";
import { resolveSleeperUserId } from "./_lib/auth.js";
import { readUserLeagues } from "./_lib/user-leagues.js";
import {
  DRAFT_MARKET_CACHE_KEY,
  DRAFT_MARKET_CACHE_MS,
  FFC_BASE_URL,
  REFRESH_TIMEOUT_MS,
  SLEEPER_BASE,
  fetchJson,
  mflAdpUrl,
  mflPlayersUrl,
  normalizePosition,
  normalizedPlayerName,
  parseNumber,
  seasonLongFormatForLeague,
  withDeadline,
  type FfcResponse,
  type MflAdpResponse,
  type MflPlayersResponse,
  type SleeperDraft,
  type SleeperDraftPick,
  type SleeperLeague,
  type SleeperPlayer,
  type SleeperTrend,
} from "./_lib/sleeper.js";

/**
 * GET /api/draft-center?force=
 *
 * Replaces `getDraftCenter`. Fetches Sleeper leagues/players, FFC + MFL ADP,
 * Sleeper trending adds/drops, and live draft rooms.
 *
 * NOTE: Polymarket/Kalshi/Action Network betting fetches are intentionally
 * skipped — the betting UI was removed per user request (2026-09-29), so that
 * code is dead weight. `markets` and `vegasLines` always return empty, and the
 * betting source-status flags stay false.
 */

// ---------------------------------------------------------------------------
// Schemas (verbatim from actions.ts)
// ---------------------------------------------------------------------------

const draftPickSchema = z.object({
  pickNo: z.number().int(),
  round: z.number().int(),
  draftSlot: z.number().int(),
  rosterId: z.number().int().nullable(),
  playerId: z.string(),
  playerName: z.string(),
  position: z.string(),
  team: z.string().nullable(),
});

const liveDraftSchema = z.object({
  draftId: z.string(),
  leagueId: z.string().nullable(),
  status: z.string(),
  type: z.string(),
  startTime: z.string().nullable(),
  rounds: z.number().int().nullable(),
  teams: z.number().int().nullable(),
  ownDraftSlot: z.number().int().nullable(),
  ownRosterId: z.number().int().nullable(),
  picks: z.array(draftPickSchema),
});

const adpRowSchema = z.object({
  format: z.string(),
  pool: z.enum(["all", "rookie"]),
  playerId: z.string().nullable(),
  name: z.string(),
  team: z.string().nullable(),
  position: z.string(),
  adp: z.number(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  timesDrafted: z.number().int().nullable(),
  mflAdp: z.number().nullable(),
});

const trendingRowSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  team: z.string().nullable(),
  position: z.string(),
  count: z.number().int(),
  rank: z.number().int(),
});

const marketSignalSchema = z.object({
  source: z.enum(["Polymarket", "Kalshi", "Action Network"]),
  scope: z.enum(["game", "season"]),
  title: z.string(),
  detail: z.string(),
  probability: z.number().nullable(),
  move: z.number().nullable().default(null),
  quote: z.string().nullable().default(null),
  betPct: z.number().nullable(),
  moneyPct: z.number().nullable(),
});

const vegasLineSchema = z.object({
  source: z.enum(["Polymarket", "Kalshi"]),
  matchupCode: z.string(),
  marketType: z.enum(["total", "spread"]),
  team: z.string().nullable(),
  line: z.number(),
  probability: z.number().nullable(),
});

const draftBoardModeSchema = z.object({
  leagueId: z.string(),
  mode: z.enum(["redraft", "startup", "rookie"]),
});

const draftCenterResponse = z.object({
  asOf: z.string(),
  adpAsOf: z.string().nullable(),
  adp: z.array(adpRowSchema),
  trending: z.array(trendingRowSchema),
  trendingDrops: z.array(trendingRowSchema),
  drafts: z.array(liveDraftSchema),
  boardModes: z.array(draftBoardModeSchema),
  markets: z.array(marketSignalSchema),
  vegasLines: z.array(vegasLineSchema),
  sourceStatus: z.object({
    ffc: z.boolean(),
    mfl: z.boolean(),
    sleeperTrending: z.boolean(),
    sleeperTrendingDrops: z.boolean(),
    polymarket: z.boolean(),
    kalshi: z.boolean(),
    actionNetwork: z.boolean(),
    fantasyProsLive: z.boolean(),
  }),
  sourceErrors: z.array(z.string()),
});

export type DraftCenter = z.infer<typeof draftCenterResponse>;

type CachedDraftMarket = {
  adpAsOf: string | null;
  adp: z.infer<typeof adpRowSchema>[];
  trending: z.infer<typeof trendingRowSchema>[];
  trendingDrops: z.infer<typeof trendingRowSchema>[];
  markets: z.infer<typeof marketSignalSchema>[];
  vegasLines: z.infer<typeof vegasLineSchema>[];
  sourceStatus: z.infer<typeof draftCenterResponse>["sourceStatus"];
  sourceErrors: string[];
};

// ---------------------------------------------------------------------------
// Draft market snapshot (ADP + trending only — no betting sources)
// ---------------------------------------------------------------------------

async function fetchDraftMarketSnapshot(
  leagues: SleeperLeague[],
  players: Record<string, SleeperPlayer>,
  season: number,
): Promise<CachedDraftMarket> {
  const sourceErrors: string[] = [];
  const sourceStatus = {
    ffc: false,
    mfl: false,
    sleeperTrending: false,
    sleeperTrendingDrops: false,
    // Betting sources are intentionally disabled (UI removed 2026-09-29).
    polymarket: false,
    kalshi: false,
    actionNetwork: false,
    fantasyProsLive: false,
  };
  const nameToSleeper = new Map<string, string[]>();
  for (const [playerId, player] of Object.entries(players)) {
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name || !["QB", "RB", "WR", "TE"].includes(normalizePosition(player.position))) continue;
    const key = normalizedPlayerName(name);
    nameToSleeper.set(key, [...(nameToSleeper.get(key) ?? []), playerId]);
  }
  const leagueFormats = leagues.flatMap((league) => {
    const format = seasonLongFormatForLeague(league);
    const ffcFormat = format.numQbs === 2 ? "2qb" : format.isDynasty ? "dynasty" : format.ppr === 1 ? "ppr" : format.ppr === 0.5 ? "half-ppr" : "standard";
    const allPlayers = { formatKey: format.key, ffcFormat, teams: format.numTeams, pool: "all" as const };
    return format.isDynasty
      ? [allPlayers, { formatKey: format.key, ffcFormat: "rookie", teams: format.numTeams, pool: "rookie" as const }]
      : [allPlayers];
  });
  const uniqueRequests = [...new Map(leagueFormats.map((item) => [`${item.ffcFormat}:${item.teams}`, item])).values()];

  const [ffcSettled, mflAdpResult, mflPlayersResult, trendResult, trendDropResult] = await Promise.all([
    Promise.allSettled(uniqueRequests.map(async (request) => ({
      request,
      response: await fetchJson<FfcResponse>(`${FFC_BASE_URL}/${request.ffcFormat}?teams=${request.teams}&year=${season}`),
    }))),
    fetchJson<MflAdpResponse>(mflAdpUrl(season)).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: null })),
    fetchJson<MflPlayersResponse>(mflPlayersUrl(season)).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: null })),
    fetchJson<SleeperTrend[]>(`${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=24&limit=50`).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] })),
    fetchJson<SleeperTrend[]>(`${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=24&limit=50`).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] })),
  ]);

  const mflByName = new Map<string, number>();
  if (mflAdpResult.ok && mflPlayersResult.ok) {
    const playerNames = new Map((mflPlayersResult.value?.players?.player ?? []).flatMap((row) => (row.id && row.name ? [[row.id, row.name] as const] : [])));
    for (const row of mflAdpResult.value?.adp?.player ?? []) {
      const name = row.id ? playerNames.get(row.id) : undefined;
      const adp = parseNumber(row.averagePick);
      if (name && adp !== null) mflByName.set(normalizedPlayerName(name.includes(",") ? name.split(",").reverse().join(" ") : name), adp);
    }
    sourceStatus.mfl = true;
  } else sourceErrors.push("MyFantasyLeague ADP cross-check is temporarily unavailable.");

  const fetchedByRequest = new Map<string, FfcResponse["players"]>();
  for (const result of ffcSettled) {
    if (result.status !== "fulfilled") continue;
    fetchedByRequest.set(`${result.value.request.ffcFormat}:${result.value.request.teams}`, result.value.response.players ?? []);
  }
  sourceStatus.ffc = fetchedByRequest.size > 0;
  if (!sourceStatus.ffc) sourceErrors.push("Fantasy Football Calculator ADP is temporarily unavailable.");
  const adp = leagueFormats.flatMap(({ formatKey, ffcFormat, teams, pool }) => (fetchedByRequest.get(`${ffcFormat}:${teams}`) ?? []).flatMap((row) => {
    const name = row.name?.trim();
    const adpValue = parseNumber(row.adp);
    if (!name || adpValue === null) return [];
    const candidates = nameToSleeper.get(normalizedPlayerName(name)) ?? [];
    const sleeperId = candidates.find((candidate) => {
      const player = players[candidate];
      return normalizePosition(player?.position) === normalizePosition(row.position) && (!row.team || !player?.team || player.team === row.team);
    }) ?? candidates.find((candidate) => normalizePosition(players[candidate]?.position) === normalizePosition(row.position)) ?? candidates[0] ?? null;
    const sleeper = sleeperId ? players[sleeperId] : undefined;
    return [{
      format: formatKey,
      pool,
      playerId: sleeperId,
      name,
      team: sleeper?.team ?? row.team ?? null,
      position: normalizePosition(sleeper?.position ?? row.position),
      adp: adpValue,
      high: parseNumber(row.high),
      low: parseNumber(row.low),
      timesDrafted: parseNumber(row.times_drafted) === null ? null : Math.round(parseNumber(row.times_drafted) ?? 0),
      mflAdp: mflByName.get(normalizedPlayerName(name)) ?? null,
    }];
  }));

  const trending = trendResult.value.flatMap((row, index) => {
    const playerId = row.player_id;
    const count = parseNumber(row.count);
    const player = playerId ? players[playerId] : undefined;
    if (!playerId || !player || count === null) return [];
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name) return [];
    return [{ playerId, name, team: player.team ?? null, position: normalizePosition(player.position), count: Math.round(count), rank: index + 1 }];
  });
  sourceStatus.sleeperTrending = trendResult.ok;
  if (!trendResult.ok) sourceErrors.push("Sleeper trending adds are temporarily unavailable.");
  const trendingDrops = trendDropResult.value.flatMap((row, index) => {
    const playerId = row.player_id;
    const count = parseNumber(row.count);
    const player = playerId ? players[playerId] : undefined;
    if (!playerId || !player || count === null) return [];
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name) return [];
    return [{ playerId, name, team: player.team ?? null, position: normalizePosition(player.position), count: Math.round(count), rank: index + 1 }];
  });
  sourceStatus.sleeperTrendingDrops = trendDropResult.ok;
  if (!trendDropResult.ok) sourceErrors.push("Sleeper trending drops are temporarily unavailable.");

  return {
    adpAsOf: adp.length > 0 ? new Date().toISOString() : null,
    adp,
    trending,
    trendingDrops,
    markets: [],
    vegasLines: [],
    sourceStatus,
    sourceErrors,
  };
}

async function loadDraftMarketSnapshot(
  force: boolean,
  leagues: SleeperLeague[],
  players: Record<string, SleeperPlayer>,
  season: number,
): Promise<CachedDraftMarket> {
  const rows = await db.select().from(schema.sourceCache).where(eq(schema.sourceCache.cacheKey, DRAFT_MARKET_CACHE_KEY)).limit(1);
  const cached = rows[0];
  if (!force && cached && Date.now() - cached.fetchedAt.getTime() < DRAFT_MARKET_CACHE_MS) {
    try {
      return draftCenterResponse.pick({ adpAsOf: true, adp: true, trending: true, trendingDrops: true, markets: true, vegasLines: true, sourceStatus: true, sourceErrors: true }).parse(JSON.parse(cached.payload));
    } catch { /* Refresh malformed or old cache below. */ }
  }
  try {
    const fresh = await withDeadline(fetchDraftMarketSnapshot(leagues, players, season), REFRESH_TIMEOUT_MS);
    await db.insert(schema.sourceCache).values({ cacheKey: DRAFT_MARKET_CACHE_KEY, payload: JSON.stringify(fresh), fetchedAt: new Date() })
      .onConflictDoUpdate({ target: schema.sourceCache.cacheKey, set: { payload: JSON.stringify(fresh), fetchedAt: new Date() } });
    return fresh;
  } catch {
    if (cached) {
      try {
        const parsed = draftCenterResponse.pick({ adpAsOf: true, adp: true, trending: true, trendingDrops: true, markets: true, vegasLines: true, sourceStatus: true, sourceErrors: true }).parse(JSON.parse(cached.payload));
        return { ...parsed, sourceErrors: [...parsed.sourceErrors, "Market refresh failed; showing the last saved snapshot."] };
      } catch { /* Empty state below. */ }
    }
    return {
      adpAsOf: null,
      adp: [],
      trending: [],
      trendingDrops: [],
      markets: [],
      vegasLines: [],
      sourceStatus: { ffc: false, mfl: false, sleeperTrending: false, sleeperTrendingDrops: false, polymarket: false, kalshi: false, actionNetwork: false, fantasyProsLive: false },
      sourceErrors: ["Draft and market sources are temporarily unavailable."],
    };
  }
}

function draftBoardModesForLeagues(leagues: SleeperLeague[]): z.infer<typeof draftBoardModeSchema>[] {
  return leagues.map((league) => {
    const format = seasonLongFormatForLeague(league);
    if (!format.isDynasty) return { leagueId: league.league_id, mode: "redraft" as const };
    const hasPreviousLeague = typeof league.previous_league_id === "string"
      && league.previous_league_id.length > 0
      && league.previous_league_id !== "0";
    return { leagueId: league.league_id, mode: hasPreviousLeague ? "rookie" as const : "startup" as const };
  });
}

async function fetchLiveDrafts(
  players: Record<string, SleeperPlayer>,
  sleeperUserId: string,
  season: number,
): Promise<z.infer<typeof liveDraftSchema>[]> {
  const drafts = await fetchJson<SleeperDraft[]>(`${SLEEPER_BASE}/user/${sleeperUserId}/drafts/nfl/${season}`);
  const relevant = drafts.filter((draft) => draft.draft_id);
  const details = await Promise.allSettled(relevant.map(async (summary) => {
    const draftId = summary.draft_id ?? "";
    const [draft, picks] = await Promise.all([
      fetchJson<SleeperDraft>(`${SLEEPER_BASE}/draft/${draftId}`),
      fetchJson<SleeperDraftPick[]>(`${SLEEPER_BASE}/draft/${draftId}/picks`),
    ]);
    const userSlots = (draft as SleeperDraft & { metadata?: SleeperDraft["metadata"] & { user_id_to_draft_slot?: string } }).metadata?.user_id_to_draft_slot;
    let ownDraftSlot: number | null = parseNumber(draft.draft_order?.[sleeperUserId]);
    if (ownDraftSlot === null && userSlots) {
      try {
        const parsed = JSON.parse(userSlots) as Record<string, number>;
        ownDraftSlot = parseNumber(parsed[sleeperUserId]);
      } catch { /* Some drafts omit this mapping until the room opens. */ }
    }
    const ownRosterId = ownDraftSlot === null ? null : parseNumber(draft.slot_to_roster_id?.[String(ownDraftSlot)]);
    return {
      draftId,
      leagueId: draft.league_id ?? summary.league_id ?? null,
      status: draft.status ?? summary.status ?? "unknown",
      type: draft.type ?? summary.type ?? "snake",
      startTime: typeof draft.start_time === "number" ? new Date(draft.start_time).toISOString() : null,
      rounds: parseNumber(draft.settings?.rounds) === null ? null : Math.round(parseNumber(draft.settings?.rounds) ?? 0),
      teams: parseNumber(draft.settings?.teams) === null ? null : Math.round(parseNumber(draft.settings?.teams) ?? 0),
      ownDraftSlot: ownDraftSlot === null ? null : Math.round(ownDraftSlot),
      ownRosterId: ownRosterId === null ? null : Math.round(ownRosterId),
      picks: picks.map((pick) => {
        const playerId = pick.player_id ?? pick.metadata?.player_id ?? "";
        const player = players[playerId];
        const name = player?.full_name ?? ([pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ") || "Unknown player");
        return {
          pickNo: Math.round(parseNumber(pick.pick_no) ?? 0),
          round: Math.round(parseNumber(pick.round) ?? 0),
          draftSlot: Math.round(parseNumber(pick.draft_slot) ?? 0),
          rosterId: parseNumber(pick.roster_id) === null ? null : Math.round(parseNumber(pick.roster_id) ?? 0),
          playerId,
          playerName: name,
          position: normalizePosition(player?.position ?? pick.metadata?.position),
          team: player?.team ?? pick.metadata?.team ?? null,
        };
      }).filter((pick) => pick.playerId),
    };
  }));
  return details.flatMap((result) => result.status === "fulfilled" ? [result.value] : []).sort((a, b) => {
    const priority = (status: string) => status === "drafting" ? 0 : status === "pre_draft" ? 1 : status === "complete" ? 2 : 3;
    const statusOrder = priority(a.status) - priority(b.status);
    if (statusOrder !== 0) return statusOrder;
    return (b.startTime ?? "").localeCompare(a.startTime ?? "");
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  try {
    const sleeperUserId = await resolveSleeperUserId(req);
    if (!sleeperUserId) return unauthorized("Sign in required.");

    const url = new URL(req.url, "https://localhost");
    const force = queryBool(url, "force", false);

    const errors: string[] = [];
    const [leaguesResult, playersResult] = await Promise.allSettled([
      readUserLeagues(sleeperUserId, force),
      fetchJson<Record<string, SleeperPlayer>>(`${SLEEPER_BASE}/players/nfl`),
    ]);
    const season = leaguesResult.status === "fulfilled"
      ? leaguesResult.value.season
      : new Date().getUTCFullYear();
    const leagues = leaguesResult.status === "fulfilled" ? leaguesResult.value.leagues : [];
    const players = playersResult.status === "fulfilled" ? playersResult.value : {};
    if (leaguesResult.status === "rejected") errors.push("Sleeper league formats are temporarily unavailable.");
    if (leaguesResult.status === "fulfilled" && leagues.length === 0) errors.push("No Sleeper leagues for this season.");
    if (playersResult.status === "rejected") errors.push("Sleeper player data is temporarily unavailable.");
    const market = await loadDraftMarketSnapshot(force, leagues, players, season);
    let drafts: z.infer<typeof liveDraftSchema>[] = [];
    try {
      drafts = await withDeadline(fetchLiveDrafts(players, sleeperUserId, season), 20_000);
    } catch {
      errors.push("Sleeper draft rooms are temporarily unavailable.");
    }
    return json(draftCenterResponse.parse({
      asOf: new Date().toISOString(),
      ...market,
      drafts,
      boardModes: draftBoardModesForLeagues(leagues),
      sourceErrors: [...new Set([...market.sourceErrors, ...errors])],
    }));
  } catch (err) {
    return internalError(err);
  }
}
