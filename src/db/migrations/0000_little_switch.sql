CREATE TABLE `canonical_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`contract_address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`current_multiplier` text,
	`pending_multiplier` text,
	`asset_status` text,
	`trading_capabilities` text,
	`isin` text,
	`source_updated_at` integer,
	`synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_assets_asset_id_unique` ON `canonical_assets` (`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_assets_contract_address_unique` ON `canonical_assets` (`contract_address`);--> statement-breakpoint
CREATE TABLE `economic_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tx_hash` text NOT NULL,
	`action_index` integer NOT NULL,
	`action_type` text NOT NULL,
	`actor_address` text,
	`protocol` text,
	`input_asset` text,
	`input_amount` real,
	`output_asset` text,
	`output_amount` real,
	`usd_value` real,
	`metadata` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economic_actions_unique_idx` ON `economic_actions` (`tx_hash`,`action_index`);--> statement-breakpoint
CREATE INDEX `economic_actions_actor_ts_idx` ON `economic_actions` (`actor_address`,`timestamp`);--> statement-breakpoint
CREATE INDEX `economic_actions_type_ts_idx` ON `economic_actions` (`action_type`,`timestamp`);--> statement-breakpoint
CREATE TABLE `protocol_registry` (
	`address` text PRIMARY KEY NOT NULL,
	`protocol` text,
	`role` text,
	`chain_id` integer,
	`source` text,
	`verified` integer,
	`metadata` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`signal_type` text NOT NULL,
	`raw_score` real,
	`risk_score` real,
	`adjusted_score` real,
	`confidence` text,
	`data_completeness` real,
	`evidence` text,
	`invalidators` text,
	`risk_flags` text,
	`window_start` integer,
	`window_end` integer,
	`created_at` integer,
	`status` text
);
--> statement-breakpoint
CREATE INDEX `signals_type_idx` ON `signals` (`signal_type`);--> statement-breakpoint
CREATE INDEX `signals_entity_idx` ON `signals` (`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `signals_created_score_idx` ON `signals` (`created_at`,`adjusted_score`);--> statement-breakpoint
CREATE TABLE `source_sync_state` (
	`source` text NOT NULL,
	`job_name` text NOT NULL,
	`cursor` text,
	`last_started_at` integer,
	`last_success_at` integer,
	`last_error_at` integer,
	`last_error` text,
	`records_processed` integer,
	`status` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_sync_state_pk` ON `source_sync_state` (`source`,`job_name`);--> statement-breakpoint
CREATE TABLE `stock_token_price_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_asset_id` text NOT NULL,
	`raw_bid` real,
	`raw_ask` real,
	`raw_mid` real,
	`multiplier` real,
	`adjusted_reference_price` real,
	`dex_mid_price` real,
	`premium_discount` real,
	`reference_timestamp` integer,
	`snapshot_at` integer
);
--> statement-breakpoint
CREATE TABLE `token_metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_address` text NOT NULL,
	`window` text NOT NULL,
	`holder_count` integer,
	`holder_delta` integer,
	`active_holder_delta` integer,
	`unique_buyers` integer,
	`unique_sellers` integer,
	`net_flow_usd` real,
	`smart_money_flow_usd` real,
	`liquidity_usd` real,
	`depth_1pct_usd` real,
	`volume_usd` real,
	`top10_share` real,
	`sybil_ratio` real,
	`data_completeness` real,
	`calculated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_metrics_unique_idx` ON `token_metric_snapshots` (`token_address`,`window`,`calculated_at`);--> statement-breakpoint
CREATE TABLE `token_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`block_number` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`token_address` text NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`raw_value` text,
	`normalized_value` real,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_transfers_unique_idx` ON `token_transfers` (`tx_hash`,`log_index`,`token_address`);--> statement-breakpoint
CREATE INDEX `token_transfers_token_ts_idx` ON `token_transfers` (`token_address`,`timestamp`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`address` text PRIMARY KEY NOT NULL,
	`symbol` text,
	`name` text,
	`decimals` integer,
	`token_type` text,
	`creator_address` text,
	`created_block` integer,
	`created_at` integer,
	`is_verified` integer,
	`is_proxy` integer,
	`implementation_address` text,
	`canonical_asset_id` text,
	`canonical_status` text,
	`first_seen_at` integer,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE INDEX `tokens_canonical_status_idx` ON `tokens` (`canonical_status`);--> statement-breakpoint
CREATE INDEX `tokens_canonical_asset_id_idx` ON `tokens` (`canonical_asset_id`);--> statement-breakpoint
CREATE TABLE `wallet_features` (
	`wallet` text PRIMARY KEY NOT NULL,
	`trade_count` integer,
	`realized_pnl_usd` real,
	`win_rate` real,
	`entry_lead_score` real,
	`smart_money_score` real,
	`bot_score` real,
	`sybil_score` real,
	`labels` text,
	`calculated_at` integer
);
