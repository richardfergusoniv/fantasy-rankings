/**
 * Post-trade power rankings for the League-adjusted trade card.
 *
 * Mirrors the server power builder (makePowerRankings in
 * api/_lib/dashboard-build.ts): a team's power is the sum of its
 * players' season-long values at QB/RB/WR/TE. K, DEF, and picks
 * sit in position buckets server-side but never enter the total,
 * so they never move it here either. The League-adjusted trade
 * and the power table share one rankings format per league
 * (league.seasonLongFormat.key backs both the trade assets and
 * the dynasty/season-long power array), so the trade assets' own
 * values are the deltas.
 */

export interface PowerRankingRow {
  rosterId: number;
  teamName: string;
  totalValue: number;
  rank: number;
  isUser: boolean;
}

export interface PowerShiftRow extends PowerRankingRow {
  previousTotalValue: number;
  previousRank: number;
  isParty: boolean;
}

const COUNTED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

function countedValue(assets: readonly { position: string; value: number }[]): number {
  let total = 0;
  for (const asset of assets) {
    if (COUNTED_POSITIONS.has(asset.position)) total += asset.value;
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
  },
): PowerShiftRow[] {
  const myDelta = countedValue(change.get) - countedValue(change.give);
  const adjusted = rows.map((row) => {
    const delta = row.rosterId === change.myRosterId
      ? myDelta
      : row.rosterId === change.partnerRosterId
        ? -myDelta
        : 0;
    return {
      ...row,
      previousTotalValue: row.totalValue,
      previousRank: row.rank,
      totalValue: row.totalValue + delta,
      isParty: delta !== 0 || row.rosterId === change.myRosterId || row.rosterId === change.partnerRosterId,
    };
  });
  adjusted.sort((a, b) => b.totalValue - a.totalValue || a.teamName.localeCompare(b.teamName));
  return adjusted.map((row, index) => ({ ...row, rank: index + 1 }));
}
