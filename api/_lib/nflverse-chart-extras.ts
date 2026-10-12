import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db.js";
import {
  averageProe,
  buildRedZoneShares,
  emptyPbpDerivedMetrics,
  parseSnapCountsCsv,
  splitCsvLine,
  accumulatePbpRow,
  type SnapCountRow,
} from "./chart-metric-transforms.js";
import { canonicalTeam, fetchText, SOURCE_TIMEOUT_MS } from "./sleeper.js";
import { decodeSourceCachePayload, encodeSourceCachePayload } from "./source-cache-payload.js";

export const NFLVERSE_SNAP_COUNTS_2026_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2026.csv";
export const NFLVERSE_PBP_2026_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv";

export const CHART_EXTRAS_CACHE_KEY = "nflverse-chart-extras-2026-v1";
export const CHART_EXTRAS_CACHE_MS = 6 * 60 * 60 * 1000;

const playerExtrasSchema = z.object({
  rzTargetShare: z.number().optional(),
  rzCarryShare: z.number().optional(),
});

const teamExtrasSchema = z.object({
  proe: z.number(),
});

const snapRowSchema = z.object({
  week: z.number().int(),
  player: z.string(),
  team: z.string(),
  position: z.string(),
  offensePct: z.number(),
});

export const chartExtrasSnapshotSchema = z.object({
  fetchedAt: z.string(),
  season: z.literal(2026),
  snaps: z.array(snapRowSchema),
  players: z.record(z.string(), playerExtrasSchema),
  teams: z.record(z.string(), teamExtrasSchema),
});

export type ChartExtrasSnapshot = z.infer<typeof chartExtrasSnapshotSchema>;

const PBP_NEEDED = [
  "season_type",
  "posteam",
  "pass_oe",
  "yardline_100",
  "pass_attempt",
  "rush_attempt",
  "receiver_player_id",
  "rusher_player_id",
] as const;

async function streamPbpDerived(url: string): Promise<{
  players: Record<string, { rzTargetShare?: number; rzCarryShare?: number }>;
  teams: Record<string, { proe: number }>;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(SOURCE_TIMEOUT_MS, 45_000));
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "fantasy-rankings-chart-extras/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`PBP HTTP ${response.status}`);
    if (!response.body) throw new Error("PBP response missing body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let headers: string[] | null = null;
    const columnIndex = new Map<string, number>();
    const state = emptyPbpDerivedMetrics();

    const consumeLine = (line: string) => {
      if (!line) return;
      if (!headers) {
        headers = splitCsvLine(line);
        for (const key of PBP_NEEDED) {
          const index = headers.indexOf(key);
          if (index >= 0) columnIndex.set(key, index);
        }
        return;
      }
      const cells = splitCsvLine(line);
      const row: Record<string, string> = {};
      for (const key of PBP_NEEDED) {
        const index = columnIndex.get(key);
        row[key] = index === undefined ? "" : (cells[index] ?? "");
      }
      if (row.posteam) row.posteam = canonicalTeam(row.posteam);
      accumulatePbpRow(state, row);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consumeLine(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);

    const shares = buildRedZoneShares(state.playerRedZone, state.teamRedZone, state.playerTeam);
    const players: Record<string, { rzTargetShare?: number; rzCarryShare?: number }> = {};
    for (const [playerId, value] of shares) {
      players[playerId] = {
        ...(value.rz_target_share !== undefined ? { rzTargetShare: value.rz_target_share } : {}),
        ...(value.rz_carry_share !== undefined ? { rzCarryShare: value.rz_carry_share } : {}),
      };
    }
    const teams: Record<string, { proe: number }> = {};
    for (const [team, { sum, count }] of state.teamProe) {
      const proe = averageProe(sum, count);
      if (proe !== null) teams[canonicalTeam(team)] = { proe };
    }
    return { players, teams };
  } finally {
    clearTimeout(timer);
  }
}

