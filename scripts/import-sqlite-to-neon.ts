#!/usr/bin/env tsx
/**
 * One-time, idempotent data copy from the legacy local SQLite database to Neon.
 *
 * Usage:
 *   DATABASE_URL="postgresql://...-pooler..." pnpm db:import-sqlite -- data/robin.db
 *
 * Run `pnpm db:migrate` first. Existing primary/unique keys are preserved and
 * conflicts are skipped, so an interrupted import can be run again safely.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  canonicalAssets,
  economicActions,
  protocolRegistry,
  signals,
  sourceSyncState,
  stockTokenPriceSnapshots,
  tokenMetricSnapshots,
  tokenTransfers,
  tokens,
  walletFeatures,
} from "@/db/schema";

type LegacyRow = Record<string, unknown>;

const BATCH_SIZE = 100;
const sourcePath = path.resolve(
  process.argv[2] ?? process.env.SQLITE_SOURCE_PATH ?? "data/robin.db",
);

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function requiredString(value: unknown, field: string): string {
  if (value == null || String(value) === "") throw new Error(`Missing ${field}`);
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${String(value)}`);
  return parsed;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = nullableNumber(value);
  if (parsed == null) throw new Error(`Missing ${field}`);
  return parsed;
}

function nullableBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  return Boolean(Number(value));
}

function nullableDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid timestamp: ${String(value)}`);
  return parsed;
}

function requiredDate(value: unknown, field: string): Date {
  const parsed = nullableDate(value);
  if (!parsed) throw new Error(`Missing ${field}`);
  return parsed;
}

function nullableJson(value: unknown): unknown {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Legacy SQLite contains malformed JSON");
  }
}

function readRows(source: Database.Database, table: string): LegacyRow[] {
  const exists = source
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) throw new Error(`Legacy table is missing: ${table}`);
  return source.prepare(`SELECT * FROM "${table}"`).all() as LegacyRow[];
}

function batches<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    result.push(rows.slice(i, i + BATCH_SIZE));
  }
  return result;
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite source file not found: ${sourcePath}`);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required and must point to the Neon Postgres database.");
  }

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const db = getDb();
  const sourceCounts: Record<string, number> = {};

  try {
    // Pin all table reads to one consistent SQLite snapshot even if the legacy
    // scheduler is still running. Operationally, pausing it is still preferred.
    source.exec("BEGIN");
    const canonicalRows = readRows(source, "canonical_assets").map((r) => ({
      id: requiredString(r.id, "canonical_assets.id"),
      assetId: requiredString(r.asset_id, "canonical_assets.asset_id"),
      symbol: requiredString(r.symbol, "canonical_assets.symbol"),
      name: nullableString(r.name),
      contractAddress: requiredString(r.contract_address, "canonical_assets.contract_address"),
      chainId: requiredNumber(r.chain_id, "canonical_assets.chain_id"),
      currentMultiplier: nullableString(r.current_multiplier),
      pendingMultiplier: nullableString(r.pending_multiplier),
      assetStatus: nullableString(r.asset_status),
      tradingCapabilities: nullableJson(r.trading_capabilities),
      isin: nullableString(r.isin),
      sourceUpdatedAt: nullableDate(r.source_updated_at),
      syncedAt: nullableDate(r.synced_at) ?? new Date(),
    }));
    sourceCounts.canonical_assets = canonicalRows.length;
    for (const batch of batches(canonicalRows)) {
      await db.insert(canonicalAssets).values(batch).onConflictDoNothing();
    }

    const tokenRows = readRows(source, "tokens").map((r) => ({
      address: requiredString(r.address, "tokens.address"),
      symbol: nullableString(r.symbol),
      name: nullableString(r.name),
      decimals: nullableNumber(r.decimals),
      tokenType: nullableString(r.token_type),
      creatorAddress: nullableString(r.creator_address),
      createdBlock: nullableNumber(r.created_block),
      createdAt: nullableDate(r.created_at),
      isVerified: nullableBoolean(r.is_verified),
      isProxy: nullableBoolean(r.is_proxy),
      implementationAddress: nullableString(r.implementation_address),
      canonicalAssetId: nullableString(r.canonical_asset_id),
      canonicalStatus: nullableString(r.canonical_status),
      firstSeenAt: nullableDate(r.first_seen_at) ?? new Date(),
      lastSeenAt: nullableDate(r.last_seen_at) ?? new Date(),
    }));
    sourceCounts.tokens = tokenRows.length;
    for (const batch of batches(tokenRows)) {
      await db.insert(tokens).values(batch).onConflictDoNothing();
    }

    const transferRows = readRows(source, "token_transfers").map((r) => ({
      id: requiredNumber(r.id, "token_transfers.id"),
      blockNumber: requiredNumber(r.block_number, "token_transfers.block_number"),
      txHash: requiredString(r.tx_hash, "token_transfers.tx_hash"),
      logIndex: requiredNumber(r.log_index, "token_transfers.log_index"),
      tokenAddress: requiredString(r.token_address, "token_transfers.token_address"),
      fromAddress: requiredString(r.from_address, "token_transfers.from_address"),
      toAddress: requiredString(r.to_address, "token_transfers.to_address"),
      rawValue: nullableString(r.raw_value),
      normalizedValue: nullableNumber(r.normalized_value),
      timestamp: requiredDate(r.timestamp, "token_transfers.timestamp"),
    }));
    sourceCounts.token_transfers = transferRows.length;
    for (const batch of batches(transferRows)) {
      await db.insert(tokenTransfers).values(batch).onConflictDoNothing();
    }

    const actionRows = readRows(source, "economic_actions").map((r) => ({
      id: requiredNumber(r.id, "economic_actions.id"),
      txHash: requiredString(r.tx_hash, "economic_actions.tx_hash"),
      actionIndex: requiredNumber(r.action_index, "economic_actions.action_index"),
      actionType: requiredString(r.action_type, "economic_actions.action_type"),
      actorAddress: nullableString(r.actor_address),
      protocol: nullableString(r.protocol),
      inputAsset: nullableString(r.input_asset),
      inputAmount: nullableNumber(r.input_amount),
      outputAsset: nullableString(r.output_asset),
      outputAmount: nullableNumber(r.output_amount),
      usdValue: nullableNumber(r.usd_value),
      metadata: nullableJson(r.metadata),
      timestamp: requiredDate(r.timestamp, "economic_actions.timestamp"),
    }));
    sourceCounts.economic_actions = actionRows.length;
    for (const batch of batches(actionRows)) {
      await db.insert(economicActions).values(batch).onConflictDoNothing();
    }

    const metricRows = readRows(source, "token_metric_snapshots").map((r) => ({
      id: requiredNumber(r.id, "token_metric_snapshots.id"),
      tokenAddress: requiredString(r.token_address, "token_metric_snapshots.token_address"),
      window: requiredString(r.window, "token_metric_snapshots.window"),
      holderCount: nullableNumber(r.holder_count),
      holderDelta: nullableNumber(r.holder_delta),
      activeHolderDelta: nullableNumber(r.active_holder_delta),
      uniqueBuyers: nullableNumber(r.unique_buyers),
      uniqueSellers: nullableNumber(r.unique_sellers),
      netFlowUsd: nullableNumber(r.net_flow_usd),
      smartMoneyFlowUsd: nullableNumber(r.smart_money_flow_usd),
      liquidityUsd: nullableNumber(r.liquidity_usd),
      depth1pctUsd: nullableNumber(r.depth_1pct_usd),
      volumeUsd: nullableNumber(r.volume_usd),
      top10Share: nullableNumber(r.top10_share),
      sybilRatio: nullableNumber(r.sybil_ratio),
      dataCompleteness: nullableNumber(r.data_completeness),
      calculatedAt: nullableDate(r.calculated_at) ?? new Date(),
    }));
    sourceCounts.token_metric_snapshots = metricRows.length;
    for (const batch of batches(metricRows)) {
      await db.insert(tokenMetricSnapshots).values(batch).onConflictDoNothing();
    }

    const priceRows = readRows(source, "stock_token_price_snapshots").map((r) => ({
      id: requiredNumber(r.id, "stock_token_price_snapshots.id"),
      canonicalAssetId: requiredString(r.canonical_asset_id, "stock_token_price_snapshots.canonical_asset_id"),
      rawBid: nullableNumber(r.raw_bid),
      rawAsk: nullableNumber(r.raw_ask),
      rawMid: nullableNumber(r.raw_mid),
      multiplier: nullableNumber(r.multiplier),
      adjustedReferencePrice: nullableNumber(r.adjusted_reference_price),
      dexMidPrice: nullableNumber(r.dex_mid_price),
      premiumDiscount: nullableNumber(r.premium_discount),
      referenceTimestamp: nullableDate(r.reference_timestamp),
      snapshotAt: nullableDate(r.snapshot_at) ?? new Date(),
    }));
    sourceCounts.stock_token_price_snapshots = priceRows.length;
    for (const batch of batches(priceRows)) {
      await db.insert(stockTokenPriceSnapshots).values(batch).onConflictDoNothing();
    }

    const walletRows = readRows(source, "wallet_features").map((r) => ({
      wallet: requiredString(r.wallet, "wallet_features.wallet"),
      tradeCount: nullableNumber(r.trade_count),
      realizedPnlUsd: nullableNumber(r.realized_pnl_usd),
      winRate: nullableNumber(r.win_rate),
      entryLeadScore: nullableNumber(r.entry_lead_score),
      smartMoneyScore: nullableNumber(r.smart_money_score),
      botScore: nullableNumber(r.bot_score),
      sybilScore: nullableNumber(r.sybil_score),
      labels: nullableJson(r.labels),
      calculatedAt: nullableDate(r.calculated_at) ?? new Date(),
    }));
    sourceCounts.wallet_features = walletRows.length;
    for (const batch of batches(walletRows)) {
      await db.insert(walletFeatures).values(batch).onConflictDoNothing();
    }

    const signalRows = readRows(source, "signals").map((r) => ({
      id: requiredString(r.id, "signals.id"),
      entityType: requiredString(r.entity_type, "signals.entity_type"),
      entityId: requiredString(r.entity_id, "signals.entity_id"),
      signalType: requiredString(r.signal_type, "signals.signal_type"),
      rawScore: nullableNumber(r.raw_score),
      riskScore: nullableNumber(r.risk_score),
      adjustedScore: nullableNumber(r.adjusted_score),
      confidence: nullableString(r.confidence),
      dataCompleteness: nullableNumber(r.data_completeness),
      evidence: nullableJson(r.evidence),
      invalidators: nullableJson(r.invalidators),
      riskFlags: nullableJson(r.risk_flags),
      windowStart: nullableDate(r.window_start),
      windowEnd: nullableDate(r.window_end),
      createdAt: nullableDate(r.created_at) ?? new Date(),
      status: nullableString(r.status),
    }));
    sourceCounts.signals = signalRows.length;
    for (const batch of batches(signalRows)) {
      await db.insert(signals).values(batch).onConflictDoNothing();
    }

    const syncRows = readRows(source, "source_sync_state").map((r) => ({
      source: requiredString(r.source, "source_sync_state.source"),
      jobName: requiredString(r.job_name, "source_sync_state.job_name"),
      cursor: nullableJson(r.cursor),
      lastStartedAt: nullableDate(r.last_started_at),
      lastSuccessAt: nullableDate(r.last_success_at),
      lastErrorAt: nullableDate(r.last_error_at),
      lastError: nullableString(r.last_error),
      recordsProcessed: nullableNumber(r.records_processed),
      status: nullableString(r.status),
    }));
    sourceCounts.source_sync_state = syncRows.length;
    for (const batch of batches(syncRows)) {
      await db.insert(sourceSyncState).values(batch).onConflictDoNothing();
    }

    const protocolRows = readRows(source, "protocol_registry").map((r) => ({
      address: requiredString(r.address, "protocol_registry.address"),
      protocol: nullableString(r.protocol),
      role: nullableString(r.role),
      chainId: nullableNumber(r.chain_id),
      source: nullableString(r.source),
      verified: nullableBoolean(r.verified),
      metadata: nullableJson(r.metadata),
      updatedAt: nullableDate(r.updated_at) ?? new Date(),
    }));
    sourceCounts.protocol_registry = protocolRows.length;
    for (const batch of batches(protocolRows)) {
      await db.insert(protocolRegistry).values(batch).onConflictDoNothing();
    }

    for (const table of [
      "token_transfers",
      "economic_actions",
      "token_metric_snapshots",
      "stock_token_price_snapshots",
    ]) {
      await db.execute(sql.raw(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`,
      ));
    }

    const targetCounts: Record<string, number> = {
      canonical_assets: Number((await db.select({ count: sql<number>`count(*)` }).from(canonicalAssets))[0]?.count ?? 0),
      tokens: Number((await db.select({ count: sql<number>`count(*)` }).from(tokens))[0]?.count ?? 0),
      token_transfers: Number((await db.select({ count: sql<number>`count(*)` }).from(tokenTransfers))[0]?.count ?? 0),
      economic_actions: Number((await db.select({ count: sql<number>`count(*)` }).from(economicActions))[0]?.count ?? 0),
      token_metric_snapshots: Number((await db.select({ count: sql<number>`count(*)` }).from(tokenMetricSnapshots))[0]?.count ?? 0),
      stock_token_price_snapshots: Number((await db.select({ count: sql<number>`count(*)` }).from(stockTokenPriceSnapshots))[0]?.count ?? 0),
      wallet_features: Number((await db.select({ count: sql<number>`count(*)` }).from(walletFeatures))[0]?.count ?? 0),
      signals: Number((await db.select({ count: sql<number>`count(*)` }).from(signals))[0]?.count ?? 0),
      source_sync_state: Number((await db.select({ count: sql<number>`count(*)` }).from(sourceSyncState))[0]?.count ?? 0),
      protocol_registry: Number((await db.select({ count: sql<number>`count(*)` }).from(protocolRegistry))[0]?.count ?? 0),
    };

    for (const [table, sourceCount] of Object.entries(sourceCounts)) {
      if ((targetCounts[table] ?? 0) !== sourceCount) {
        throw new Error(
          `Verification failed for ${table}: source=${sourceCount}, target=${targetCounts[table] ?? 0}`,
        );
      }
    }

    console.log("SQLite → Neon import completed and row-count verification passed.");
    for (const [table, sourceCount] of Object.entries(sourceCounts)) {
      console.log(`  ${table}: source=${sourceCount}, target=${targetCounts[table]}`);
    }
  } finally {
    if (source.inTransaction) source.exec("ROLLBACK");
    source.close();
  }
}

main().catch((error) => {
  console.error("SQLite → Neon import failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
