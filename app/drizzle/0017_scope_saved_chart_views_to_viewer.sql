ALTER TABLE `saved_chart_views` ADD `owner_source` text;
--> statement-breakpoint
ALTER TABLE `saved_chart_views` ADD `owner_key` text;
--> statement-breakpoint
CREATE INDEX `saved_chart_views_owner_idx` ON `saved_chart_views` (`owner_source`,`owner_key`);
