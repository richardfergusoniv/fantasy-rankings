export type SeasonFormatTarget = {
  key: string;
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
};

export type SeasonFormatRanking = {
  formatKey: string;
  playerId: string;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "PICK";
  overallRank: number;
  positionRank: number;
  value: number;
  trend30Day: number | null;
  isRookie: boolean;
};

type PresetIdentity = {
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
};

const formatKeyPattern = /^(dynasty|redraft)-(\d+)qb-(\d+)t-([\d.]+)ppr$/;

function presetIdentity(formatKey: string): PresetIdentity | null {
  const match = formatKeyPattern.exec(formatKey);
  if (!match) return null;
  const numQbs = Number(match[2]);
  const numTeams = Number(match[3]);
  const ppr = Number(match[4]);
  if (!Number.isFinite(numQbs) || !Number.isFinite(numTeams) || !Number.isFinite(ppr)) return null;
  return {
    isDynasty: match[1] === "dynasty",
    numQbs,
    numTeams,
    ppr,
  };
}

function nearestNumber(target: number, options: number[]): number | null {
  const unique = [...new Set(options)];
  if (unique.length === 0) return null;
  return unique.sort((left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right)[0] ?? null;
}

function surroundingNumbers(target: number, options: number[]): { lower: number; upper: number } | null {
  const lowerOptions = options.filter((option) => option < target);
  const upperOptions = options.filter((option) => option > target);
  if (lowerOptions.length === 0 || upperOptions.length === 0) return null;
  return { lower: Math.max(...lowerOptions), upper: Math.min(...upperOptions) };
}

function retag(rows: SeasonFormatRanking[], formatKey: string): SeasonFormatRanking[] {
  return rows.map((row) => ({ ...row, formatKey }));
}

function interpolateRankings(
  lowerRows: SeasonFormatRanking[],
  upperRows: SeasonFormatRanking[],
  weight: number,
  formatKey: string,
): SeasonFormatRanking[] {
  const upperById = new Map(upperRows.map((row) => [row.playerId, row]));
  const seen = new Set<string>();
  const blended: SeasonFormatRanking[] = [];
  for (const lower of lowerRows) {
    seen.add(lower.playerId);
    const upper = upperById.get(lower.playerId);
    blended.push(upper ? blendPair(lower, upper, weight, formatKey) : { ...lower, formatKey });
  }
  for (const upper of upperRows) {
    if (seen.has(upper.playerId)) continue;
    blended.push({ ...upper, formatKey });
  }
  return rankRows(blended);
}

function blendPair(lower: SeasonFormatRanking, upper: SeasonFormatRanking, weight: number, formatKey: string): SeasonFormatRanking {
  const blend = (left: number, right: number) => Math.round(left + (right - left) * weight);
  return {
    ...lower,
    formatKey,
    value: blend(lower.value, upper.value),
    trend30Day: lower.trend30Day !== null && upper.trend30Day !== null ? blend(lower.trend30Day, upper.trend30Day) : (lower.trend30Day ?? upper.trend30Day),
  };
}

function rankRows(rows: SeasonFormatRanking[]): SeasonFormatRanking[] {
  const ordered = [...rows].sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));
  const positionCounts = new Map<string, number>();
  return ordered.map((row, index) => {
    const positionRank = (positionCounts.get(row.position) ?? 0) + 1;
    positionCounts.set(row.position, positionRank);
    return { ...row, overallRank: index + 1, positionRank };
  });
}

function rowsForPreset(grouped: Map<string, SeasonFormatRanking[]>, identity: PresetIdentity): SeasonFormatRanking[] {
  for (const [formatKey, rows] of grouped) {
    const parsed = presetIdentity(formatKey);
    if (!parsed) continue;
    if (
      parsed.isDynasty === identity.isDynasty
      && parsed.numQbs === identity.numQbs
      && parsed.numTeams === identity.numTeams
      && parsed.ppr === identity.ppr
    ) return rows;
  }
  return [];
}

/**
 * FantasyCalc publishes a handful of presets. Leagues that don't match one
 * (standard scoring, 8/16 teams, 10-team PPR, in-between sizes) get a table
 * tagged with their own format key:
 * reception scoring uses the nearest published PPR (there is no 0 PPR table,
 * so standard uses half PPR; a midpoint rounds to the lower table), team
 * counts outside the published sizes use the nearest size, and a size between
 * two published tables for that same dynasty / QB / PPR mix is interpolated.
 */
export function rankingsForLeagueFormats<T extends SeasonFormatRanking>(rows: T[], formats: SeasonFormatTarget[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.formatKey) ?? [];
    bucket.push(row);
    grouped.set(row.formatKey, bucket);
  }
  const sources = new Map(grouped);
  const synthesized: T[] = [];
  for (const format of formats) {
    if ((grouped.get(format.key) ?? []).length > 0) continue;
    const created = synthesizeFormat(sources, format);
    if (created.length === 0) continue;
    grouped.set(format.key, created);
    synthesized.push(...created);
  }
  return [...rows, ...synthesized];
}

function synthesizeFormat<T extends SeasonFormatRanking>(grouped: Map<string, T[]>, format: SeasonFormatTarget): T[] {
  const identities = [...grouped.keys()].flatMap((formatKey) => {
    const parsed = presetIdentity(formatKey);
    return parsed ? [parsed] : [];
  }).filter((parsed) => parsed.isDynasty === format.isDynasty && parsed.numQbs === format.numQbs);
  const ppr = nearestNumber(format.ppr, identities.map((identity) => identity.ppr));
  if (ppr === null) return [];
  const teamCounts = identities.filter((identity) => identity.ppr === ppr).map((identity) => identity.numTeams);
  const exactTeams = teamCounts.find((count) => count === format.numTeams);
  if (exactTeams !== undefined) {
    return retag(rowsForPreset(grouped, { ...format, ppr, numTeams: exactTeams }), format.key) as T[];
  }
  const span = surroundingNumbers(format.numTeams, teamCounts);
  if (!span || span.upper === span.lower) {
    const nearestTeams = nearestNumber(format.numTeams, teamCounts);
    if (nearestTeams === null) return [];
    return retag(rowsForPreset(grouped, { ...format, ppr, numTeams: nearestTeams }), format.key) as T[];
  }
  const lowerRows = rowsForPreset(grouped, { ...format, ppr, numTeams: span.lower });
  const upperRows = rowsForPreset(grouped, { ...format, ppr, numTeams: span.upper });
  if (lowerRows.length === 0 || upperRows.length === 0) return [];
  const weight = (format.numTeams - span.lower) / (span.upper - span.lower);
  return interpolateRankings(lowerRows, upperRows, weight, format.key) as T[];
}
