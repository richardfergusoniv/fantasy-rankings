ALTER TABLE `player_news_items` ADD `news_type` text NOT NULL DEFAULT 'roster';
--> statement-breakpoint
ALTER TABLE `player_news_items` ADD `availability_json` text;
