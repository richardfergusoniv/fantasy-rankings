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
import { injuryExposureFacts, rosLineupDelta, type RosContext } from "./ros.js";
import { isUnavailableForScoring, isQuestionable } from "./scoring/injury.js";

type League = Dashboard["leagues"][number];

/** Rest-of-season evidence context: covered weeks + the schedule-derived bye map. */
export type RosOptions = {
  context: RosContext;
  byeWeeks?: ReadonlyMap<string, number>;
};

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
    /** Optional rest-of-season evidence (per-week lineup points). */
    ros?: RosOptions;
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

  // One window for every row and the response (dynasty only when the league supports it).
  const waiverWindowKey: "week" | "season_long" | "dynasty" =
    options.scoringWindow === "dynasty" && league.seasonLongFormat.isDynasty
      ? "dynasty"
      : options.scoringWindow === "season_long"
        ? "season_long"
        : "week";

  // Drop candidates, valued under the selected window — a dynasty read must not
  // sacrifice a developmental asset because his redraft value is thin. Each add
  // is graded as a joint add/drop pair, not against one shared drop: the drop
  // is the lowest-value non-lineup bench player AT THE ADD'S POSITION when one
  // exists (you add a QB, you drop a QB), else the global lowest-value drop.
  const dropValueById = waiverWindowKey === "dynasty" ? dynastyValueById : seasonLongValueById;
  const bestIds = new Set(baseline.starters.map((p) => p.playerId));
  const eligibleDrops = [...league.bench]
    .filter((p) => p.playerId !== "0" && !bestIds.has(p.playerId))
    .map((p) => ({ player: p, value: dropValueById.get(p.playerId) ?? 0 }))
    .sort((a, b) => a.value - b.value);
  const dropFor = (position: string) =>
    eligibleDrops.find((row) => row.player.position === position)
    ?? eligibleDrops[0]
    ?? null;

  const powerRows = league.powerRankingsSeasonLong.length > 0
    ? league.powerRankingsSeasonLong
    : league.powerRankingsWeek;
  const myPower = powerRows.find((row) => row.isUser) ?? null;
  const medians: Record<string, number> = {};
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const values = powerRows.map((row) => row.positionValues[pos]).sort((a, b) => a - b);
    medians[pos] = values.length ? values[Math.floor(values.length / 2)]! : 0;
  }

  // ROS evidence closures, evaluated only for the suggestions returned.
  const rosDeferred = new Map<string, () => WaiverRosEvidence>();
  const scored = pool.map((player) => {
    const weekly =
      dashboard.rankings.find((row) => row.playerId === player.playerId && row.leagueId === league.id)
      ?? dashboard.rankings.find((row) => row.playerId === player.playerId);
    const projection = weekly?.leagueProjection ?? player.projection ?? 0;
    const value = valueById.get(player.playerId) ?? 0;
    const position = weekly?.position ?? player.position;

    const addRow = {
      playerId: player.playerId,
      name: weekly?.name ?? player.name,
      team: weekly?.team ?? player.team ?? null,
      position,
      lineupSlot: null,
      isStarter: false,
      projection,
      actual: null,
      injuryStatus: player.injuryStatus ?? null,
    };
    const rosterWith = (dropId: string | null) => [
      ...rosterPlayers.filter((p) => p.playerId !== dropId),
      addRow,
    ];
    const dropCandidate = dropFor(position);
    const withAdd = rosterWith(dropCandidate?.player.playerId ?? null);
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

    // Rest-of-season lineup points for this exact add/drop pair — DEFERRED:
    // computing it optimizes both lineups once per covered week, so it runs
    // only for the suggestions actually returned (see below), not for every
    // candidate in the pool. Weeks where any rostered player has no projection
    // row (and no schedule bye) are excluded from both sides and disclosed in
    // unknownPlayerWeeks, so missing data cannot manufacture a gain. Evidence
    // only — labels keep their market-price scale.
    if (options.ros && options.ros.context.coveredWeeks.length > 0) {
      const rosOptions = options.ros;
      rosDeferred.set(player.playerId, () => {
        const delta = rosLineupDelta({
          before: rosterPlayers,
          after: withAdd,
          slots,
          league,
          ros: rosOptions.context,
          addId: player.playerId,
          addName: weekly?.name ?? player.name,
          byeWeeks: rosOptions.byeWeeks,
          teamById: new Map(rosterPlayers.map((p) => [p.playerId, p.team ?? ""])),
          nameById: new Map(rosterPlayers.map((p) => [p.playerId, p.name])),
        });
        const exposure = injuryExposureFacts({
          roster: [...league.starters, ...league.bench],
          involved: [
            { playerId: player.playerId, name: weekly?.name ?? player.name, position, team: weekly?.team ?? player.team ?? null, injuryStatus: player.injuryStatus ?? null },
            ...(dropCandidate ? [{ playerId: dropCandidate.player.playerId, name: dropCandidate.player.name, position: dropCandidate.player.position, team: dropCandidate.player.team ?? null, injuryStatus: dropCandidate.player.injuryStatus ?? null }] : []),
          ],
          ros: rosOptions.context,
          league,
          isDesignated: (status) => isUnavailableForScoring(status) || isQuestionable(status) || (status != null && status !== ""),
          byeWeeks: rosOptions.byeWeeks,
          teamById: new Map(rosterPlayers.map((p) => [p.playerId, p.team ?? ""])),
        });
        return {
          pointsGained: delta.totalDelta,
          coveredWeeks: rosOptions.context.coveredWeeks,
          missingWeeks: rosOptions.context.missingWeeks,
          unknownPlayerWeeks: delta.unknownPlayerWeeks,
          asOf: rosOptions.context.asOf,
          partial: rosOptions.context.missingWeeks.length > 0 || delta.unknownPlayerWeeks.length > 0,
          startsInWeeks: delta.startedInWeeks,
          designatedPlayers: exposure.designatedPlayers,
          designatedProjectedShare: exposure.designatedProjectedShare,
          absentPlayers: exposure.absentPlayers,
          partialPlayers: exposure.partialPlayers,
        } satisfies WaiverRosEvidence;
      });
    }

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
      ros: null as WaiverRosEvidence | null,
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
  // Only the returned suggestions pay for ROS lineup optimization.
  for (const row of visible) {
    const computeRos = rosDeferred.get(row.playerId);
    if (computeRos) row.ros = computeRos();
  }

  return {
    ok: true as const,
    leagueId: league.id,
    week: dashboard.week,
    scoringWindow: waiverWindowKey,
    // FAAB budget / waiver priority, so bids and timing can be advised.
    waivers: league.waivers ?? null,
    note: "Labels and scores are deterministic; do not re-rank. The payload carries raw evidence only and no written reasons: compose the explanation from the evidence and name the deciding factor. Pass adds are omitted from lists unless nothing stronger is available or the user asks. Each suggestion's ros is the rest-of-season lineup-points change vs the paired drop, summed only over weeks with full projection coverage: partial:true means some weeks are not counted (missingWeeks names weeks with no data at all; unknownPlayerWeeks names weeks where a player on either roster has no projection and was not on a schedule bye), and a null ros means 'no projection coverage', not zero. startsInWeeks Optimized ROS comparisons cover only QB, RB, WR, TE, K and DEF: positions the lineup optimizer never starts (such as individual defensive players) are excluded from the comparison entirely, not treated as unknown. names weeks the add lands in the lineup; it states no reason, so do not attribute one. designatedPlayers and designatedProjectedShare are current injury designations and their share of remaining projected points - descriptive facts, not a risk score - absentPlayers names players with no usable projection row in any covered week, and partialPlayers names players missing a covered non-bye week.",
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
  return waiverCacheFor(dashboard, league, weights, limit).bids;
}

/** One graded waiver add cached on the league for every league type (FAAB and priority alike). */
export type WaiverRosEvidence = {
  pointsGained: number;
  coveredWeeks: number[];
  missingWeeks: number[];
  unknownPlayerWeeks: { week: number; players: string[] }[];
  asOf: string | null;
  partial: boolean;
  startsInWeeks: { week: number; note: string }[];
  designatedPlayers: string[];
  designatedProjectedShare: number | null;
  absentPlayers: string[];
  partialPlayers: string[];
};

export type WaiverGradeRow = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  projection: number | null;
  label: WaiverBid["label"];
  score: number;
  dropCandidate: { playerId: string; name: string; value: number } | null;
  bid: { kind: "faab" | "priority"; low?: number; high?: number; note: string } | null;
  ros?: WaiverRosEvidence | null;
};

/**
 * Grades the waiver pool once and returns both cached outputs: FAAB dollar bids
 * (FAAB leagues only) and the visible graded rows every league type stores —
 * a priority league's rows carry the priority note from suggestFaabBid instead
 * of a dollar bid. Pass rows stay hidden, matching the default waiver list.
 */
export function waiverCacheFor(
  dashboard: Dashboard,
  league: League,
  weights: ScoringWeightsParams,
  limit = 15,
  ros?: RosOptions,
): { bids: WaiverBid[]; grades: WaiverGradeRow[] } {
  const result = scoreWaiverSuggestions(dashboard, league, weights, { limit, scoringWindow: "week", poolSize: 15, ros });
  const bids: WaiverBid[] = [];
  const grades: WaiverGradeRow[] = [];
  for (const row of result.suggestions) {
    if (row.hidden || row.primaryLabel === "Pass") continue;
    const bid = row.bid;
    if (league.waivers?.type === "faab" && bid?.kind === "faab") {
      bids.push({ playerId: row.playerId, label: row.primaryLabel as WaiverBid["label"], low: bid.low, high: bid.high });
    }
    grades.push({
      playerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      projection: row.projection,
      label: row.primaryLabel as WaiverGradeRow["label"],
      score: row.primaryScore,
      dropCandidate: row.dropCandidate,
      bid: bid
        ? { kind: bid.kind, ...(bid.kind === "faab" ? { low: bid.low, high: bid.high } : {}), note: bid.note }
        : null,
      ros: row.ros ?? null,
    });
  }
  return { bids, grades };
}
