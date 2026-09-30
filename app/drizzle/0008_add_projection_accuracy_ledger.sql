CREATE TABLE `projection_accuracy` (
  `id` text PRIMARY KEY NOT NULL,
  `season` integer NOT NULL,
  `week` integer NOT NULL,
  `league_id` text NOT NULL,
  `scoring` text NOT NULL,
  `player_id` text NOT NULL,
  `player_name` text NOT NULL,
  `position` text NOT NULL,
  `model_projection` integer NOT NULL,
  `first_down_projection` integer,
  `actual_score` integer,
  `captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projection_accuracy_season_week_idx` ON `projection_accuracy` (`season`,`week`);
