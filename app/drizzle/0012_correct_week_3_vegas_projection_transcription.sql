UPDATE `vegas_projection_snapshots`
SET `payload` = json_set(
  `payload`,
  '$.projections[230].leagues."1317270144682070016"', 7.5,
  '$.projections[232].expected_stats.kicker_points', 7.5,
  '$.projections[232].leagues."1306489414548979712"', 7.5,
  '$.projections[232].leagues."1311470531635052544"', 7.5,
  '$.projections[232].leagues."1312127020972404736"', 7.5,
  '$.projections[232].leagues."1317270144682070016"', 7.5,
  '$.projections[232].leagues."1355920300633513984"', 7.5,
  '$.projections[232].leagues."1389344450517430272"', 7.5,
  '$.projections[245].expected_stats.rec_yards', 75.5
)
WHERE `id` = '2026:3'
  AND `season` = 2026
  AND `week` = 3
  AND json_extract(`payload`, '$.projections[230].player') = 'Tyler Bass'
  AND json_extract(`payload`, '$.projections[230].team') = 'BUF'
  AND json_extract(`payload`, '$.projections[230].position') = 'K'
  AND json_type(`payload`, '$.projections[230].leagues."1317270144682070016"') IS NULL
  AND json_extract(`payload`, '$.projections[232].player') = 'Tyler Loop'
  AND json_extract(`payload`, '$.projections[232].team') = 'BAL'
  AND json_extract(`payload`, '$.projections[232].position') = 'K'
  AND json_extract(`payload`, '$.projections[232].expected_stats.kicker_points') = 6.5
  AND json_extract(`payload`, '$.projections[245].player') = 'Zay Flowers'
  AND json_extract(`payload`, '$.projections[245].team') = 'BAL'
  AND json_extract(`payload`, '$.projections[245].position') = 'WR'
  AND json_extract(`payload`, '$.projections[245].expected_stats.rec_yards') = 38.5;
--> statement-breakpoint
UPDATE `source_cache`
SET `fetched_at` = 0
WHERE `cache_key` = 'dashboard-live-projections-v8';
