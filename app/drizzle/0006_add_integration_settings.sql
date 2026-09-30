CREATE TABLE `integration_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `secret_value` text NOT NULL,
  `status` text DEFAULT 'connected' NOT NULL,
  `updated_at` integer NOT NULL
);
