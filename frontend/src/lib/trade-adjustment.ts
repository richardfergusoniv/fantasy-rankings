import type { TradeAsset } from "../dashboard-types";

// FantasyCalc's waiver adjustment: in an uneven trade, the side sending
// fewer pieces gains open roster spots, and each spot is worth roughly a
// waiver-wire pickup. That side is credited, for each of the other side's
// cheapest pieces up to the piece-count gap, about 70% of the piece's
// value capped near the value of a replacement pickup. The constants are
// FantasyCalc's, calibrated to their value scale — the scale every asset
// in this app carries. Equal piece counts (or an empty side) get nothing.
const WAIVER_VALUE_FRACTION = 0.6982;
const WAIVER_SPOT_CAP = 753;
const WAIVER_SPOT_CAP_STEP = 0.23;

export function waiverAdjustments(
  give: TradeAsset[],
  get: TradeAsset[],
): { give: number; get: number } {
  if (give.length === 0 || get.length === 0 || give.length === get.length) {
    return { give: 0, get: 0 };
  }
  const fewerIsGive = give.length < get.length;
  const more = fewerIsGive ? get : give;
  const gap = Math.abs(give.length - get.length);
  const cheapest = [...more]
    .sort((a, b) => a.value - b.value)
    .slice(0, gap);
  const credit = cheapest.reduce(
    (sum, asset, index) => sum + Math.floor(Math.min(
      asset.value * WAIVER_VALUE_FRACTION,
      WAIVER_SPOT_CAP + index * WAIVER_SPOT_CAP_STEP,
    )),
    0,
  );
  return fewerIsGive ? { give: credit, get: 0 } : { give: 0, get: credit };
}
