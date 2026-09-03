import { pgTable, varchar, text, integer, bigint, numeric, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

// ── Canonical Assets ────────────────────────────────────────────────────────

export const canonicalAssets = pgTable("canonical_assets", {
  id: varchar("id", { length: 64 }).primaryKey(),
  assetId: varchar("asset_id", { length: 64 }).unique().notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  name: text("name"),
  contractAddress: varchar("contract_address", { length: 42 }).unique().notNull(),
  chainId: integer("chain_id").notNull(),
  currentMultiplier: numeric("current_multiplier", { precision: 36, scale: 18 }),
  pendingMultiplier: numeric("pending_multiplier", { precision: 36, scale: 18 }),
  assetStatus: varchar("asset_status", { length: 32 }),
  tradingCapabilities: jsonb("trading_capabilities"),
  isin: varchar("isin", { length: 32 }),
  sourceUpdatedAt: timestamp("source_updated_at"),
  syncedAt: timestamp("synced_at").defaultNow(),
});

// ── Tokens ──────────────────────────────────────────────────────────────────

export const tokens = pgTable("tokens", {
  address: varchar("address", { length: 42 }).primaryKey(),
  symbol: varchar("symbol", { length: 32 }),
  name: text("name"),
  decimals: integer("decimals"),
  tokenType: varchar("token_type", { length: 32 }),
  creatorAddress: varchar("creator_address", { length: 42 }),
  createdBlock: bigint("created_block", { mode: "number" }),
  createdAt: timestamp("created_at"),
  isVerified: boolean("is_verified"),
  isProxy: boolean("is_proxy"),
  implementationAddress: varchar("implementation_address", { length: 42 }),
  canonicalAssetId: varchar("canonical_asset_id", { length: 64 }),
  canonicalStatus: varchar("canonical_status", { length: 32 }), // CANONICAL, NON_CANONICAL, TICKER_COLLISION, UNKNOWN
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
}, (table) => [
  index("tokens_canonical_status_idx").on(table.canonicalStatus),
  index("tokens_canonical_asset_id_idx").on(table.canonicalAssetId),
]);

// ── Token Transfers ─────────────────────────────────────────────────────────

export const tokenTransfers = pgTable("token_transfers", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(),
  txHash: varchar("tx_hash", { length: 66 }).notNull(),
  logIndex: integer("log_index").notNull(),
  tokenAddress: varchar("token_address", { length: 42 }).notNull(),
  fromAddress: varchar("from_address", { length: 42 }).notNull(),
  toAddress: varchar("to_address", { length: 42 }).notNull(),
  rawValue: varchar("raw_value", { length: 78 }),
  normalizedValue: numeric("normalized_value", { precision: 36, scale: 18 }),
  timestamp: timestamp("timestamp").notNull(),
}, (table) => [
  uniqueIndex("token_transfers_unique_idx").on(table.txHash, table.logIndex, table.tokenAddress),
  index("token_transfers_token_ts_idx").on(table.tokenAddress, table.timestamp),
]);

// ── Economic Actions ────────────────────────────────────────────────────────

export const economicActions = pgTable("economic_actions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  txHash: varchar("tx_hash", { length: 66 }).notNull(),
  actionIndex: integer("action_index").notNull(),
  actionType: varchar("action_type", { length: 32 }).notNull(),
  actorAddress: varchar("actor_address", { length: 42 }),
  protocol: varchar("protocol", { length: 64 }),
  inputAsset: varchar("input_asset", { length: 42 }),
  inputAmount: numeric("input_amount", { precision: 36, scale: 18 }),
  outputAsset: varchar("output_asset", { length: 42 }),
  outputAmount: numeric("output_amount", { precision: 36, scale: 18 }),
  usdValue: numeric("usd_value", { precision: 36, scale: 18 }),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").notNull(),
}, (table) => [
  uniqueIndex("economic_actions_unique_idx").on(table.txHash, table.actionIndex),
  index("economic_actions_actor_ts_idx").on(table.actorAddress, table.timestamp),
  index("economic_actions_type_ts_idx").on(table.actionType, table.timestamp),
]);

// ── Token Metric Snapshots ──────────────────────────────────────────────────

export const tokenMetricSnapshots = pgTable("token_metric_snapshots", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tokenAddress: varchar("token_address", { length: 42 }).notNull(),
  window: varchar("window", { length: 16 }).notNull(), // 1h, 6h, 24h, 7d
  holderCount: integer("holder_count"),
  holderDelta: integer("holder_delta"),
  activeHolderDelta: integer("active_holder_delta"),
  uniqueBuyers: integer("unique_buyers"),
  uniqueSellers: integer("unique_sellers"),
  netFlowUsd: numeric("net_flow_usd", { precision: 36, scale: 18 }),
  smartMoneyFlowUsd: numeric("smart_money_flow_usd", { precision: 36, scale: 18 }),
  liquidityUsd: numeric("liquidity_usd", { precision: 36, scale: 18 }),
  depth1pctUsd: numeric("depth_1pct_usd", { precision: 36, scale: 18 }),
  volumeUsd: numeric("volume_usd", { precision: 36, scale: 18 }),
  top10Share: numeric("top10_share", { precision: 6, scale: 4 }),
  sybilRatio: numeric("sybil_ratio", { precision: 6, scale: 4 }),
  dataCompleteness: numeric("data_completeness", { precision: 5, scale: 4 }),
  calculatedAt: timestamp("calculated_at").defaultNow(),
}, (table) => [
  uniqueIndex("token_metrics_unique_idx").on(table.tokenAddress, table.window, table.calculatedAt),
]);

