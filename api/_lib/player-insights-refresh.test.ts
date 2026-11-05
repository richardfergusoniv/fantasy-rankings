import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ db: {}, schema: {} }));

/**
 * Chart extras behind a controllable store: the mock refresh swaps the
 * refreshed snapshot into the store (or throws), so tests can prove the
 * analytics precompute refreshes before it reads, and that a failed
 * refresh leaves the stored snapshot in place.
 */
const extras = vi.hoisted(() => ({
  stored: null as unknown,
  refreshed: null as unknown,
  failRefresh: false,
  events: [] as string[],
}));

vi.mock("./nflverse-chart-extras.js", () => ({
  readChartExtrasSnapshot: vi.fn(async () => {
    extras.events.push("read");
    return extras.stored;
  }),
  refreshChartExtrasSnapshot: vi.fn(async () => {
    extras.events.push("refresh");
    if (extras.failRefresh) throw new Error("chart extras refresh failed");
    if (extras.refreshed) extras.stored = extras.refreshed;
    return { ok: true, status: "committed", players: 0, teams: 0, snaps: 0, fetchedAt: null };
  }),
}));

import type { PlayerInsightsSnapshot } from "./player-insights.js";

const {
  fetchPlayerInsightsSnapshot,
  DEPTH_CHARTS_2026_URL,
  FF_OPPORTUNITY_2026_URL,
  PLAYER_IDS_URL,
} = await import("./player-insights");
const { NFLVERSE_PLAYER_STATS_2025_URL, NFLVERSE_PLAYER_STATS_2026_URL } = await import("./analytics-build");

const OPPORTUNITY_CSV = [
  "season,week,player_id,total_fantasy_points,total_fantasy_points_exp",
  "2026,1,00-1,22,20",
].join("\n");
const IDS_CSV_MAPPED = ["gsis_id,sleeper_id,name", "00-1,12526,Test Player"].join("\n");
const IDS_CSV_EMPTY = ["gsis_id,sleeper_id,name", "00-1,NA,Test Player"].join("\n");
// Header only: no season rows, so the fresh NGS merge comes back empty.
const NGS_CSV = "season,season_type,week,player_gsis_id,avg_separation";
const STATS_HEADER =
  "player_id,player_display_name,position,season,season_type,week,game_id,team,targets,receptions,receiving_yards,carries,rushing_yards,fantasy_points,fantasy_points_ppr";
const STATS_2026_CSV = [
  STATS_HEADER,
  "00-1,Test Player,WR,2026,REG,1,2026_01_KC_BUF,KC,10,7,90,2,15,20.5,27.5",
].join("\n");

let idsCsv = IDS_CSV_MAPPED;

function gzipArrayBuffer(text: string): ArrayBuffer {
  const buffer = gzipSync(text);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function installFetchStub(): void {
  const fetchStub = vi.fn(async (input: unknown) => {
    const url = String(input);
    // No body: the depth reader throws and the fetch falls back to no rows.
    if (url === DEPTH_CHARTS_2026_URL) return { ok: true, body: null };
    if (url.endsWith(".gz")) return { ok: true, arrayBuffer: async () => gzipArrayBuffer(NGS_CSV) };
    if (url === FF_OPPORTUNITY_2026_URL) return { ok: true, text: async () => OPPORTUNITY_CSV };
    if (url === PLAYER_IDS_URL) return { ok: true, text: async () => idsCsv };
    if (url === NFLVERSE_PLAYER_STATS_2025_URL) return { ok: true, text: async () => STATS_HEADER };
    if (url === NFLVERSE_PLAYER_STATS_2026_URL) return { ok: true, text: async () => STATS_2026_CSV };
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchStub);
}

function extrasSnapshot(
  players: Record<string, { rzTargetShare?: number }>,
  teams: Record<string, { proe: number }>,
) {
  return { fetchedAt: "2026-10-20T00:00:00.000Z", season: 2026, snaps: [], players, teams };
}

function previousSnapshot(overrides: Partial<PlayerInsightsSnapshot>): PlayerInsightsSnapshot {
  return {
    fetchedAt: "2026-10-20T00:00:00.000Z",
    season: 2026,
    opportunity: {},
    ngs: {},
    depth: {},
    depthAsOf: null,
    depthPrevious: {},
    ...overrides,
  };
}

describe("fetchPlayerInsightsSnapshot analytics precompute", () => {
  beforeEach(() => {
    idsCsv = IDS_CSV_MAPPED;
    extras.stored = null;
    extras.refreshed = null;
    extras.failRefresh = false;
    extras.events = [];
    installFetchStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives analytics from retained data when the fresh ID map and NGS come back empty", async () => {
    idsCsv = IDS_CSV_EMPTY;
    const previous = previousSnapshot({
      sleeperByGsis: { "00-1": "12526" },
      ngs: { "00-1": { separation: 2.7 } },
    });
    const snapshot = await fetchPlayerInsightsSnapshot(previous);
    expect(snapshot.sleeperByGsis).toEqual({ "00-1": "12526" });
    expect(snapshot.ngs).toEqual({ "00-1": { separation: 2.7 } });
    const entity = snapshot.analytics?.entities.find((entry) => entry.id === "WR:00-1");
    // Stamped through the retained map, with the retained NGS metrics merged in.
    expect(entity?.playerId).toBe("12526");
    expect(entity?.season.separation).toBe(2.7);
  });

  it("leaves player ids null and NGS metrics off when there is nothing to retain", async () => {
    idsCsv = IDS_CSV_EMPTY;
    const snapshot = await fetchPlayerInsightsSnapshot(null);
    const entity = snapshot.analytics?.entities.find((entry) => entry.id === "WR:00-1");
    expect(entity?.playerId).toBeNull();
    expect(entity?.season.separation).toBeUndefined();
  });

  it("refreshes chart extras before reading them for the precompute", async () => {
    extras.stored = extrasSnapshot({ "00-1": { rzTargetShare: 11 } }, { KC: { proe: 1.5 } });
    extras.refreshed = extrasSnapshot({ "00-1": { rzTargetShare: 42 } }, { KC: { proe: 9.9 } });
    const snapshot = await fetchPlayerInsightsSnapshot(null);
    expect(extras.events.indexOf("refresh")).toBeGreaterThanOrEqual(0);
    expect(extras.events.indexOf("refresh")).toBeLessThan(extras.events.indexOf("read"));
    const entity = snapshot.analytics?.entities.find((entry) => entry.id === "WR:00-1");
    expect(entity?.season.rz_target_share).toBe(42);
    expect(snapshot.analytics?.teamUsage.find((row) => row.team === "KC")?.proe).toBe(9.9);
  });

  it("keeps the stored chart extras when the refresh fails", async () => {
    extras.stored = extrasSnapshot({ "00-1": { rzTargetShare: 11 } }, { KC: { proe: 1.5 } });
    extras.failRefresh = true;
    const snapshot = await fetchPlayerInsightsSnapshot(null);
    const entity = snapshot.analytics?.entities.find((entry) => entry.id === "WR:00-1");
    expect(entity?.season.rz_target_share).toBe(11);
    expect(snapshot.analytics?.teamUsage.find((row) => row.team === "KC")?.proe).toBe(1.5);
  });
});
