/**
 * Pure transforms for Charts premade-metric enrichment.
 * Kept free of I/O so unit tests can cover opportunity, snap, red-zone, and PROE math.
 */

export type SkillPosition = "QB" | "RB" | "WR" | "TE";

export type ChartStatRow = {
  id: string;
  name: string;
  team: string;
  position: SkillPosition | "K" | "DEF";
  season: number;
  week: number;
  gameId: string;
  values: Record<string, number>;
};

export type SnapCountRow = {
  week: number;
  player: string;
  team: string;
  position: string;
  offensePct: number;
};

export type WeeklySnapPoint = {
  week: number;
  snapShare: number;
};

export type PlayerRedZoneTotals = {
  targets: number;
  carries: number;
};

export type TeamProeAccumulator = {
  sum: number;
  count: number;
};

const SKILL = new Set<string>(["QB", "RB", "WR", "TE"]);

export function normalizeChartPlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/jr$|sr$|ii$|iii$|iv$/g, "");
}

export function snapLookupKey(name: string, team: string, week: number): string {
  return `${normalizeChartPlayerName(name)}|${team}|${week}`;
}

/** Touches-style opportunity used for team share denominators. */
function touchOpportunity(row: ChartStatRow): number {
  return (row.values.carries ?? 0) + (row.values.targets ?? 0);
}

/** Chart opportunity volume: QB uses pass attempts + carries; others use targets + carries. */
function chartOpportunity(row: ChartStatRow): number {
  if (row.position === "QB") return (row.values.pass_attempts ?? 0) + (row.values.carries ?? 0);
  return touchOpportunity(row);
}

/** Per-game opportunity, opportunity share, carry share, and RB target share. */
export function enrichOpportunityMetrics(rows: ChartStatRow[]): void {
  const teamOpportunity = new Map<string, number>();
  const teamCarries = new Map<string, number>();
  const teamRbTargets = new Map<string, number>();

  for (const row of rows) {
    if (!SKILL.has(row.position)) continue;
    const key = `${row.gameId}:${row.team}`;
    const carries = row.values.carries ?? 0;
    const targets = row.values.targets ?? 0;
    teamOpportunity.set(key, (teamOpportunity.get(key) ?? 0) + touchOpportunity(row));
    teamCarries.set(key, (teamCarries.get(key) ?? 0) + carries);
    if (row.position === "RB") {
      teamRbTargets.set(key, (teamRbTargets.get(key) ?? 0) + targets);
    }
  }

  for (const row of rows) {
    if (!SKILL.has(row.position)) continue;
    const key = `${row.gameId}:${row.team}`;
    const carries = row.values.carries ?? 0;
    const targets = row.values.targets ?? 0;
    row.values.opportunity = chartOpportunity(row);
    const oppTotal = teamOpportunity.get(key) ?? 0;
    if (oppTotal > 0) row.values.opportunity_share = (touchOpportunity(row) / oppTotal) * 100;
    const carryTotal = teamCarries.get(key) ?? 0;
    if (carryTotal > 0) row.values.carry_share = (carries / carryTotal) * 100;
    if (row.position === "RB") {
      const rbTargetTotal = teamRbTargets.get(key) ?? 0;
      if (rbTargetTotal > 0) row.values.rb_target_share = (targets / rbTargetTotal) * 100;
    }
  }
}

/** Merge offensive snap % from nflverse snap_counts into matching weekly rows. */
export function applySnapSharesToRows(rows: ChartStatRow[], snaps: SnapCountRow[]): void {
  const byKey = new Map<string, number>();
  for (const snap of snaps) {
    if (!Number.isFinite(snap.offensePct)) continue;
    byKey.set(snapLookupKey(snap.player, snap.team, snap.week), snap.offensePct * 100);
  }
  for (const row of rows) {
    if (!SKILL.has(row.position)) continue;
    const pct = byKey.get(snapLookupKey(row.name, row.team, row.week));
    if (pct !== undefined) row.values.snap_share = pct;
  }
}

/** Build compact weekly snap series keyed by player id from enriched rows. */
export function weeklySnapsByPlayerId(rows: ChartStatRow[], season: number): Map<string, WeeklySnapPoint[]> {
  const grouped = new Map<string, Map<number, number>>();
  for (const row of rows) {
    if (row.season !== season || !SKILL.has(row.position)) continue;
    const snap = row.values.snap_share;
    if (typeof snap !== "number" || !Number.isFinite(snap)) continue;
    const weeks = grouped.get(row.id) ?? new Map<number, number>();
    weeks.set(row.week, snap);
    grouped.set(row.id, weeks);
  }
  const output = new Map<string, WeeklySnapPoint[]>();
  for (const [id, weeks] of grouped) {
    output.set(
      id,
      [...weeks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([week, snapShare]) => ({ week, snapShare: Number(snapShare.toFixed(3)) })),
    );
  }
  return output;
}

export function redZoneShare(
  playerTotal: number,
  teamTotal: number,
): number | null {
  if (!(teamTotal > 0) || !(playerTotal >= 0)) return null;
  return Number(((playerTotal / teamTotal) * 100).toFixed(3));
}

