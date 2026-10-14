-- One-time cleanup for player_value_snapshots (NOT applied automatically).
-- Run manually in the Supabase SQL editor against the production DB.
--
-- Goals:
--   1. Delete formats not in the dynamic kept set
--   2. Delete "tomorrow"-dated rows written via UTC instead of America/Los_Angeles
--   3. Downsample rows older than 90 Pacific days to one point per ISO week
--   4. Report estimated rows remaining (and note VACUUM FULL for space reclaim)
--
-- =============================================================================
-- DYNAMIC KEPT FORMAT SET
-- =============================================================================
-- Kept formats are NOT hardcoded. They are every distinct
-- seasonLongFormatForLeague(key) across:
--   - all sleeper_connections.sleeper_user_id (every signed-in / linked user)
--   - plus OWNER_SLEEPER_USER_ID when set
-- discovered at runtime by refresh-fantasycalc and cached at:
--   source_cache.cache_key = 'value-history:kept-formats'
--   payload JSON: { "formatKeys": [...], "formats": [...], "asOf": "..." }
--   (usually uncompressed; may be gz1: if ever large)
--
-- Preview the last discovered set (after at least one refresh):
--
--   SELECT payload
--   FROM source_cache
--   WHERE cache_key = 'value-history:kept-formats';
--
-- Or rebuild the set yourself from linked users + Sleeper:
--   1) SELECT sleeper_user_id FROM sleeper_connections;
--   2) For each id: GET https://api.sleeper.app/v1/user/{id}/leagues/nfl/{season}
--   3) Derive format key = {dynasty|redraft}-{N}qb-{teams}t-{ppr}ppr
--      (same rules as api/_lib/sleeper.ts seasonLongFormatForLeague)
--   4) Always include default: redraft-1qb-12t-0.5ppr
--
-- Replace the VALUES list below with those keys before running the DELETEs.
-- Example from owner leagues as of 2026-10-13 (verify against the cache row):
-- =============================================================================

BEGIN;

-- Preview counts before mutating (safe to re-run the SELECTs alone).
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (
    WHERE format_key NOT IN (
      'redraft-1qb-12t-0.5ppr',
      'dynasty-1qb-10t-0.5ppr',
      'dynasty-1qb-12t-1ppr',
      'dynasty-2qb-14t-1ppr',
      'dynasty-2qb-12t-1ppr'
      -- add any additional keys from value-history:kept-formats / Sleeper discovery
    )
  ) AS unused_format_rows,
  COUNT(*) FILTER (
    WHERE snapshot_date > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date::text
  ) AS future_dated_rows
FROM player_value_snapshots;

-- 1) Drop formats outside the dynamic kept set (UPDATE THE VALUES LIST).
DELETE FROM player_value_snapshots
WHERE format_key NOT IN (
  'redraft-1qb-12t-0.5ppr',
  'dynasty-1qb-10t-0.5ppr',
  'dynasty-1qb-12t-1ppr',
  'dynasty-2qb-14t-1ppr',
  'dynasty-2qb-12t-1ppr'
  -- add any additional keys from value-history:kept-formats / Sleeper discovery
);

-- 2) Drop rows dated after Pacific "today" (UTC-"tomorrow" bug).
DELETE FROM player_value_snapshots
WHERE snapshot_date > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date::text;

-- 3) Downsample history older than 90 Pacific days to one row per ISO week
--    (keep the last available day in each week per format×player).
WITH bounds AS (
  SELECT
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date AS today,
    ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - 90) AS daily_cutoff
),
keep_weekly AS (
  SELECT DISTINCT ON (p.format_key, p.player_id, date_trunc('week', p.snapshot_date::date))
    p.id
  FROM player_value_snapshots p
  CROSS JOIN bounds b
  WHERE p.snapshot_date::date <= b.daily_cutoff
  ORDER BY
    p.format_key,
    p.player_id,
    date_trunc('week', p.snapshot_date::date),
    p.snapshot_date DESC
)
DELETE FROM player_value_snapshots p
USING bounds b
WHERE p.snapshot_date::date <= b.daily_cutoff
  AND NOT EXISTS (SELECT 1 FROM keep_weekly k WHERE k.id = p.id);

-- 4) Report remaining rows by format / age band.
WITH bounds AS (
  SELECT
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date AS today,
    ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date - 90) AS daily_cutoff
)
SELECT
  format_key,
  COUNT(*) FILTER (WHERE snapshot_date::date > (SELECT daily_cutoff FROM bounds)) AS daily_rows,
  COUNT(*) FILTER (WHERE snapshot_date::date <= (SELECT daily_cutoff FROM bounds)) AS weekly_rows,
  COUNT(*) AS total_rows
FROM player_value_snapshots
GROUP BY format_key
ORDER BY format_key;

SELECT
  COUNT(*) AS estimated_rows_remaining,
  pg_size_pretty(pg_total_relation_size('player_value_snapshots')) AS size_before_vacuum
FROM player_value_snapshots;

COMMIT;

-- Optional (run separately after reviewing counts):
-- VACUUM FULL player_value_snapshots;
-- SELECT pg_size_pretty(pg_total_relation_size('player_value_snapshots')) AS size_after_vacuum;