function canonicalizeSnapRows(rows: SnapCountRow[]): SnapCountRow[] {
  return rows.map((row) => ({
    ...row,
    team: canonicalTeam(row.team),
  }));
}

export async function readChartExtrasSnapshot(): Promise<ChartExtrasSnapshot | null> {
  const [cached] = await db
    .select()
    .from(schema.sourceCache)
    .where(eq(schema.sourceCache.cacheKey, CHART_EXTRAS_CACHE_KEY))
    .limit(1);
  if (!cached) return null;
  try {
    const parsed = chartExtrasSnapshotSchema.safeParse(decodeSourceCachePayload(cached.payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ChartExtrasRefreshResult = {
  ok: true;
  status: "committed" | "kept-previous" | "fresh-cache" | "empty";
  players: number;
  teams: number;
  snaps: number;
  fetchedAt: string | null;
};

async function writeChartExtrasSnapshot(snapshot: ChartExtrasSnapshot): Promise<void> {
  const payload = encodeSourceCachePayload(snapshot);
  await db.insert(schema.sourceCache).values({
    cacheKey: CHART_EXTRAS_CACHE_KEY,
    payload,
    fetchedAt: new Date(snapshot.fetchedAt),
  }).onConflictDoUpdate({
    target: schema.sourceCache.cacheKey,
    set: { payload, fetchedAt: new Date(snapshot.fetchedAt) },
  });
}

/**
 * Load chart extras from cache when fresh; otherwise rebuild from nflverse
 * snap_counts + pbp and store a compact snapshot (never the raw CSVs).
 */
export async function loadChartExtrasSnapshot(options?: {
  force?: boolean;
}): Promise<ChartExtrasSnapshot | null> {
  const previous = await readChartExtrasSnapshot();
  if (
    !options?.force
    && previous
    && Date.now() - Date.parse(previous.fetchedAt) < CHART_EXTRAS_CACHE_MS
  ) {
    return previous;
  }

  try {
    const [snapCsv, pbpDerived] = await Promise.all([
      fetchText(NFLVERSE_SNAP_COUNTS_2026_URL, 30_000),
      streamPbpDerived(NFLVERSE_PBP_2026_URL),
    ]);
    const snaps = canonicalizeSnapRows(parseSnapCountsCsv(snapCsv));
    if (snaps.length < 100 && Object.keys(pbpDerived.teams).length < 20) {
      return previous;
    }
    const snapshot: ChartExtrasSnapshot = {
      fetchedAt: new Date().toISOString(),
      season: 2026,
      snaps,
      players: pbpDerived.players,
      teams: pbpDerived.teams,
    };
    await writeChartExtrasSnapshot(snapshot);
    return snapshot;
  } catch {
    return previous;
  }
}

export async function refreshChartExtrasSnapshot(): Promise<ChartExtrasRefreshResult> {
  const previous = await readChartExtrasSnapshot();
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < CHART_EXTRAS_CACHE_MS) {
    return {
      ok: true,
      status: "fresh-cache",
      players: Object.keys(previous.players).length,
      teams: Object.keys(previous.teams).length,
      snaps: previous.snaps.length,
      fetchedAt: previous.fetchedAt,
    };
  }
  const snapshot = await loadChartExtrasSnapshot({ force: true });
  if (!snapshot) {
    return {
      ok: true,
      status: previous ? "kept-previous" : "empty",
      players: previous ? Object.keys(previous.players).length : 0,
      teams: previous ? Object.keys(previous.teams).length : 0,
      snaps: previous?.snaps.length ?? 0,
      fetchedAt: previous?.fetchedAt ?? null,
    };
  }
  const committed = !previous || snapshot.fetchedAt !== previous.fetchedAt;
  return {
    ok: true,
    status: committed ? "committed" : "kept-previous",
    players: Object.keys(snapshot.players).length,
    teams: Object.keys(snapshot.teams).length,
    snaps: snapshot.snaps.length,
    fetchedAt: snapshot.fetchedAt,
  };
}
