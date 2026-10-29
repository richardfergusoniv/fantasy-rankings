-- One-off cleanup for X player-news rows attached via over-cap text expansion.
-- DO NOT RUN from an agent against production — review, then execute in the
-- Supabase SQL editor (or equivalent) when ready.
--
-- Context: before attach caps, ingest unioned every resolvable name in a post
-- with the producer's explicit player_id. Ranking / tier-list posts landed on
-- dozens of player pages. Caps are now 6 (default) or 15 (practice/injury).
--
-- Explicit producer player_id is NOT knowable from stored data:
-- shared_player_news stores one row per (source, external_id, player_id) with
-- the same change/source_url/author; nothing marks which id was the extract.
-- Safest alternative: delete ALL x rows for over-cap (source, external_id)
-- groups, then re-push those posts through player-news-x so the capped
-- resolver re-attaches (explicit-only for ranking mega-lists; practice reports
-- under 15 keep their expansions).
--
-- Egress-light: touches only shared_player_news (indexed on external_id /
-- player_id). Never scan player_value_snapshots.

-- Preview affected posts ----------------------------------------------------
WITH x_posts AS (
  SELECT
    external_id,
    COUNT(*)::int AS player_count,
    -- Same post text is stored on every row's `change`.
    BOOL_OR(
      COALESCE(change, '') ~*
      '(^|[^[:alnum:]])(dnp|did not practice|limited|lp|fp|full participant|questionable|doubtful|out|injury report|practice report|estimated)([^[:alnum:]]|$)'
    ) AS looks_practice
  FROM shared_player_news
  WHERE source = 'x'
    AND external_id IS NOT NULL
    AND btrim(external_id) <> ''
  GROUP BY external_id
),
over_cap AS (
  SELECT
    external_id,
    player_count,
    looks_practice,
    CASE WHEN looks_practice THEN 15 ELSE 6 END AS cap
  FROM x_posts
  WHERE player_count > CASE WHEN looks_practice THEN 15 ELSE 6 END
)
SELECT external_id, player_count, looks_practice, cap
FROM over_cap
ORDER BY player_count DESC, external_id;

-- Delete after reviewing the preview (uncomment to run) ---------------------
-- WITH x_posts AS (
--   SELECT
--     external_id,
--     COUNT(*)::int AS player_count,
--     BOOL_OR(
--       COALESCE(change, '') ~*
--       '(^|[^[:alnum:]])(dnp|did not practice|limited|lp|fp|full participant|questionable|doubtful|out|injury report|practice report|estimated)([^[:alnum:]]|$)'
--     ) AS looks_practice
--   FROM shared_player_news
--   WHERE source = 'x'
--     AND external_id IS NOT NULL
--     AND btrim(external_id) <> ''
--   GROUP BY external_id
-- ),
-- over_cap AS (
--   SELECT external_id
--   FROM x_posts
--   WHERE player_count > CASE WHEN looks_practice THEN 15 ELSE 6 END
-- )
-- DELETE FROM shared_player_news spn
-- WHERE spn.source = 'x'
--   AND spn.external_id IN (SELECT external_id FROM over_cap);
