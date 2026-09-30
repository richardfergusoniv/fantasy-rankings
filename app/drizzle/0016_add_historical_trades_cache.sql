CREATE TABLE `historical_trades` (
  `id` text PRIMARY KEY NOT NULL,
  `root_league_id` text NOT NULL,
  `sleeper_league_id` text NOT NULL,
  `season` integer NOT NULL,
  `payload` text NOT NULL,
  `fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `historical_trades_root_league_idx` ON `historical_trades` (`root_league_id`);
--> statement-breakpoint
CREATE INDEX `historical_trades_season_idx` ON `historical_trades` (`season`);
