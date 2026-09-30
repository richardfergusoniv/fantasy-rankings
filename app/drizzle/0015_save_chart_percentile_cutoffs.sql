ALTER TABLE `saved_chart_views` ADD `x_percentile` integer DEFAULT 50 NOT NULL;
--> statement-breakpoint
ALTER TABLE `saved_chart_views` ADD `y_percentile` integer DEFAULT 50 NOT NULL;
