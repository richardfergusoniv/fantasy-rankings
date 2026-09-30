DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE source_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
