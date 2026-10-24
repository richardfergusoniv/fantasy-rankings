/**
 * Post-trade power rankings. Shared by the trade calculator UI and chat tools.
 * Dynasty totals include future pick value (PICK assets move futurePickValue).
 */

export interface PowerRankingRow {
  rosterId: number;
  teamName: string;
  totalValue: number;
  rank: number;
  isUser: boolean;
  futurePickValue?: number;
}

export interface PowerShiftRow extends PowerRankingRow {
  previousTotalValue: number;
  previousRank: number;
  isParty: boolean;
}

const COUNTED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

function countedPlayerValue(assets: readonly { position: string; value: number }[]): number {
  let total = 0;
  for (const asset of assets) {
    if (COUNTED_POSITIONS.has(asset.position)) total += asset.value;
  }
  return total;
}

function countedPickValue(assets: readonly { position: string; value: number }[]): number {
  let total = 0;
  for (const asset of assets) {
    if (asset.position === "PICK") total += asset.value;
  }
  return total;
}

export function powerRankingsAfterTrade(
  rows: readonly PowerRankingRow[],
  change: {
    myRosterId: number;
    partnerRosterId: number;
    give: readonly { position: string; value: number }[];
    get: readonly { position: string; value: number }[];
    /** True only when `rows` are Dynasty totals, which already include future pick value. */
    includePickValueInTotal: boolean;
  },
): PowerShiftRow[] {
  const myPlayerDelta = countedPlayerValue(change.get) - countedPlayerValue(change.give);
  const myPickDelta = countedPickValue(change.get) - countedPickValue(change.give);
  const myTotalDelta = change.includePickValueInTotal
    ? myPlayerDelta + myPickDelta
    : myPlayerDelta;
  const adjusted = rows.map((row) => {
    const delta = row.rosterId === change.myRosterId
      ? myTotalDelta
      : row.rosterId === change.partnerRosterId
        ? -myTotalDelta
        : 0;
    const pickDelta = row.rosterId === change.myRosterId
      ? myPickDelta
      : row.rosterId === change.partnerRosterId
        ? -myPickDelta
        : 0;
    const previousPick = row.futurePickValue ?? 0;
    return {
      ...row,
      previousTotalValue: row.totalValue,
      previousRank: row.rank,
      totalValue: row.totalValue + delta,
      futurePickValue: previousPick + pickDelta,
      isParty: delta !== 0 || row.rosterId === change.myRosterId || row.rosterId === change.partnerRosterId,
    };
  });
  adjusted.sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName));
  return adjusted.map((row, index) => ({ ...row, rank: index + 1 }));
}
