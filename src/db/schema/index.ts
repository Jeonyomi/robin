import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

// ── Canonical Assets ────────────────────────────────────────────────────────

export const canonicalAssets = pgTable("canonical_assets", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").unique().notNull(),
  symbol: text("symbol").notNull(),
  name: text("name"),
  contractAddress: text("contract_address").unique().notNull(),
  chainId: integer("chain_id").notNull(),
  currentMultiplier: text("current_multiplier"),
  pendingMultiplier: text("pending_multiplier"),
  assetStatus: text("asset_status"),
  tradingCapabilities: jsonb("trading_capabilities").$type<unknown>(),
  isin: text("isin"),
  sourceUpdatedAt: timestamptz("source_updated_at"),
  syncedAt: timestamptz("synced_at").notNull().defaultNow(),
});

// ── Tokens ──────────────────────────────────────────────────────────────────

export const tokens = pgTable(
  "tokens",
  {
    address: text("address").primaryKey(),
    symbol: text("symbol"),
    name: text("name"),
    decimals: integer("decimals"),
    tokenType: text("token_type"),
    creatorAddress: text("creator_address"),
    createdBlock: integer("created_block"),
    createdAt: timestamptz("created_at"),
    isVerified: boolean("is_verified"),
    isProxy: boolean("is_proxy"),
    implementationAddress: text("implementation_address"),
    canonicalAssetId: text("canonical_asset_id"),
    canonicalStatus: text("canonical_status"), // CANONICAL, NON_CANONICAL, TICKER_COLLISION, UNKNOWN
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
  },
  (table) => [
    index("tokens_canonical_status_idx").on(table.canonicalStatus),
    index("tokens_canonical_asset_id_idx").on(table.canonicalAssetId),
  ],
);

// ── Token Transfers ─────────────────────────────────────────────────────────

export const tokenTransfers = pgTable(
  "token_transfers",
  {
    id: serial("id").primaryKey(),
    blockNumber: integer("block_number").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    tokenAddress: text("token_address").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    rawValue: text("raw_value"),
    normalizedValue: doublePrecision("normalized_value"),
    timestamp: timestamptz("timestamp").notNull(),
  },
  (table) => [
    uniqueIndex("token_transfers_unique_idx").on(table.txHash, table.logIndex, table.tokenAddress),
    index("token_transfers_token_ts_idx").on(table.tokenAddress, table.timestamp),
  ],
);

// ── Economic Actions ────────────────────────────────────────────────────────

export const economicActions = pgTable(
  "economic_actions",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull(),
    actionIndex: integer("action_index").notNull(),
    actionType: text("action_type").notNull(),
    actorAddress: text("actor_address"),
    protocol: text("protocol"),
    inputAsset: text("input_asset"),
    inputAmount: doublePrecision("input_amount"),
    outputAsset: text("output_asset"),
    outputAmount: doublePrecision("output_amount"),
    usdValue: doublePrecision("usd_value"),
    metadata: jsonb("metadata").$type<unknown>(),
    timestamp: timestamptz("timestamp").notNull(),
  },
  (table) => [
    uniqueIndex("economic_actions_unique_idx").on(table.txHash, table.actionIndex),
    index("economic_actions_actor_ts_idx").on(table.actorAddress, table.timestamp),
    index("economic_actions_type_ts_idx").on(table.actionType, table.timestamp),
  ],
);

// ── Token Metric Snapshots ──────────────────────────────────────────────────

