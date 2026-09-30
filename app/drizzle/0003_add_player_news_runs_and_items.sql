CREATE TABLE `player_news_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `checked_at` integer NOT NULL,
  `item_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_news_items` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `player_id` text NOT NULL,
  `player` text NOT NULL,
  `team` text NOT NULL,
  `change` text NOT NULL,
  `leagues_json` text NOT NULL,
  `role_context` text NOT NULL,
  `source_label` text NOT NULL,
  `source_url` text NOT NULL,
  `source_published_at` integer,
  FOREIGN KEY (`run_id`) REFERENCES `player_news_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_news_items_run_id_idx` ON `player_news_items` (`run_id`);
