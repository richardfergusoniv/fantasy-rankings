import type { AnalyticsEntity } from "./dashboard-types";
import { rankAgainst } from "./shared";
import { perGame } from "./views/team-per-game";

export type SeasonCountingKey =
  | "fantasyPoints"
  | "passCmp"
  | "passAtt"
  | "passYds"
  | "passTd"
  | "interceptions"
  | "rushAtt"
  | "rushYds"
  | "rushTd"
  | "targets"
  | "receptions"
  | "recYds"
  | "recTd";

export type SeasonRateSpec = {
  key: SeasonCountingKey;
  label: string;
  /** nflverse season field. Null when no same-position rate exists to rank against. */
  analyticsKey: string | null;
  higherIsBetter: boolean;
};

export const seasonRateSpecs: Record<SeasonCountingKey, SeasonRateSpec> = {
  fantasyPoints: { key: "fantasyPoints", label: "FPTS/G", analyticsKey: null, higherIsBetter: true },
  passCmp: { key: "passCmp", label: "CMP/G", analyticsKey: "completions", higherIsBetter: true },
  passAtt: { key: "passAtt", label: "ATT/G", analyticsKey: "pass_attempts", higherIsBetter: true },
  passYds: { key: "passYds", label: "PASS YDS/G", analyticsKey: "passing_yards", higherIsBetter: true },
  passTd: { key: "passTd", label: "PASS TD/G", analyticsKey: "passing_tds", higherIsBetter: true },
  interceptions: { key: "interceptions", label: "INT/G", analyticsKey: "interceptions", higherIsBetter: false },
  rushAtt: { key: "rushAtt", label: "CAR/G", analyticsKey: "carries", higherIsBetter: true },
  rushYds: { key: "rushYds", label: "RUSH YDS/G", analyticsKey: "rushing_yards", higherIsBetter: true },
  rushTd: { key: "rushTd", label: "RUSH TD/G", analyticsKey: "rushing_tds", higherIsBetter: true },
  targets: { key: "targets", label: "TGT/G", analyticsKey: "targets", higherIsBetter: true },
  receptions: { key: "receptions", label: "REC/G", analyticsKey: "receptions", higherIsBetter: true },
  recYds: { key: "recYds", label: "REC YDS/G", analyticsKey: "receiving_yards", higherIsBetter: true },
  recTd: { key: "recTd", label: "REC TD/G", analyticsKey: "receiving_tds", higherIsBetter: true },
};

export type SeasonRateRow = {
  key: string;
  label: string;
  rate: number | null;
  rank: number | null;
};

/** Same-position nflverse per-game rates, excluding the player whose Sleeper rate is displayed. */
export function peerSeasonRates(
  entities: readonly AnalyticsEntity[],
  position: string,
  analyticsKey: string,
  exclude: (entity: AnalyticsEntity) => boolean,
): number[] {
  return entities.flatMap((entity) => {
    if (entity.position !== position || exclude(entity)) return [];
    const value = entity.season[analyticsKey];
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
}

/**
 * Rank a displayed per-game rate against peer season rates.
 * Peers are rounded to the tenth shown on the card so displayed ties share a rank.
 */
export function seasonRateRank(peerRates: readonly number[], rate: number | null, higherIsBetter = true): number | null {
  if (rate === null) return null;
  const rounded = peerRates.flatMap((value) => (
    typeof value === "number" && Number.isFinite(value) ? [Number(value.toFixed(1))] : []
  ));
  return rankAgainst(rounded, rate, higherIsBetter);
}

export function seasonRateRows(
  order: readonly string[],
  totals: Record<string, number>,
  games: number,
  peersFor: (analyticsKey: string) => readonly number[],
): SeasonRateRow[] {
  return order.flatMap((key) => {
    if (!isSeasonCountingKey(key)) return [];
    const total = totals[key];
    if (typeof total !== "number" || !Number.isFinite(total)) return [];
    const spec = seasonRateSpecs[key];
    const rate = perGame(total, games);
    const rank = spec.analyticsKey === null || rate === null
      ? null
      : seasonRateRank(peersFor(spec.analyticsKey), rate, spec.higherIsBetter);
    return [{ key, label: spec.label, rate, rank }];
  });
}

function isSeasonCountingKey(key: string): key is SeasonCountingKey {
  return Object.prototype.hasOwnProperty.call(seasonRateSpecs, key);
}