export const tokenMetricSnapshots = pgTable(
  "token_metric_snapshots",
  {
    id: serial("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    window: text("window").notNull(), // 1h, 6h, 24h, 7d
    holderCount: integer("holder_count"),
    holderDelta: integer("holder_delta"),
    activeHolderDelta: integer("active_holder_delta"),
    uniqueBuyers: integer("unique_buyers"),
    uniqueSellers: integer("unique_sellers"),
    netFlowUsd: doublePrecision("net_flow_usd"),
    smartMoneyFlowUsd: doublePrecision("smart_money_flow_usd"),
    liquidityUsd: doublePrecision("liquidity_usd"),
    depth1pctUsd: doublePrecision("depth_1pct_usd"),
    volumeUsd: doublePrecision("volume_usd"),
    top10Share: doublePrecision("top10_share"),
    sybilRatio: doublePrecision("sybil_ratio"),
    dataCompleteness: doublePrecision("data_completeness"),
    calculatedAt: timestamptz("calculated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("token_metrics_unique_idx").on(table.tokenAddress, table.window, table.calculatedAt),
  ],
);

// ── Stock Token Price Snapshots ─────────────────────────────────────────────

export const stockTokenPriceSnapshots = pgTable("stock_token_price_snapshots", {
  id: serial("id").primaryKey(),
  canonicalAssetId: text("canonical_asset_id").notNull(),
  rawBid: doublePrecision("raw_bid"),
  rawAsk: doublePrecision("raw_ask"),
  rawMid: doublePrecision("raw_mid"),
  multiplier: doublePrecision("multiplier"),
  adjustedReferencePrice: doublePrecision("adjusted_reference_price"),
  dexMidPrice: doublePrecision("dex_mid_price"),
  premiumDiscount: doublePrecision("premium_discount"),
  referenceTimestamp: timestamptz("reference_timestamp"),
  snapshotAt: timestamptz("snapshot_at").notNull().defaultNow(),
});

// ── Wallet Features ─────────────────────────────────────────────────────────

export const walletFeatures = pgTable("wallet_features", {
  wallet: text("wallet").primaryKey(),
  tradeCount: integer("trade_count"),
  realizedPnlUsd: doublePrecision("realized_pnl_usd"),
  winRate: doublePrecision("win_rate"),
  entryLeadScore: doublePrecision("entry_lead_score"),
  smartMoneyScore: doublePrecision("smart_money_score"),
  botScore: doublePrecision("bot_score"),
  sybilScore: doublePrecision("sybil_score"),
  labels: jsonb("labels").$type<unknown>(),
  calculatedAt: timestamptz("calculated_at").notNull().defaultNow(),
});

// ── Signals ─────────────────────────────────────────────────────────────────

export const signals = pgTable(
  "signals",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    signalType: text("signal_type").notNull(),
    rawScore: doublePrecision("raw_score"),
    riskScore: doublePrecision("risk_score"),
    adjustedScore: doublePrecision("adjusted_score"),
    confidence: text("confidence"),
    dataCompleteness: doublePrecision("data_completeness"),
    evidence: jsonb("evidence").$type<unknown>(),
    invalidators: jsonb("invalidators").$type<unknown>(),
    riskFlags: jsonb("risk_flags").$type<unknown>(),
    windowStart: timestamptz("window_start"),
    windowEnd: timestamptz("window_end"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    status: text("status"),
  },
  (table) => [
    index("signals_type_idx").on(table.signalType),
    index("signals_entity_idx").on(table.entityId, table.createdAt),
    index("signals_created_score_idx").on(table.createdAt, table.adjustedScore),
  ],
);

// ── Source Sync State ───────────────────────────────────────────────────────

export const sourceSyncState = pgTable(
  "source_sync_state",
  {
    source: text("source").notNull(),
    jobName: text("job_name").notNull(),
    cursor: jsonb("cursor").$type<unknown>(),
    lastStartedAt: timestamptz("last_started_at"),
    lastSuccessAt: timestamptz("last_success_at"),
    lastErrorAt: timestamptz("last_error_at"),
    lastError: text("last_error"),
    recordsProcessed: integer("records_processed"),
    status: text("status"),
  },
  (table) => [
    uniqueIndex("source_sync_state_pk").on(table.source, table.jobName),
  ],
);

// ── Protocol Registry ───────────────────────────────────────────────────────

export const protocolRegistry = pgTable("protocol_registry", {
  address: text("address").primaryKey(),
  protocol: text("protocol"),
  role: text("role"), // ROUTER, POOL, BRIDGE, BUNDLER, PAYMASTER, TREASURY, SYSTEM
  chainId: integer("chain_id"),
  source: text("source"),
  verified: boolean("verified"),
  metadata: jsonb("metadata").$type<unknown>(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});
