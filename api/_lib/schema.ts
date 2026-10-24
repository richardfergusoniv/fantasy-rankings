import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema for Fantasy Rankings.
 *
 * Converted from the SQLite schema (app/server/src/schema.ts).
 * Fresh baseline — the 17 SQLite migrations were not converted 1:1.
 *
 * Timestamp mapping:
 *   SQLite `integer({ mode: "timestamp_ms" })` → Postgres `timestamptz`
 *   Drizzle returns JS `Date` in both cases, so `.getTime()` / `.toISOString()`
 *   call sites in the server code are unaffected.
 *
 * Boolean mapping:
 *   SQLite `integer({ mode: "boolean" })` → Postgres `boolean`
 *
 * Enum mapping:
 *   SQLite `text({ enum: [...] })` → Postgres `text` with CHECK constraint
 *   (drizzle-orm/pg-core supports the `enum` option on text()).
 */

/**
 * Key/value cache for dashboard snapshots and external source payloads.
 * Some rows are multi‑MB JSON text (players dump, full dashboards). Keep
 * reads keyed by `cache_key`. Payloads over ~50 KB are stored as `gz1:` +
 * base64(gzip(JSON)) via `encodeSourceCachePayload` / `decodeSourceCachePayload`;
 * legacy plain JSON still reads. Per-user dashboards also use section keys
 * `dashboard:user:<id>:meta|team|players|league|analytics|trade`.
 */
export const sourceCache = pgTable("source_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const historicalTrades = pgTable(
  "historical_trades",
  {
    id: text("id").primaryKey(),
    rootLeagueId: text("root_league_id").notNull(),
    sleeperLeagueId: text("sleeper_league_id").notNull(),
    season: integer("season").notNull(),
    payload: text("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("historical_trades_root_league_idx").on(table.rootLeagueId),
    index("historical_trades_season_idx").on(table.season),
  ],
);

export const vegasProjectionSnapshots = pgTable(
  "vegas_projection_snapshots",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    builtAt: timestamp("built_at", { withTimezone: true, mode: "date" }).notNull(),
    source: text("source").notNull(),
    payload: text("payload").notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("vegas_projection_snapshots_season_week_idx").on(table.season, table.week),
  ],
);

