CREATE TABLE `player_value_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `snapshot_date` text NOT NULL,
  `format_key` text NOT NULL,
  `player_id` text NOT NULL,
  `player_name` text NOT NULL,
  `position` text NOT NULL,
  `value` integer NOT NULL,
  `captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_value_snapshots_lookup_idx` ON `player_value_snapshots` (`format_key`, `player_id`, `snapshot_date`);
