import {
  sqliteTable, text, integer, real, uniqueIndex, index,
} from "drizzle-orm/sqlite-core";

// ── Canonical Assets ────────────────────────────────────────────────────────

export const canonicalAssets = sqliteTable(
  "canonical_assets",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").unique().notNull(),
    symbol: text("symbol").notNull(),
    name: text("name"),
    contractAddress: text("contract_address").unique().notNull(),
    chainId: integer("chain_id").notNull(),
    currentMultiplier: text("current_multiplier"),
    pendingMultiplier: text("pending_multiplier"),
    assetStatus: text("asset_status"),
    tradingCapabilities: text("trading_capabilities", { mode: "json" }),
    isin: text("isin"),
    sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp_ms" }),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
);

// ── Tokens ──────────────────────────────────────────────────────────────────

export const tokens = sqliteTable(
  "tokens",
  {
    address: text("address").primaryKey(),
    symbol: text("symbol"),
    name: text("name"),
    decimals: integer("decimals"),
    tokenType: text("token_type"),
    creatorAddress: text("creator_address"),
    createdBlock: integer("created_block"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    isVerified: integer("is_verified", { mode: "boolean" }),
    isProxy: integer("is_proxy", { mode: "boolean" }),
    implementationAddress: text("implementation_address"),
    canonicalAssetId: text("canonical_asset_id"),
    canonicalStatus: text("canonical_status"), // CANONICAL, NON_CANONICAL, TICKER_COLLISION, UNKNOWN
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("tokens_canonical_status_idx").on(table.canonicalStatus),
    index("tokens_canonical_asset_id_idx").on(table.canonicalAssetId),
  ],
);

// ── Token Transfers ─────────────────────────────────────────────────────────

export const tokenTransfers = sqliteTable(
  "token_transfers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    blockNumber: integer("block_number").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    tokenAddress: text("token_address").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    rawValue: text("raw_value"),
    normalizedValue: real("normalized_value"),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("token_transfers_unique_idx").on(table.txHash, table.logIndex, table.tokenAddress),
    index("token_transfers_token_ts_idx").on(table.tokenAddress, table.timestamp),
  ],
);

// ── Economic Actions ────────────────────────────────────────────────────────

export const economicActions = sqliteTable(
  "economic_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    txHash: text("tx_hash").notNull(),
    actionIndex: integer("action_index").notNull(),
    actionType: text("action_type").notNull(),
    actorAddress: text("actor_address"),
    protocol: text("protocol"),
    inputAsset: text("input_asset"),
    inputAmount: real("input_amount"),
    outputAsset: text("output_asset"),
    outputAmount: real("output_amount"),
    usdValue: real("usd_value"),
    metadata: text("metadata", { mode: "json" }),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("economic_actions_unique_idx").on(table.txHash, table.actionIndex),
    index("economic_actions_actor_ts_idx").on(table.actorAddress, table.timestamp),
    index("economic_actions_type_ts_idx").on(table.actionType, table.timestamp),
  ],
);

// ── Token Metric Snapshots ──────────────────────────────────────────────────

export const tokenMetricSnapshots = sqliteTable(
  "token_metric_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenAddress: text("token_address").notNull(),
    window: text("window").notNull(), // 1h, 6h, 24h, 7d
    holderCount: integer("holder_count"),
    holderDelta: integer("holder_delta"),
    activeHolderDelta: integer("active_holder_delta"),
    uniqueBuyers: integer("unique_buyers"),
    uniqueSellers: integer("unique_sellers"),
    netFlowUsd: real("net_flow_usd"),
    smartMoneyFlowUsd: real("smart_money_flow_usd"),
    liquidityUsd: real("liquidity_usd"),
    depth1pctUsd: real("depth_1pct_usd"),
    volumeUsd: real("volume_usd"),
    top10Share: real("top10_share"),
    sybilRatio: real("sybil_ratio"),
    dataCompleteness: real("data_completeness"),
    calculatedAt: integer("calculated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("token_metrics_unique_idx").on(table.tokenAddress, table.window, table.calculatedAt),
  ],
);

// ── Stock Token Price Snapshots ─────────────────────────────────────────────

export const stockTokenPriceSnapshots = sqliteTable(
  "stock_token_price_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    canonicalAssetId: text("canonical_asset_id").notNull(),
    rawBid: real("raw_bid"),
    rawAsk: real("raw_ask"),
    rawMid: real("raw_mid"),
    multiplier: real("multiplier"),
    adjustedReferencePrice: real("adjusted_reference_price"),
    dexMidPrice: real("dex_mid_price"),
    premiumDiscount: real("premium_discount"),
    referenceTimestamp: integer("reference_timestamp", { mode: "timestamp_ms" }),
    snapshotAt: integer("snapshot_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
);

// ── Wallet Features ─────────────────────────────────────────────────────────

export const walletFeatures = sqliteTable(
  "wallet_features",
  {
    wallet: text("wallet").primaryKey(),
    tradeCount: integer("trade_count"),
    realizedPnlUsd: real("realized_pnl_usd"),
    winRate: real("win_rate"),
    entryLeadScore: real("entry_lead_score"),
    smartMoneyScore: real("smart_money_score"),
    botScore: real("bot_score"),
    sybilScore: real("sybil_score"),
    labels: text("labels", { mode: "json" }),
    calculatedAt: integer("calculated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
);

// ── Signals ─────────────────────────────────────────────────────────────────

export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    signalType: text("signal_type").notNull(),
    rawScore: real("raw_score"),
    riskScore: real("risk_score"),
    adjustedScore: real("adjusted_score"),
    confidence: text("confidence"),
    dataCompleteness: real("data_completeness"),
    evidence: text("evidence", { mode: "json" }),
    invalidators: text("invalidators", { mode: "json" }),
    riskFlags: text("risk_flags", { mode: "json" }),
    windowStart: integer("window_start", { mode: "timestamp_ms" }),
    windowEnd: integer("window_end", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
    status: text("status"),
  },
  (table) => [
    index("signals_type_idx").on(table.signalType),
    index("signals_entity_idx").on(table.entityId, table.createdAt),
    index("signals_created_score_idx").on(table.createdAt, table.adjustedScore),
  ],
);

// ── Source Sync State ───────────────────────────────────────────────────────

export const sourceSyncState = sqliteTable(
  "source_sync_state",
  {
    source: text("source").notNull(),
    jobName: text("job_name").notNull(),
    cursor: text("cursor", { mode: "json" }),
    lastStartedAt: integer("last_started_at", { mode: "timestamp_ms" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
    lastErrorAt: integer("last_error_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    recordsProcessed: integer("records_processed"),
    status: text("status"),
  },
  (table) => [
    uniqueIndex("source_sync_state_pk").on(table.source, table.jobName),
  ],
);

// ── Protocol Registry ───────────────────────────────────────────────────────

export const protocolRegistry = sqliteTable(
  "protocol_registry",
  {
    address: text("address").primaryKey(),
    protocol: text("protocol"),
    role: text("role"), // ROUTER, POOL, BRIDGE, BUNDLER, PAYMASTER, TREASURY, SYSTEM
    chainId: integer("chain_id"),
    source: text("source"),
    verified: integer("verified", { mode: "boolean" }),
    metadata: text("metadata", { mode: "json" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
);
