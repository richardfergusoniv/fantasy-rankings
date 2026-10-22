import { waiverAdjustments } from "./trade-adjustment";
import {
  activeValueHistoryStartDate,
  sliceValueHistoryForSharedDomain,
  trimValueHistoryToContinuousStart,
} from "../value-history-domain";

export type AggregateHistoryPoint = { date: string; value: number };

export type AggregateTradeHistoryRow = {
  date: string;
  give: number | null;
  get: number | null;
};

export type AggregateTradeHistoryAsset = { playerId: string; value: number };

function utcTodayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Value on `date` from an ascending history series: exact hit, else nearest
 * prior point, else nearest later point. Returns null only when the series is empty.
 */
export function nearestHistoryValue(
  pointsAscending: ReadonlyArray<AggregateHistoryPoint>,
  date: string,
): number | null {
  if (pointsAscending.length === 0) return null;
  let prev: AggregateHistoryPoint | null = null;
  for (const point of pointsAscending) {
    if (point.date === date) return point.value;
    if (point.date < date) {
      prev = point;
      continue;
    }
    // First point after `date`.
    return prev?.value ?? point.value;
  }
  return prev?.value ?? null;
}

/**
 * Per-asset contribution on a chart date, pinned to `asset.value` at the
 * anchor so graph totals match the trade-value bars. History is scaled by
 * the ratio asset.value / raw(anchor); missing history (or a zero anchor raw)
 * is treated as a flat `asset.value` line.
 */
export function assetContributionOnDate(
  asset: AggregateTradeHistoryAsset,
  historyAscending: ReadonlyArray<AggregateHistoryPoint>,
  date: string,
  anchorDate: string,
): number {
  if (historyAscending.length === 0) return asset.value;
  const rawAtAnchor = nearestHistoryValue(historyAscending, anchorDate);
  if (rawAtAnchor === null || rawAtAnchor === 0) return asset.value;
  if (date === anchorDate) return asset.value;
  const raw = nearestHistoryValue(historyAscending, date);
  if (raw === null) return asset.value;
  return Math.round(raw * (asset.value / rawAtAnchor));
}

function sideTotalOnDate(
  assets: ReadonlyArray<AggregateTradeHistoryAsset>,
  historyByPlayerId: ReadonlyMap<string, ReadonlyArray<AggregateHistoryPoint>>,
  date: string,
  anchorDate: string,
  waiver: number,
): number | null {
  if (assets.length === 0 && waiver <= 0) return null;
  let total = waiver;
  for (const asset of assets) {
    total += assetContributionOnDate(
      asset,
      historyByPlayerId.get(asset.playerId) ?? [],
      date,
      anchorDate,
    );
  }
  return total;
}

/**
 * Build the 30-day trade-value chart series so each side uses the same
 * per-asset values as the bars (including FantasyCalc waiver adjustment),
 * with history scaled to match at `anchorDate` (latest date when omitted).
 */
export function buildAggregateTradeHistoryData({
  give,
  get,
  historyByPlayerId,
  anchorDate = null,
  now = new Date(),
}: {
  give: ReadonlyArray<AggregateTradeHistoryAsset>;
  get: ReadonlyArray<AggregateTradeHistoryAsset>;
  historyByPlayerId: ReadonlyMap<string, ReadonlyArray<AggregateHistoryPoint>>;
  /** Trade day for historical trades; omit for the live calculator (latest point). */
  anchorDate?: string | null;
  now?: Date;
}): AggregateTradeHistoryRow[] {
  const trimmedByPlayerId = new Map<string, AggregateHistoryPoint[]>();
  for (const [id, points] of historyByPlayerId) {
    trimmedByPlayerId.set(id, trimValueHistoryToContinuousStart([...points]));
  }
  const plottedTrimmed = [...give, ...get].flatMap((asset) => {
    const points = trimmedByPlayerId.get(asset.playerId);
    return points?.length ? [points] : [];
  });
  const startDate = activeValueHistoryStartDate(plottedTrimmed);
  const chartHistoryByPlayerId = new Map<string, AggregateHistoryPoint[]>();
  for (const [id, points] of trimmedByPlayerId) {
    chartHistoryByPlayerId.set(id, sliceValueHistoryForSharedDomain(points, startDate));
  }

  const dateSet = new Set<string>();
  for (const points of chartHistoryByPlayerId.values()) {
    for (const point of points) dateSet.add(point.date);
  }
  let dates = [...dateSet].sort();
  // Only pin to a historical trade day when it sits inside the plotted
  // history window. Pre-window trades (before stored snapshots begin) would
  // otherwise invent a leading date and scale the latest point off the bars.
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const anchorInWindow = Boolean(
    anchorDate
    && firstDate
    && lastDate
    && anchorDate >= firstDate
    && anchorDate <= lastDate,
  );
  if (anchorInWindow && anchorDate) {
    dateSet.add(anchorDate);
    dates = [...dateSet].sort();
  }
  if (dates.length === 0) {
    // Assets with no stored history still need a point so the graph can match
    // the bars (flat lines at current trade values).
    if (give.length === 0 && get.length === 0) return [];
    dates = [anchorDate ?? utcTodayKey(now)];
  }

  const effectiveAnchor = anchorDate && anchorInWindow
    ? anchorDate
    : (dates[dates.length - 1] ?? utcTodayKey(now));

  const waiver = waiverAdjustments(give, get);

  return dates.map((date) => ({
    date,
    give: sideTotalOnDate(give, chartHistoryByPlayerId, date, effectiveAnchor, waiver.give),
    get: sideTotalOnDate(get, chartHistoryByPlayerId, date, effectiveAnchor, waiver.get),
  }));
}

/** Bar totals the aggregate chart must match at the anchor date. */
export function tradeBarTotals(
  give: ReadonlyArray<AggregateTradeHistoryAsset>,
  get: ReadonlyArray<AggregateTradeHistoryAsset>,
): { give: number; get: number } {
  const waiver = waiverAdjustments(give, get);
  return {
    give: give.reduce((sum, asset) => sum + asset.value, 0) + waiver.give,
    get: get.reduce((sum, asset) => sum + asset.value, 0) + waiver.get,
  };
}
