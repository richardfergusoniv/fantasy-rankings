/**
 * Sleeper Picks (the player pick'em board) as a reference source for the
 * Monitor props table. The board is public — GET
 * https://api.sleeper.app/lines/available, no auth — and its subject ids
 * are plain Sleeper player ids (verified live Oct 16, 2026). The pipeline
 * stages the NFL slice through the ingest endpoint; this module owns the
 * stat mapping and normalization so the multiplier never blends into the
 * book consensus: Sleeper is shown as its own column, not a seventh book.
 */

import { z } from "zod";
import { isPropStatId, type PropStatId } from "./prop-line-reads.js";

/** Sleeper wager_type → the props table's canonical stat id. */
export const SLEEPER_WAGER_STAT_MAP: Readonly<Record<string, PropStatId>> = {
  passing_yards: "pass_yards",
  passing_touchdowns: "pass_tds",
  pass_completions: "pass_completions",
  passing_attempts: "pass_attempts",
  interceptions: "pass_interceptions",
  rushing_yards: "rush_yards",
  rushing_attempts: "rush_attempts",
  receiving_yards: "rec_yards",
  receptions: "receptions",
  longest_reception: "longest_reception",
  anytime_touchdowns: "anytime_td",
  sacks: "sacks",
  tackles: "tackles",
  kicking_points: "kicker_points",
  field_goal_made: "field_goals_made",
};

export type SleeperPickLine = {
  playerId: string;
  stat: PropStatId;
  line: number;
  overMultiplier: number | null;
  underMultiplier: number | null;
};

export type SleeperPicksBoard = {
  pulledAt: string;
  lines: SleeperPickLine[];
};

const sleeperPickOptionSchema = z.object({
  outcome: z.string().max(24),
  outcome_value: z.number(),
  payout_multiplier: z.union([z.string().max(16), z.number()]).optional(),
});

const sleeperPickMarketSchema = z.object({
  sport: z.string().max(40),
  status: z.string().max(24),
  subject_id: z.union([z.string().max(24), z.number()]),
  subject_type: z.string().max(24),
  wager_type: z.string().max(48),
  options: z.array(sleeperPickOptionSchema).max(12),
});

export const sleeperPicksIngestSchema = z.object({
  season: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(25),
  pulled_at: z.string().datetime(),
  // The NFL slice of /lines/available, unfiltered beyond sport.
  lines: z.array(z.unknown()).max(4000),
});

function parseMultiplier(raw: string | number | undefined): number | null {
  if (raw === undefined) return null;
  const value = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Normalize the raw board into compact lines keyed by Sleeper player id
 * and canonical stat. Non-NFL, inactive, non-player, and unmapped-stat
 * markets drop out, as do markets without an over or under option.
 */
export function normalizeSleeperPicksBoard(rawLines: readonly unknown[]): SleeperPickLine[] {
  const byKey = new Map<string, SleeperPickLine>();
  for (const raw of rawLines) {
    const parsed = sleeperPickMarketSchema.safeParse(raw);
    if (!parsed.success) continue;
    const market = parsed.data;
    if (market.sport !== "nfl" || market.status !== "active" || market.subject_type !== "player") continue;
    const stat = SLEEPER_WAGER_STAT_MAP[market.wager_type];
    if (!stat) continue;
    const over = market.options.find((option) => option.outcome === "over");
    const under = market.options.find((option) => option.outcome === "under");
    const line = over?.outcome_value ?? under?.outcome_value;
    if (typeof line !== "number" || !Number.isFinite(line)) continue;
    const playerId = String(market.subject_id);
    const entry: SleeperPickLine = {
      playerId,
      stat,
      line,
      overMultiplier: parseMultiplier(over?.payout_multiplier),
      underMultiplier: parseMultiplier(under?.payout_multiplier),
    };
    byKey.set(`${playerId}|${stat}`, entry);
  }
  return [...byKey.values()];
}

const storedBoardSchema = z.object({
  pulledAt: z.string(),
  lines: z.array(z.object({
    playerId: z.string(),
    stat: z.string(),
    line: z.number(),
    overMultiplier: z.number().nullable(),
    underMultiplier: z.number().nullable(),
  })),
});

/** Validate a stored board payload (from source_cache) back into lines. */
export function parseStoredSleeperPicks(payload: unknown): SleeperPicksBoard | null {
  const parsed = storedBoardSchema.safeParse(payload);
  if (!parsed.success) return null;
  const lines: SleeperPickLine[] = [];
  for (const line of parsed.data.lines) {
    if (!isPropStatId(line.stat)) continue;
    lines.push({ ...line, stat: line.stat });
  }
  return { pulledAt: parsed.data.pulledAt, lines };
}

export function buildSleeperPickMap(lines: readonly SleeperPickLine[]): Map<string, SleeperPickLine> {
  return new Map(lines.map((line) => [`${line.playerId}|${line.stat}`, line]));
}

export function sleeperPicksCacheKey(season: number, week: number): string {
  return `sleeper-picks:${season}:${week}`;
}