/** Season red-zone target/carry shares from per-player and per-team totals. */
export function buildRedZoneShares(
  playerTotals: Map<string, PlayerRedZoneTotals>,
  teamTotals: Map<string, PlayerRedZoneTotals>,
  playerTeam: Map<string, string>,
): Map<string, { rz_target_share?: number; rz_carry_share?: number }> {
  const output = new Map<string, { rz_target_share?: number; rz_carry_share?: number }>();
  for (const [playerId, totals] of playerTotals) {
    const team = playerTeam.get(playerId);
    if (!team) continue;
    const teamRow = teamTotals.get(team);
    if (!teamRow) continue;
    const shares: { rz_target_share?: number; rz_carry_share?: number } = {};
    const targetShare = redZoneShare(totals.targets, teamRow.targets);
    const carryShare = redZoneShare(totals.carries, teamRow.carries);
    if (targetShare !== null) shares.rz_target_share = targetShare;
    if (carryShare !== null) shares.rz_carry_share = carryShare;
    if (shares.rz_target_share !== undefined || shares.rz_carry_share !== undefined) {
      output.set(playerId, shares);
    }
  }
  return output;
}

export function averageProe(sum: number, count: number): number | null {
  if (!(count > 0)) return null;
  return Number((sum / count).toFixed(3));
}

export function teamProeFromAccumulators(
  accumulators: Map<string, TeamProeAccumulator>,
): Map<string, number> {
  const output = new Map<string, number>();
  for (const [team, { sum, count }] of accumulators) {
    const value = averageProe(sum, count);
    if (value !== null) output.set(team, value);
  }
  return output;
}

/**
 * Parse nflverse snap_counts CSV into compact rows (offense only).
 * `offense_pct` is a 0–1 fraction in the source file.
 */
export function parseSnapCountsCsv(csv: string): SnapCountRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0] ?? "");
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const weekIdx = index.week;
  const playerIdx = index.player;
  const teamIdx = index.team;
  const positionIdx = index.position;
  const pctIdx = index.offense_pct;
  const gameTypeIdx = index.game_type;
  if (
    weekIdx === undefined
    || playerIdx === undefined
    || teamIdx === undefined
    || positionIdx === undefined
    || pctIdx === undefined
  ) {
    return [];
  }

  const output: SnapCountRow[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (gameTypeIdx !== undefined && cells[gameTypeIdx] && cells[gameTypeIdx] !== "REG") continue;
    const week = Number(cells[weekIdx]);
    const player = cells[playerIdx] ?? "";
    const team = cells[teamIdx] ?? "";
    const position = cells[positionIdx] ?? "";
    const offensePct = Number(cells[pctIdx]);
    if (!Number.isFinite(week) || !player || !team || !Number.isFinite(offensePct)) continue;
    if (!SKILL.has(position)) continue;
    output.push({ week, player, team, position, offensePct });
  }
  return output;
}

/** Minimal CSV line splitter that respects quotes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  cells.push(field);
  return cells;
}

export type PbpDerivedMetrics = {
  playerRedZone: Map<string, PlayerRedZoneTotals>;
  teamRedZone: Map<string, PlayerRedZoneTotals>;
  playerTeam: Map<string, string>;
  teamProe: Map<string, TeamProeAccumulator>;
};

/** Accumulate red-zone opportunity and pass_oe (PROE) from one pbp row object. */
export function accumulatePbpRow(
  state: PbpDerivedMetrics,
  row: Record<string, string>,
): void {
  if ((row.season_type ?? "") !== "REG") return;
  const team = row.posteam ?? "";
  if (!team) return;

  const passOeRaw = row.pass_oe;
  if (passOeRaw !== undefined && passOeRaw !== "") {
    const passOe = Number(passOeRaw);
    if (Number.isFinite(passOe)) {
      const current = state.teamProe.get(team) ?? { sum: 0, count: 0 };
      current.sum += passOe;
      current.count += 1;
      state.teamProe.set(team, current);
    }
  }

  const yardline = Number(row.yardline_100);
  if (!Number.isFinite(yardline) || yardline > 20) return;

  const teamRz = state.teamRedZone.get(team) ?? { targets: 0, carries: 0 };
  if (row.pass_attempt === "1" || row.pass_attempt === "1.0") {
    const receiverId = row.receiver_player_id ?? "";
    if (receiverId) {
      teamRz.targets += 1;
      const player = state.playerRedZone.get(receiverId) ?? { targets: 0, carries: 0 };
      player.targets += 1;
      state.playerRedZone.set(receiverId, player);
      state.playerTeam.set(receiverId, team);
    }
  }
  if (row.rush_attempt === "1" || row.rush_attempt === "1.0") {
    const rusherId = row.rusher_player_id ?? "";
    if (rusherId) {
      teamRz.carries += 1;
      const player = state.playerRedZone.get(rusherId) ?? { targets: 0, carries: 0 };
      player.carries += 1;
      state.playerRedZone.set(rusherId, player);
      state.playerTeam.set(rusherId, team);
    }
  }
  state.teamRedZone.set(team, teamRz);
}

export function emptyPbpDerivedMetrics(): PbpDerivedMetrics {
  return {
    playerRedZone: new Map(),
    teamRedZone: new Map(),
    playerTeam: new Map(),
    teamProe: new Map(),
  };
}

/**
 * Parse a full pbp CSV string into red-zone + PROE accumulators.
 * Prefer streaming in production; this helper is for tests and small fixtures.
 */
export function deriveMetricsFromPbpCsv(csv: string): PbpDerivedMetrics {
  const state = emptyPbpDerivedMetrics();
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return state;
  const headers = splitCsvLine(lines[0] ?? "");
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    accumulatePbpRow(state, row);
  }
  return state;
}
