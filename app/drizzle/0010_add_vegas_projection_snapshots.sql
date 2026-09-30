CREATE TABLE `vegas_projection_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `season` integer NOT NULL,
  `week` integer NOT NULL,
  `built_at` integer NOT NULL,
  `source` text NOT NULL,
  `payload` text NOT NULL,
  `stored_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vegas_projection_snapshots_season_week_idx` ON `vegas_projection_snapshots` (`season`,`week`);
