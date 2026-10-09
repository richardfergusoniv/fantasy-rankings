import { formatDecimal } from "./lib/format-number";

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
  const amount = margin.toLocaleString();
  if (getTotal > giveTotal) return `You win by ${amount}.`;
  return `${partnerName} wins by ${amount}.`;
}

export function formatLineupImpact(before: number, after: number, delta: number): string {
  const score = (value: number): string => {
    const rounded = Number(value.toFixed(1));
    return Number.isInteger(rounded) ? rounded.toLocaleString() : formatDecimal(rounded, 1);
  };
  const deltaRounded = Number(delta.toFixed(1));
  const digits = Number.isInteger(deltaRounded) ? 0 : 1;
  const nearZero = Math.abs(deltaRounded) < (digits === 0 ? 0.5 : 0.05);
  const deltaLabel = nearZero ? formatDecimal(0, digits) : formatDecimal(deltaRounded, digits, { sign: "exceptZero" });
  return `Starting lineup: ${score(before)} → ${score(after)}, ${deltaLabel} pts`;
}