// ── Stock Token Price Snapshots ─────────────────────────────────────────────

export const stockTokenPriceSnapshots = pgTable("stock_token_price_snapshots", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  canonicalAssetId: varchar("canonical_asset_id", { length: 64 }).notNull(),
  rawBid: numeric("raw_bid", { precision: 36, scale: 18 }),
  rawAsk: numeric("raw_ask", { precision: 36, scale: 18 }),
  rawMid: numeric("raw_mid", { precision: 36, scale: 18 }),
  multiplier: numeric("multiplier", { precision: 36, scale: 18 }),
  adjustedReferencePrice: numeric("adjusted_reference_price", { precision: 36, scale: 18 }),
  dexMidPrice: numeric("dex_mid_price", { precision: 36, scale: 18 }),
  premiumDiscount: numeric("premium_discount", { precision: 10, scale: 6 }),
  referenceTimestamp: timestamp("reference_timestamp"),
  snapshotAt: timestamp("snapshot_at").defaultNow(),
});

// ── Wallet Features ─────────────────────────────────────────────────────────

export const walletFeatures = pgTable("wallet_features", {
  wallet: varchar("wallet", { length: 42 }).primaryKey(),
  tradeCount: integer("trade_count"),
  realizedPnlUsd: numeric("realized_pnl_usd", { precision: 36, scale: 18 }),
  winRate: numeric("win_rate", { precision: 6, scale: 4 }),
  entryLeadScore: numeric("entry_lead_score", { precision: 6, scale: 4 }),
  smartMoneyScore: numeric("smart_money_score", { precision: 6, scale: 4 }),
  botScore: numeric("bot_score", { precision: 6, scale: 4 }),
  sybilScore: numeric("sybil_score", { precision: 6, scale: 4 }),
  labels: jsonb("labels"),
  calculatedAt: timestamp("calculated_at").defaultNow(),
});

// ── Signals ─────────────────────────────────────────────────────────────────

export const signals = pgTable("signals", {
  id: varchar("id", { length: 64 }).primaryKey(),
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: varchar("entity_id", { length: 66 }).notNull(),
  signalType: varchar("signal_type", { length: 64 }).notNull(),
  rawScore: numeric("raw_score", { precision: 6, scale: 2 }),
  riskScore: numeric("risk_score", { precision: 6, scale: 2 }),
  adjustedScore: numeric("adjusted_score", { precision: 6, scale: 2 }),
  confidence: varchar("confidence", { length: 16 }),
  dataCompleteness: numeric("data_completeness", { precision: 5, scale: 4 }),
  evidence: jsonb("evidence"),
  invalidators: jsonb("invalidators"),
  riskFlags: jsonb("risk_flags"),
  windowStart: timestamp("window_start"),
  windowEnd: timestamp("window_end"),
  createdAt: timestamp("created_at").defaultNow(),
  status: varchar("status", { length: 16 }),
}, (table) => [
  index("signals_type_idx").on(table.signalType),
  index("signals_entity_idx").on(table.entityId, table.createdAt),
  index("signals_created_score_idx").on(table.createdAt, table.adjustedScore),
]);

// ── Source Sync State ───────────────────────────────────────────────────────

export const sourceSyncState = pgTable("source_sync_state", {
  source: varchar("source", { length: 32 }).notNull(),
  jobName: varchar("job_name", { length: 64 }).notNull(),
  cursor: jsonb("cursor"),
  lastStartedAt: timestamp("last_started_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastError: text("last_error"),
  recordsProcessed: integer("records_processed"),
  status: varchar("status", { length: 16 }),
}, (table) => ({
  pk: uniqueIndex("source_sync_state_pk").on(table.source, table.jobName),
}));

// ── Protocol Registry ───────────────────────────────────────────────────────

export const protocolRegistry = pgTable("protocol_registry", {
  address: varchar("address", { length: 42 }).primaryKey(),
  protocol: varchar("protocol", { length: 64 }),
  role: varchar("role", { length: 32 }), // ROUTER, POOL, BRIDGE, BUNDLER, PAYMASTER, TREASURY, SYSTEM
  chainId: integer("chain_id"),
  source: varchar("source", { length: 64 }),
  verified: boolean("verified"),
  metadata: jsonb("metadata"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