export const vegasProjectionUploadChunks = pgTable("vegas_projection_upload_chunks", {
  id: text("id").primaryKey(),
  uploadKey: text("upload_key").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  builtAt: timestamp("built_at", { withTimezone: true, mode: "date" }).notNull(),
  source: text("source").notNull(),
  leaguesPayload: text("leagues_payload").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  projectionsPayload: text("projections_payload").notNull(),
  storedAt: timestamp("stored_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const playerValueSnapshots = pgTable(
  "player_value_snapshots",
  {
    id: text("id").primaryKey(),
    snapshotDate: text("snapshot_date").notNull(),
    formatKey: text("format_key").notNull(),
    playerId: text("player_id").notNull(),
    playerName: text("player_name").notNull(),
    position: text("position").notNull(),
    value: integer("value").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("player_value_snapshots_format_player_date_idx").on(
      table.formatKey,
      table.playerId,
      table.snapshotDate.desc(),
    ),
  ],
);

export const projectionAccuracy = pgTable("projection_accuracy", {
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
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const savedChartViews = pgTable(
  "saved_chart_views",
  {
    id: text("id").primaryKey(),
    // Supabase Auth user id. Replaces the Hatch-era owner_source/owner_key
    // columns (dropped in drizzle-pg/0002_chart_views_user_id.sql).
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    dataset: text("dataset", { enum: ["advanced", "projections"] }).notNull(),
    position: text("position", { enum: ["QB", "RB", "WR", "TE", "K", "DEF"] }).notNull(),
    xMetric: text("x_metric").notNull(),
    yMetric: text("y_metric").notNull(),
    window: text("window", { enum: ["season", "rolling17"] }).notNull(),
    showQuadrants: boolean("show_quadrants").notNull().default(true),
    xPercentile: integer("x_percentile").notNull().default(50),
    yPercentile: integer("y_percentile").notNull().default(50),
    plotLimit: text("plot_limit", { enum: ["24", "40", "all"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("saved_chart_views_dataset_idx").on(table.dataset),
    index("saved_chart_views_user_id_idx").on(table.userId),
    uniqueIndex("saved_chart_views_user_dataset_name_uidx").on(
      table.userId,
      table.dataset,
      table.name,
    ),
  ],
);

export const playerNewsRuns = pgTable("player_news_runs", {
  id: text("id").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }).notNull(),
  itemCount: integer("item_count").notNull(),
});

export const playerNewsItems = pgTable(
  "player_news_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => playerNewsRuns.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull(),
    player: text("player").notNull(),
    team: text("team").notNull(),
    change: text("change").notNull(),
    leaguesJson: text("leagues_json").notNull(),
    newsType: text("news_type", { enum: ["roster", "waiver", "headline"] })
      .notNull()
      .default("roster"),
    availabilityJson: text("availability_json"),
    roleContext: text("role_context").notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("player_news_items_run_id_idx").on(table.runId)],
);

/**
 * User-agnostic player news (one row per source URL / post id).
 * Cron + X ingest write here; clients filter by roster for the ticker.
 */
export const sharedPlayerNews = pgTable(
  "shared_player_news",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id").notNull(),
    player: text("player").notNull(),
    team: text("team").notNull(),
    change: text("change").notNull(),
    newsType: text("news_type", { enum: ["roster", "waiver", "headline"] })
      .notNull()
      .default("roster"),
    roleContext: text("role_context").notNull().default(""),
    source: text("source", { enum: ["sleeper", "x", "nflverse"] }).notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceUrl: text("source_url").notNull(),
    author: text("author"),
    externalId: text("external_id"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    signal: text("signal"),
    score: integer("score"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shared_player_news_source_url_uidx").on(table.sourceUrl),
    uniqueIndex("shared_player_news_source_external_uidx").on(table.source, table.externalId),
    index("shared_player_news_player_id_idx").on(table.playerId),
    index("shared_player_news_published_at_idx").on(table.publishedAt),
  ],
);

/**
 * Links a Supabase Auth user to the Sleeper account they follow (one
 * connection per user). Nonexclusive: Sleeper data is public and ownership
 * is unverified, so several users may follow the same Sleeper id.
 */
export const sleeperConnections = pgTable(
  "sleeper_connections",
  {
    userId: uuid("user_id").primaryKey(),
    sleeperUserId: text("sleeper_user_id").notNull(),
    sleeperUsername: text("sleeper_username").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("sleeper_connections_sleeper_user_id_idx").on(table.sleeperUserId),
  ],
);

/**
 * Dated consensus prop-line snapshots (not raw book pulls).
 * Written by POST /api/ingest/prop-line-snapshots after each props pull.
 */
export const propLineSnapshots = pgTable(
  "prop_line_snapshots",
  {
    pulledAt: timestamp("pulled_at", { withTimezone: true, mode: "date" }).notNull(),
    playerId: text("player_id").notNull(),
    stat: text("stat").notNull(),
    line: real("line").notNull(),
    medianOverOdds: real("median_over_odds"),
    medianUnderOdds: real("median_under_odds"),
    bookCount: smallint("book_count").notNull(),
    week: smallint("week").notNull(),
    season: smallint("season").notNull(),
  },
  (table) => [
    primaryKey({
      name: "prop_line_snapshots_pkey",
      columns: [table.pulledAt, table.playerId, table.stat],
    }),
    index("prop_line_snapshots_player_stat_pulled_idx").on(
      table.playerId,
      table.stat,
      table.pulledAt.desc(),
    ),
    index("prop_line_snapshots_season_week_idx").on(table.season, table.week),
  ],
);

/** Tools Chat conversation metadata (titles only in list queries). */
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_conversations_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** Tools Chat messages. Load only when a conversation is opened. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("chat_messages_user_id_idx").on(table.userId),
  ],
);

/** Standing chat preferences (short; injected into the system prompt). */
export const chatPreferences = pgTable(
  "chat_preferences",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    leagueId: text("league_id"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("chat_preferences_user_id_idx").on(table.userId)],
);

/**
 * Versioned move-scoring weights. A few rows a season.
 * status: candidate | active | retired. App reads the one active row.
 */
export const scoringWeights = pgTable(
  "scoring_weights",
  {
    version: text("version").primaryKey(),
    status: text("status", { enum: ["candidate", "active", "retired"] }).notNull(),
    paramsJson: text("params_json").notNull(),
    holdoutJson: text("holdout_json"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    promotedAt: timestamp("promoted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("scoring_weights_status_idx").on(table.status),
  ],
);

/**
 * Decision-time scoring snapshots for weekly calibration.
 * Written once (Saturday / Thursday pre-kickoff); Tuesday fills final_points.
 * Replaces projection_accuracy for calibration going forward.
 */
export const scoringSnapshots = pgTable(
  "scoring_snapshots",
  {
    id: text("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    leagueId: text("league_id").notNull(),
    playerId: text("player_id").notNull(),
    weightsVersion: text("weights_version").notNull(),
    inputsJson: text("inputs_json").notNull(),
    scoresJson: text("scores_json").notNull(),
    labelsJson: text("labels_json").notNull(),
    ruleApplied: text("rule_applied"),
    pickBefore: text("pick_before"),
    pickAfter: text("pick_after"),
    finalPoints: integer("final_points"),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("scoring_snapshots_season_week_idx").on(table.season, table.week),
    index("scoring_snapshots_league_week_idx").on(table.leagueId, table.season, table.week),
    index("scoring_snapshots_player_week_idx").on(table.playerId, table.season, table.week),
    uniqueIndex("scoring_snapshots_natural_uidx").on(
      table.season,
      table.week,
      table.leagueId,
      table.playerId,
    ),
  ],
);

/**
 * Deployment-wide lease for expensive background work (dashboard rebuilds).
 * One row per resource; a live lease (`status = 'running'` and
 * `expires_at > now()`) means exactly one function instance owns the build.
 * Finished rows keep `status`/`last_error` as structured failure state.
 */
export const buildLeases = pgTable("build_leases", {
  resource: text("resource").primaryKey(),
  holder: text("holder").notNull(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
  lastError: text("last_error"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Shared fixed-window rate-limit counters. Replaces per-process counters so
 * limits hold across serverless instances. Rows age out with their window.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    subject: text("subject").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.subject, table.windowStart] })],
);
