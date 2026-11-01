/**
 * Waiver suggestions graded by move-scoring, with a FAAB bid for each. Pure: the
 * chat assistant's suggest_waivers tool and the dashboard build (Waivers rows and
 * the player card's bid) both call this, so they always agree.
 */
import type { Dashboard } from "./dashboard-schemas.js";
import { optimizeTradeRoster, optimizeValueTradeRoster } from "./lineup-optimizer.js";
import { moveVerdict, positionalNeed, scoreWaiver } from "./move-scoring.js";
import { suggestFaabBid } from "./faab-bid.js";
import type { WaiverLabel } from "./scoring/labels.js";
import type { ScoringWeightsParams } from "./scoring/weights.js";
import { redraftTwinFormat } from "./season-long-format.js";

type League = Dashboard["leagues"][number];

/** The league format's season-long values (dynasty values in dynasty leagues). */
function formatAssets(dashboard: Dashboard, league: League) {
  return dashboard.seasonLongRankings.filter((row) => row.formatKey === league.seasonLongFormat.key);
}

/** Season Long values: redraft twin in dynasty leagues, else the league format. */
function seasonLongAssets(dashboard: Dashboard, league: League) {
  if (!league.seasonLongFormat.isDynasty) return formatAssets(dashboard, league);
  const twinKey = redraftTwinFormat(league.seasonLongFormat).key;
  // Never fall back to dynasty values — an empty twin board means zeros.
  return dashboard.seasonLongRankings.filter((row) => row.formatKey === twinKey);
}

