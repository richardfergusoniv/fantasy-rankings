import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sourceCache = sqliteTable("source_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
});

export const historicalTrades = sqliteTable("historical_trades", {
  id: text("id").primaryKey(),
  rootLeagueId: text("root_league_id").notNull(),
  sleeperLeagueId: text("sleeper_league_id").notNull(),
  season: integer("season").notNull(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("historical_trades_root_league_idx").on(table.rootLeagueId),
  index("historical_trades_season_idx").on(table.season),
]);

export const vegasProjectionSnapshots = sqliteTable("vegas_projection_snapshots", {
  id: text("id").primaryKey(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  builtAt: integer("built_at", { mode: "timestamp_ms" }).notNull(),
  source: text("source").notNull(),
  payload: text("payload").notNull(),
  storedAt: integer("stored_at", { mode: "timestamp_ms" }).notNull(),
});

export const vegasProjectionUploadChunks = sqliteTable("vegas_projection_upload_chunks", {
  id: text("id").primaryKey(),
  uploadKey: text("upload_key").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  builtAt: integer("built_at", { mode: "timestamp_ms" }).notNull(),
  source: text("source").notNull(),
  leaguesPayload: text("leagues_payload").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  projectionsPayload: text("projections_payload").notNull(),
  storedAt: integer("stored_at", { mode: "timestamp_ms" }).notNull(),
});

export const playerValueSnapshots = sqliteTable("player_value_snapshots", {
  id: text("id").primaryKey(),
  snapshotDate: text("snapshot_date").notNull(),
  formatKey: text("format_key").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position").notNull(),
  value: integer("value").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
});

export const projectionAccuracy = sqliteTable("projection_accuracy", {
  id: text("id").primaryKey(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  leagueId: text("league_id").notNull(),
  scoring: text("scoring").notNull(),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  position: text("position").notNull(),
  vegasProjection: integer("vegas_projection").notNull(),
  firstDownProjection: integer("first_down_projection"),
  actualScore: integer("actual_score"),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
});

export const savedChartViews = sqliteTable("saved_chart_views", {
  id: text("id").primaryKey(),
  ownerSource: text("owner_source", { enum: ["owner", "local", "cloudflare"] }),
  ownerKey: text("owner_key"),
  name: text("name").notNull(),
  dataset: text("dataset", { enum: ["advanced", "projections"] }).notNull(),
  position: text("position", { enum: ["QB", "RB", "WR", "TE", "K", "DEF"] }).notNull(),
  xMetric: text("x_metric").notNull(),
  yMetric: text("y_metric").notNull(),
  window: text("window", { enum: ["season", "rolling17"] }).notNull(),
  showQuadrants: integer("show_quadrants", { mode: "boolean" }).notNull().default(true),
  xPercentile: integer("x_percentile").notNull().default(50),
  yPercentile: integer("y_percentile").notNull().default(50),
  plotLimit: text("plot_limit", { enum: ["24", "40", "all"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("saved_chart_views_dataset_idx").on(table.dataset),
  index("saved_chart_views_owner_idx").on(table.ownerSource, table.ownerKey),
]);

export const playerNewsRuns = sqliteTable("player_news_runs", {
  id: text("id").primaryKey(),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
  itemCount: integer("item_count").notNull(),
});

export const playerNewsItems = sqliteTable("player_news_items", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => playerNewsRuns.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull(),
  player: text("player").notNull(),
  team: text("team").notNull(),
  change: text("change").notNull(),
  leaguesJson: text("leagues_json").notNull(),
  newsType: text("news_type", { enum: ["roster", "waiver", "headline"] }).notNull().default("roster"),
  availabilityJson: text("availability_json"),
  roleContext: text("role_context").notNull(),
  sourceLabel: text("source_label").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourcePublishedAt: integer("source_published_at", { mode: "timestamp_ms" }),
});
