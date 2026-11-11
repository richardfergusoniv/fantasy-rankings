import { teamOutlook, winPercent, winProbability } from "./win-probability";
import type { LiveForecastPlayer } from "../../../api/_lib/lineup-optimizer";

/** What the verdict needs to know about one player this week. */
export type VerdictPlayer = LiveForecastPlayer & { name: string };

export type StartSitVerdict = {
  /** Index (0 or 1) of the player to start, or null when the two are a coin flip. */
  startIndex: 0 | 1 | null;
  /** Chance, in percent, that the recommended player outscores the other; 50 when it's a coin flip. */
  chance: number;
  /** Projected points for each player, null when the player has no projection. */
  points: [number | null, number | null];
};

/** Closer than this (in percent either side of 50) is called a coin flip. */
export const COIN_FLIP_BAND = 2;

/**
 * Who to start of two players this week, and how likely that player is to
 * outscore the other. Uses the same projection and spread model as the
 * Matchup win chance, so the two screens agree.
 */
export function startSitVerdict(a: VerdictPlayer, b: VerdictPlayer, now = Date.now()): StartSitVerdict | null {
  const first = teamOutlook([a], now);
  const second = teamOutlook([b], now);
  if (!first || !second) return null;
  const firstChance = winPercent(winProbability(first, second));
  const points: [number | null, number | null] = [Number(first.mean.toFixed(1)), Number(second.mean.toFixed(1))];
  if (Math.abs(firstChance - 50) < COIN_FLIP_BAND) return { startIndex: null, chance: 50, points };
  return firstChance > 50
    ? { startIndex: 0, chance: firstChance, points }
    : { startIndex: 1, chance: Number((100 - firstChance).toFixed(1)), points };
}

export type FactorEdge = 0 | 1 | null;
export type StartSitFactor = { label: string; values: [string, string]; edge: FactorEdge };

function edgeOf(a: number | null | undefined, b: number | null | undefined, higherIsBetter = true): FactorEdge {
  if (typeof a !== "number" || typeof b !== "number" || a === b) return null;
  return (a > b) === higherIsBetter ? 0 : 1;
}

const points = (value: number | null | undefined) => (typeof value === "number" ? value.toFixed(1) : "—");
const percent = (value: number | null | undefined) => (typeof value === "number" ? `${value.toFixed(0)}%` : "—");
const range = (r: { low: number; high: number } | null | undefined) => (r ? `${r.low.toFixed(1)}–${r.high.toFixed(1)}` : "—");

export type FactorInput = {
  projection: number | null;
  vegasProjection: number | null;
  sleeperProjection: number | null;
  bookRange: { low: number; high: number } | null;
  /** Floor, median and ceiling of this season's weekly scores. */
  season: { floor: number; median: number; ceiling: number } | null;
  injuryStatus: string | null;
  isBye: boolean;
  opponent: string | null;
  /** Rank of the opponent's defense against this position, 1 = softest. */
  matchupRank: number | null;
  /** Shares are in percent (24 means 24%). */
  targetShare: number | null;
  snapShare: number | null;
  opportunityShare: number | null;
};

/**
 * Every input behind the verdict, side by side. Rows with nothing for either
 * player are left out. `edge` marks the better side of each row.
 */
export function startSitFactors(a: FactorInput, b: FactorInput): StartSitFactor[] {
  const rows: Array<StartSitFactor & { has: boolean }> = [
    { label: "Projection", values: [points(a.projection), points(b.projection)], edge: edgeOf(a.projection, b.projection), has: a.projection !== null || b.projection !== null },
    { label: "Props projection", values: [points(a.vegasProjection), points(b.vegasProjection)], edge: edgeOf(a.vegasProjection, b.vegasProjection), has: a.vegasProjection !== null || b.vegasProjection !== null },
    { label: "Sleeper projection", values: [points(a.sleeperProjection), points(b.sleeperProjection)], edge: edgeOf(a.sleeperProjection, b.sleeperProjection), has: a.sleeperProjection !== null || b.sleeperProjection !== null },
    { label: "Book range", values: [range(a.bookRange), range(b.bookRange)], edge: edgeOf(a.bookRange?.high, b.bookRange?.high), has: a.bookRange !== null || b.bookRange !== null },
    { label: "Season median", values: [points(a.season?.median), points(b.season?.median)], edge: edgeOf(a.season?.median, b.season?.median), has: a.season !== null || b.season !== null },
    { label: "Season floor", values: [points(a.season?.floor), points(b.season?.floor)], edge: edgeOf(a.season?.floor, b.season?.floor), has: a.season !== null || b.season !== null },
    { label: "Season ceiling", values: [points(a.season?.ceiling), points(b.season?.ceiling)], edge: edgeOf(a.season?.ceiling, b.season?.ceiling), has: a.season !== null || b.season !== null },
    { label: "Opponent", values: [a.isBye ? "Bye" : a.opponent ?? "—", b.isBye ? "Bye" : b.opponent ?? "—"], edge: null, has: Boolean(a.opponent || b.opponent || a.isBye || b.isBye) },
    { label: "Matchup rank", values: [a.matchupRank === null ? "—" : `#${a.matchupRank}`, b.matchupRank === null ? "—" : `#${b.matchupRank}`], edge: edgeOf(a.matchupRank, b.matchupRank, false), has: a.matchupRank !== null || b.matchupRank !== null },
    { label: "Target share", values: [percent(a.targetShare), percent(b.targetShare)], edge: edgeOf(a.targetShare, b.targetShare), has: a.targetShare !== null || b.targetShare !== null },
    { label: "Snap share", values: [percent(a.snapShare), percent(b.snapShare)], edge: edgeOf(a.snapShare, b.snapShare), has: a.snapShare !== null || b.snapShare !== null },
    { label: "Opportunity share", values: [percent(a.opportunityShare), percent(b.opportunityShare)], edge: edgeOf(a.opportunityShare, b.opportunityShare), has: a.opportunityShare !== null || b.opportunityShare !== null },
    { label: "Injury", values: [a.injuryStatus ?? "None", b.injuryStatus ?? "None"], edge: a.injuryStatus && !b.injuryStatus ? 1 : b.injuryStatus && !a.injuryStatus ? 0 : null, has: Boolean(a.injuryStatus || b.injuryStatus) },
  ];
  return rows.filter((row) => row.has).map(({ label, values, edge }) => ({ label, values, edge }));
}
