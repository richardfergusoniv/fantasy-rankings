CREATE TABLE `saved_chart_views` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `dataset` text NOT NULL,
  `position` text NOT NULL,
  `x_metric` text NOT NULL,
  `y_metric` text NOT NULL,
  `window` text NOT NULL,
  `show_quadrants` integer DEFAULT true NOT NULL,
  `plot_limit` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_chart_views_dataset_idx` ON `saved_chart_views` (`dataset`);
