import { z } from "zod";
import { normalizePlayerNameKey } from "./player-news-shared.js";

/**
 * Pure helpers for dated consensus prop-line snapshot ingest.
 * Kept free of DB / network so vitest can cover the consensus transform.
 */

export const PROP_LINE_SNAPSHOT_MAX_ROWS = 5000;

const consensusRowSchema = z.object({
  player: z.string().min(1).max(160),
  player_id: z.string().min(1).max(80).optional(),
  stat: z.string().min(1).max(64),
  consensus_line: z.number().finite(),
  median_over_odds: z.number().finite().nullable().optional(),
  median_under_odds: z.number().finite().nullable().optional(),
  book_count: z.number().int().nonnegative(),
  week: z.number().int().min(1).max(25).optional(),
  season: z.number().int().min(2020).max(2100).optional(),
});

export const propLineSnapshotPayloadSchema = z
  .object({
    season: z.number().int().min(2020).max(2100),
    week: z.number().int().min(1).max(25),
    pulled_at: z.string().datetime().optional(),
    built_at: z.string().datetime().optional(),
    consensus: z.array(consensusRowSchema).max(PROP_LINE_SNAPSHOT_MAX_ROWS),
  })
  .refine((payload) => Boolean(payload.pulled_at || payload.built_at), {
    message: "pulled_at or built_at is required.",
  });

export type PropLineSnapshotPayload = z.infer<typeof propLineSnapshotPayloadSchema>;
export type ConsensusPropRow = z.infer<typeof consensusRowSchema>;

export type PropLineSnapshotRow = {
  pulledAt: Date;
  playerId: string;
  stat: string;
  line: number;
  medianOverOdds: number | null;
  medianUnderOdds: number | null;
  bookCount: number;
  week: number;
  season: number;
};

export type PropLineSnapshotTransformResult = {
  rows: PropLineSnapshotRow[];
  unresolved: string[];
  skippedDuplicates: number;
};

function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Collapse a staged consensus payload into compact dated snapshot rows.
 * Resolves Sleeper player ids from an optional embedded player_id or a
 * name index. Dedupes on (player_id, stat) within the same pull.
 */
export function toPropLineSnapshotRows(
  payload: PropLineSnapshotPayload,
  playerIdsByName: Map<string, string>,
): PropLineSnapshotTransformResult {
  const pulledAtRaw = payload.pulled_at ?? payload.built_at;
  if (!pulledAtRaw) {
    return { rows: [], unresolved: [], skippedDuplicates: 0 };
  }
  const pulledAt = new Date(pulledAtRaw);
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const rows: PropLineSnapshotRow[] = [];
  let skippedDuplicates = 0;

  for (const row of payload.consensus) {
    const playerId =
      row.player_id?.trim() ||
      playerIdsByName.get(normalizePlayerNameKey(row.player)) ||
      null;
    if (!playerId) {
      unresolved.push(row.player);
      continue;
    }
    const dedupeKey = `${playerId}|${row.stat}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(dedupeKey);
    rows.push({
      pulledAt,
      playerId,
      stat: row.stat,
      line: row.consensus_line,
      medianOverOdds: finiteOrNull(row.median_over_odds),
      medianUnderOdds: finiteOrNull(row.median_under_odds),
      bookCount: row.book_count,
      week: row.week ?? payload.week,
      season: row.season ?? payload.season,
    });
  }

  return { rows, unresolved, skippedDuplicates };
}
