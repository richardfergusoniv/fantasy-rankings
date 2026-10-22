import { formatWhole } from "./lib/format-number";
const nameSuffixes = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

export type LeagueRosterAsset = {
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  value: number;
  isRookie: boolean;
};

export type LeagueRosterPlayer = {
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  injuryStatus: string | null;
};

export type LeagueRosterPick = {
  playerId: string;
  name: string;
  value: number;
};

export type LeagueRosterRow = {
  id: string;
  name: string;
  shortName: string;
  position: string;
  team: string | null;
  value: number | null;
  injuryStatus: string | null;
  isRookie: boolean;
  selectable: boolean;
};

export function compactAssetName(name: string, position: string): string {
  if (position === "PICK") {
    const head = name.split(" · ")[0]?.trim();
    return head && head.length > 0 ? head : name.trim();
  }
  return compactPlayerName(name);
}

/** FantasyCalc draft-pick sleeper ids look like `FP_2027_mid_0` / `FP_2028_1`. */
const FANTASY_CALC_PICK_ID = /FP_[A-Za-z0-9_]+/;

export function isFantasyCalcPickId(playerId: string): boolean {
  return FANTASY_CALC_PICK_ID.test(playerId) && playerId.startsWith("FP_");
}

export type HistoricalPickAssetRef = {
  playerId: string;
  name: string;
  position: string;
  value: number;
};

function pickOrdinalLabel(round: number): string {
  return round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`;
}

/**
 * FantasyCalc market row for a future pick season/round at a given tier.
 * Falls back to Mid when the requested tier template is missing.
 */
export function marketPickTemplate<T extends HistoricalPickAssetRef>(
  assets: ReadonlyArray<T>,
  season: number,
  round: number,
  tier: "early" | "mid" | "late" = "mid",
): T | undefined {
  const ordinal = pickOrdinalLabel(round);
  const candidates = assets.filter((asset) => (
    asset.position === "PICK"
    && asset.name.includes(String(season))
    && asset.name.toLowerCase().includes(ordinal)
  ));
  if (candidates.length === 0) return undefined;
  const tierMatch = candidates.find((asset) => new RegExp(`\\b${tier}\\b`, "i").test(asset.name));
  if (tierMatch) return tierMatch;
  const midMatch = candidates.find((asset) => /\bmid\b/i.test(asset.name));
  if (midMatch) return midMatch;
  return [...candidates].sort((a, b) => b.value - a.value)[0];
}

/**
 * Value a not-yet-drafted historical trade pick the same way the current
 * trade calculator does: use the league owned-pick row already tiered for the
 * original slot owner (`pick:…:season:round:originalRosterId`). Fall back to
 * the Mid FantasyCalc market template when the owner or owned pick is unknown.
 */
export function resolveHistoricalPickAsset<T extends HistoricalPickAssetRef>(
  marketAssets: ReadonlyArray<T>,
  ownedPicks: ReadonlyArray<T>,
  season: number,
  round: number,
  originalRosterId: number | null | undefined,
): T | undefined {
  if (originalRosterId != null) {
    const suffix = `:${season}:${round}:${originalRosterId}`;
    const owned = ownedPicks.find((pick) => (
      pick.position === "PICK" && pick.playerId.endsWith(suffix)
    ));
    if (owned) return owned;
  }
  return marketPickTemplate(marketAssets, season, round, "mid");
}

export type ValueHistoryAssetRef = {
  playerId: string;
  position: string;
  value: number;
  overallRank: number;
};

/**
 * Map a trade asset onto the player_value_snapshots / value-history id.
 * Market picks already use FantasyCalc `FP_*` ids; league-owned picks
 * (`pick:…`) and historical rewrites (`historical:…:FP_…`) resolve back to
 * the matching FantasyCalc pick row when possible.
 */
export function resolveValueHistoryPlayerId(
  asset: ValueHistoryAssetRef,
  marketAssets: ReadonlyArray<ValueHistoryAssetRef> = [],
): string {
  if (asset.position !== "PICK") return asset.playerId;
  if (isFantasyCalcPickId(asset.playerId)) return asset.playerId;
  const embedded = asset.playerId.match(FANTASY_CALC_PICK_ID)?.[0];
  if (embedded) return embedded;
  const match = marketAssets.find((row) => (
    row.position === "PICK"
    && isFantasyCalcPickId(row.playerId)
    && row.overallRank === asset.overallRank
    && row.value === asset.value
  ));
  return match?.playerId ?? asset.playerId;
}

export function compactPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  let lastStart = parts.length - 1;
  const lastToken = parts[lastStart]?.toLowerCase() ?? "";
  if (nameSuffixes.has(lastToken) && lastStart > 1) lastStart -= 1;
  const first = parts[0] ?? "";
  const last = parts.slice(lastStart).join(" ");
  if (!first || !last) return name.trim();
  return `${first.charAt(0).toUpperCase()}. ${last}`;
}

export function rosterPositionLabel(position: string): string {
  if (position === "DEF") return "DST";
  return position;
}

export function buildLeagueRosterRows(
  players: readonly LeagueRosterPlayer[],
  picks: readonly LeagueRosterPick[],
  assetsById: ReadonlyMap<string, LeagueRosterAsset>,
): LeagueRosterRow[] {
  const playerRows: LeagueRosterRow[] = players.map((player) => {
    const asset = assetsById.get(player.playerId);
    const value = asset ? asset.value : null;
    return {
      id: player.playerId,
      name: player.name,
      shortName: compactAssetName(player.name, player.position),
      position: player.position,
      team: player.team ?? asset?.team ?? null,
      value,
      injuryStatus: player.injuryStatus,
      isRookie: asset?.isRookie ?? false,
      selectable: value !== null,
    };
  });
  const pickRows: LeagueRosterRow[] = picks.map((pick) => ({
    id: pick.playerId,
    name: pick.name,
    shortName: compactAssetName(pick.name, "PICK"),
    position: "PICK",
    team: null,
    value: pick.value,
    injuryStatus: null,
    isRookie: false,
    selectable: true,
  }));
  return [...playerRows, ...pickRows].sort((left, right) => (right.value ?? -1) - (left.value ?? -1) || left.name.localeCompare(right.name));
}

export type TeamRecord = {
  wins: number;
  losses: number;
  ties: number;
};

export function formatTeamRecord(record: TeamRecord): string {
  const base = `${record.wins}-${record.losses}`;
  return record.ties > 0 ? `${base}-${record.ties}` : base;
}

export function tradeValueVerdict(giveTotal: number, getTotal: number, partnerName: string): string {
  const margin = Math.abs(getTotal - giveTotal);
  if (margin === 0) return "This trade is even.";
  const amount = formatWhole(margin);
  if (getTotal > giveTotal) return `You win by ${amount}.`;
  return `${partnerName} wins by ${amount}.`;
}