export function scoreWaiverSuggestions(
  dashboard: Dashboard,
  league: League,
  weights: ScoringWeightsParams,
  options: {
    limit?: number;
    position?: string;
    scoringWindow?: "week" | "season_long" | "dynasty" | null;
    /** Grade only this many free agents, the highest weekly projections first (the build's speed cap). */
    poolSize?: number;
  } = {},
) {
  const limit = Math.min(20, Math.max(1, Math.floor(options.limit ?? 10)));
  const rostered = new Set(league.rosteredPlayerIds);
  const slAssets = seasonLongAssets(dashboard, league);
  const dynastyAssets = league.seasonLongFormat.isDynasty
    ? formatAssets(dashboard, league)
    : slAssets;
  const seasonLongValueById = new Map(slAssets.map((row) => [row.playerId, row.value]));
  const dynastyValueById = new Map(dynastyAssets.map((row) => [row.playerId, row.value]));
  const valueById = seasonLongValueById;

  const myByPos = new Map<string, number>();
  for (const player of [...league.starters, ...league.bench]) {
    myByPos.set(player.position, (myByPos.get(player.position) ?? 0) + (valueById.get(player.playerId) ?? 0));
  }
  const power = league.powerRankingsSeasonLong.find((row) => row.isUser)
    ?? league.powerRankingsWeek.find((row) => row.isUser)
    ?? null;
  const weakPositions = power
    ? (["QB", "RB", "WR", "TE"] as const)
      .map((pos) => ({ pos, value: power.positionValues[pos] }))
      .sort((a, b) => a.value - b.value)
      .slice(0, 2)
      .map((row) => row.pos)
    : ["RB", "WR"];

  const pool = (league.tradeWaiverPool.length > 0
    ? league.tradeWaiverPool
    : dashboard.rankings
      .filter((row) => row.leagueId === league.id && !rostered.has(row.playerId))
      .map((row) => ({
        playerId: row.playerId,
        name: row.name,
        team: row.team,
        position: row.position,
        projection: row.leagueProjection,
        injuryStatus: row.injuryStatus,
      })))
    .filter((player) => !rostered.has(player.playerId))
    .filter((player) => !options.position || player.position === options.position.toUpperCase())
    .sort((a, b) => (options.poolSize ? (b.projection ?? 0) - (a.projection ?? 0) : 0))
    .slice(0, options.poolSize ?? Number.POSITIVE_INFINITY);

  const slots = league.tradeStarterSlots.length > 0
    ? league.tradeStarterSlots
    : league.starters.map((p) => p.lineupSlot ?? p.position);
  const rosterPlayers = [...league.starters, ...league.bench].map((p) => ({ ...p }));
  const baseline = optimizeTradeRoster(rosterPlayers, slots);
  const baselineScore = baseline.score;
  const baselineSl = optimizeValueTradeRoster(rosterPlayers, slots, seasonLongValueById);
  const baselineDy = league.seasonLongFormat.isDynasty
    ? optimizeValueTradeRoster(rosterPlayers, slots, dynastyValueById)
    : null;

  // Drop candidate: lowest-value bench player not in this week's best lineup.
  const bestIds = new Set(baseline.starters.map((p) => p.playerId));
  const dropCandidate = [...league.bench]
    .filter((p) => p.playerId !== "0" && !bestIds.has(p.playerId))
    .map((p) => ({ player: p, value: valueById.get(p.playerId) ?? 0 }))
    .sort((a, b) => a.value - b.value)[0] ?? null;

  const powerRows = league.powerRankingsSeasonLong.length > 0
    ? league.powerRankingsSeasonLong
    : league.powerRankingsWeek;
  const myPower = powerRows.find((row) => row.isUser) ?? null;
  const medians: Record<string, number> = {};
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const values = powerRows.map((row) => row.positionValues[pos]).sort((a, b) => a - b);
    medians[pos] = values.length ? values[Math.floor(values.length / 2)]! : 0;
  }

  // One window for every row and the response (dynasty only when the league supports it).
  const waiverWindowKey: "week" | "season_long" | "dynasty" =
    options.scoringWindow === "dynasty" && league.seasonLongFormat.isDynasty
      ? "dynasty"
      : options.scoringWindow === "season_long"
        ? "season_long"
        : "week";

  const scored = pool.map((player) => {
    const weekly =
      dashboard.rankings.find((row) => row.playerId === player.playerId && row.leagueId === league.id)
      ?? dashboard.rankings.find((row) => row.playerId === player.playerId);
    const projection = weekly?.leagueProjection ?? player.projection ?? 0;
    const value = valueById.get(player.playerId) ?? 0;
    const position = weekly?.position ?? player.position;

    const withAdd = [
      ...rosterPlayers.filter((p) => !dropCandidate || p.playerId !== dropCandidate.player.playerId),
      {
        playerId: player.playerId,
        name: weekly?.name ?? player.name,
        position,
        lineupSlot: null,
        isStarter: false,
        projection,
        actual: null,
        injuryStatus: player.injuryStatus ?? null,
      },
    ];
    const after = optimizeTradeRoster(withAdd, slots);
    const afterSl = optimizeValueTradeRoster(withAdd, slots, seasonLongValueById);
    const afterDy = baselineDy
      ? optimizeValueTradeRoster(withAdd, slots, dynastyValueById)
      : null;
    const need = myPower
      ? positionalNeed(myPower.positionValues[position as "QB" | "RB" | "WR" | "TE"] ?? 0, medians[position] ?? 0)
      : 0;
    const sumValues = (
      players: ReadonlyArray<{ playerId: string }>,
      map: Map<string, number>,
    ) => players.reduce((sum, p) => sum + (map.get(p.playerId) ?? 0), 0);

    const move = scoreWaiver({
      addName: weekly?.name ?? player.name,
      dropName: dropCandidate?.player.name ?? null,
      addPosition: position,
      needPos: need,
      isDynasty: league.seasonLongFormat.isDynasty,
      week: { lineupBefore: baselineScore, lineupAfter: after.score },
      seasonLong: {
        starterValueBefore: Math.max(1, baselineSl.score),
        starterValueAfter: afterSl.score,
        benchValueBefore: sumValues(baselineSl.bench, seasonLongValueById),
        benchValueAfter: sumValues(afterSl.bench, seasonLongValueById),
      },
      dynasty: baselineDy && afterDy
        ? {
          starterValueBefore: Math.max(1, baselineDy.score),
          starterValueAfter: afterDy.score,
          benchValueBefore: sumValues(baselineDy.bench, dynastyValueById),
          benchValueAfter: sumValues(afterDy.bench, dynastyValueById),
        }
        : undefined,
      weights,
    });

    const primary = waiverWindowKey === "dynasty" && move.dynasty
      ? move.dynasty
      : waiverWindowKey === "season_long"
        ? move.seasonLong
        : move.week;

    return {
      playerId: player.playerId,
      name: weekly?.name ?? player.name,
      position,
      team: weekly?.team ?? player.team,
      projection,
      value,
      dropCandidate: dropCandidate
        ? {
          playerId: dropCandidate.player.playerId,
          name: dropCandidate.player.name,
          value: valueById.get(dropCandidate.player.playerId) ?? 0,
        }
        : null,
      verdicts: {
        week: moveVerdict(move.week),
        seasonLong: moveVerdict(move.seasonLong),
        ...(move.dynasty ? { dynasty: moveVerdict(move.dynasty) } : {}),
      },
      primaryWindow: waiverWindowKey,
      primaryLabel: primary.label,
      primaryScore: primary.score,
      // Hide Pass from default lists (spec); still returned when explicitly asked later.
      hidden: primary.label === "Pass",
    };
  });

  const ranked = scored
    .sort((a, b) => b.primaryScore - a.primaryScore || b.projection - a.projection);
  // Pass is hidden from default waiver lists; keep the top Pass rows only when
  // nothing stronger is available so the tool still has something to explain.
  const nonPass = ranked.filter((row) => !row.hidden);
  const visible = (nonPass.length > 0 ? nonPass : ranked).slice(0, limit);

  return {
    ok: true as const,
    leagueId: league.id,
    week: dashboard.week,
    scoringWindow: waiverWindowKey,
    // FAAB budget / waiver priority, so bids and timing can be advised.
    waivers: league.waivers ?? null,
    note: "Labels and scores are deterministic; do not re-rank. The payload carries raw evidence only and no written reasons: compose the explanation from the evidence and name the deciding factor. Pass adds are omitted from lists unless nothing stronger is available or the user asks.",
    weakPositions,
    suggestions: visible.map((row) => ({
      ...row,
      bid: suggestFaabBid({
        label: row.primaryLabel as WaiverLabel,
        waivers: league.waivers ?? null,
        weeksLeft: league.playoffs?.weekStart ? Math.max(0, league.playoffs.weekStart - dashboard.week) : null,
        trendingAdds: dashboard.playerTrending[row.playerId]?.adds ?? null,
      }),
    })),
  };
}


export type WaiverBid = { playerId: string; label: "Must add" | "Add" | "Watch"; low: number; high: number };

/**
 * Bids saved on the dashboard for Waivers rows and the player card: the top graded
 * adds this week, FAAB leagues only (a priority league has no dollar bid). Only the
 * 15 highest-projected free agents are graded: each grade runs the lineup optimizer
 * three times (~150 ms in a superflex league), and this runs inside every refresh.
 */
export function waiverBidsFor(dashboard: Dashboard, league: League, weights: ScoringWeightsParams, limit = 15): WaiverBid[] {
  if (league.waivers?.type !== "faab") return [];
  const result = scoreWaiverSuggestions(dashboard, league, weights, { limit, scoringWindow: "week", poolSize: 15 });
  return result.suggestions.flatMap((row) => {
    const bid = row.bid;
    if (row.hidden || !bid || bid.kind !== "faab" || row.primaryLabel === "Pass") return [];
    return [{ playerId: row.playerId, label: row.primaryLabel as WaiverBid["label"], low: bid.low, high: bid.high }];
  });
}
