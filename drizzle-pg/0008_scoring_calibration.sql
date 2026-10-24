-- Move-scoring calibration tables (weights + decision-time snapshots).
-- Originally hand-applied like 0002–0007; now journal entry 0008. See MIGRATION-STATUS.md.
-- RLS on with no anon/authenticated policies: server role bypasses RLS;
-- direct client access is blocked.

CREATE TABLE IF NOT EXISTS "scoring_weights" (
  "version" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('candidate', 'active', 'retired')),
  "params_json" text NOT NULL,
  "holdout_json" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "promoted_at" timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scoring_weights_status_idx"
  ON "scoring_weights" ("status");

--> statement-breakpoint
ALTER TABLE "scoring_weights" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scoring_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "season" integer NOT NULL,
  "week" integer NOT NULL,
  "league_id" text NOT NULL,
  "player_id" text NOT NULL,
  "weights_version" text NOT NULL,
  "inputs_json" text NOT NULL,
  "scores_json" text NOT NULL,
  "labels_json" text NOT NULL,
  "rule_applied" text,
  "pick_before" text,
  "pick_after" text,
  "final_points" integer,
  "captured_at" timestamp with time zone NOT NULL,
  "finalized_at" timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scoring_snapshots_season_week_idx"
  ON "scoring_snapshots" ("season", "week");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scoring_snapshots_league_week_idx"
  ON "scoring_snapshots" ("league_id", "season", "week");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scoring_snapshots_player_week_idx"
  ON "scoring_snapshots" ("player_id", "season", "week");

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scoring_snapshots_natural_uidx"
  ON "scoring_snapshots" ("season", "week", "league_id", "player_id");

--> statement-breakpoint
ALTER TABLE "scoring_snapshots" ENABLE ROW LEVEL SECURITY;
