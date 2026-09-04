CREATE TABLE "canonical_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"contract_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"current_multiplier" text,
	"pending_multiplier" text,
	"asset_status" text,
	"trading_capabilities" jsonb,
	"isin" text,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_assets_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "canonical_assets_contract_address_unique" UNIQUE("contract_address")
);
--> statement-breakpoint
CREATE TABLE "economic_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"action_index" integer NOT NULL,
	"action_type" text NOT NULL,
	"actor_address" text,
	"protocol" text,
	"input_asset" text,
	"input_amount" double precision,
	"output_asset" text,
	"output_amount" double precision,
	"usd_value" double precision,
	"metadata" jsonb,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_registry" (
	"address" text PRIMARY KEY NOT NULL,
	"protocol" text,
	"role" text,
	"chain_id" integer,
	"source" text,
	"verified" boolean,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"signal_type" text NOT NULL,
	"raw_score" double precision,
	"risk_score" double precision,
	"adjusted_score" double precision,
	"confidence" text,
	"data_completeness" double precision,
	"evidence" jsonb,
	"invalidators" jsonb,
	"risk_flags" jsonb,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "source_sync_state" (
	"source" text NOT NULL,
	"job_name" text NOT NULL,
	"cursor" jsonb,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"records_processed" integer,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "stock_token_price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_asset_id" text NOT NULL,
	"raw_bid" double precision,
	"raw_ask" double precision,
	"raw_mid" double precision,
	"multiplier" double precision,
	"adjusted_reference_price" double precision,
	"dex_mid_price" double precision,
	"premium_discount" double precision,
	"reference_timestamp" timestamp with time zone,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_metric_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_address" text NOT NULL,
	"window" text NOT NULL,
	"holder_count" integer,
	"holder_delta" integer,
	"active_holder_delta" integer,
	"unique_buyers" integer,
	"unique_sellers" integer,
	"net_flow_usd" double precision,
	"smart_money_flow_usd" double precision,
	"liquidity_usd" double precision,
	"depth_1pct_usd" double precision,
	"volume_usd" double precision,
	"top10_share" double precision,
	"sybil_ratio" double precision,
	"data_completeness" double precision,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_number" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"token_address" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"raw_value" text,
	"normalized_value" double precision,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"address" text PRIMARY KEY NOT NULL,
	"symbol" text,
	"name" text,
	"decimals" integer,
	"token_type" text,
	"creator_address" text,
	"created_block" integer,
	"created_at" timestamp with time zone,
	"is_verified" boolean,
	"is_proxy" boolean,
	"implementation_address" text,
	"canonical_asset_id" text,
	"canonical_status" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_features" (
	"wallet" text PRIMARY KEY NOT NULL,
	"trade_count" integer,
	"realized_pnl_usd" double precision,
	"win_rate" double precision,
	"entry_lead_score" double precision,
	"smart_money_score" double precision,
	"bot_score" double precision,
	"sybil_score" double precision,
	"labels" jsonb,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "economic_actions_unique_idx" ON "economic_actions" USING btree ("tx_hash","action_index");--> statement-breakpoint
CREATE INDEX "economic_actions_actor_ts_idx" ON "economic_actions" USING btree ("actor_address","timestamp");--> statement-breakpoint
CREATE INDEX "economic_actions_type_ts_idx" ON "economic_actions" USING btree ("action_type","timestamp");--> statement-breakpoint
CREATE INDEX "signals_type_idx" ON "signals" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX "signals_entity_idx" ON "signals" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_created_score_idx" ON "signals" USING btree ("created_at","adjusted_score");--> statement-breakpoint
CREATE UNIQUE INDEX "source_sync_state_pk" ON "source_sync_state" USING btree ("source","job_name");--> statement-breakpoint
CREATE UNIQUE INDEX "token_metrics_unique_idx" ON "token_metric_snapshots" USING btree ("token_address","window","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "token_transfers_unique_idx" ON "token_transfers" USING btree ("tx_hash","log_index","token_address");--> statement-breakpoint
CREATE INDEX "token_transfers_token_ts_idx" ON "token_transfers" USING btree ("token_address","timestamp");--> statement-breakpoint
CREATE INDEX "tokens_canonical_status_idx" ON "tokens" USING btree ("canonical_status");--> statement-breakpoint
CREATE INDEX "tokens_canonical_asset_id_idx" ON "tokens" USING btree ("canonical_asset_id");