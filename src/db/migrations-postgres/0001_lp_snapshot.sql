CREATE TABLE IF NOT EXISTS "public"."lp_leaderboard_snapshots" (
	"source_key" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb,
	"block_number" bigint,
	"observed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_ok" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"producer_revision" text
);
