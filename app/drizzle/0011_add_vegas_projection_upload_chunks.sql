CREATE TABLE `vegas_projection_upload_chunks` (
  `id` text PRIMARY KEY NOT NULL,
  `upload_key` text NOT NULL,
  `season` integer NOT NULL,
  `week` integer NOT NULL,
  `built_at` integer NOT NULL,
  `source` text NOT NULL,
  `leagues_payload` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `chunk_count` integer NOT NULL,
  `projections_payload` text NOT NULL,
  `stored_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vegas_projection_upload_chunks_upload_index_idx` ON `vegas_projection_upload_chunks` (`upload_key`,`chunk_index`);
--> statement-breakpoint
CREATE INDEX `vegas_projection_upload_chunks_season_week_built_idx` ON `vegas_projection_upload_chunks` (`season`,`week`,`built_at`);
