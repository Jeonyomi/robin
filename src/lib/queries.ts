/**
 * Shared read queries — single source of truth for how Neon Postgres is
 * turned into API payloads. Used by:
 *  1. API route handlers (when Neon is configured)
 *  2. scripts/build-snapshot.ts (to bake the same payloads into data/snapshot.json)
 *     so deployments can serve the same shapes from Blob as a fallback.
 */
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  buildActivityEvidence,
  calculateActivityIndex,
  calculateMomentum,
  classifyTransfer,
} from "@/lib/domain/activity";
import {
  tokens,
  canonicalAssets,
  tokenMetricSnapshots,
  signals,
  sourceSyncState,
  tokenTransfers,
} from "@/db/schema";

export type Db = ReturnType<typeof getDb>;

export const WINDOWS = ["1h", "6h", "24h", "7d"] as const;
export type Window = (typeof WINDOWS)[number];

function windowHours(window: string): number {
  return window === "1h" ? 1 : window === "6h" ? 6 : window === "24h" ? 24 : 168;
}

function toIso(v: Date | string | number | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? v : parsed.toISOString();
}

// ── Observed on-chain activity ──────────────────────────────────────────────

export interface OverviewTimelinePoint {
  timestamp: string;
  transfers: number;
  activeAddresses: number;
  mints: number;
  burns: number;
}

export interface ActivityTokenRow {
  address: string;
  symbol: string | null;
  name: string | null;
  transferCount: number;
  previousTransferCount: number;
  activeAddresses: number;
  momentumPct: number | null;
  holderCount: number | null;
  holderDelta: number | null;
  latestBlock: number;
  lastTransferAt: string;
  activityIndex: number;
  evidence: string[];
}

export interface RecentTransferRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  tokenAddress: string;
  symbol: string | null;
  fromAddress: string;
  toAddress: string;
  normalizedValue: number | null;
  kind: "mint" | "burn" | "transfer";
  timestamp: string;
}

export interface ChainStatsData {
  totalBlocks: number;
  totalTransactions: number;
  totalAddresses: number;
  averageBlockTimeMs: number | null;
  networkUtilizationPct: number | null;
  gasPricesGwei: { slow: number | null; average: number | null; fast: number | null } | null;
  observedAt: string;
}

export interface OverviewData {
  window: string;
  chain: ChainStatsData | null;
  activity: {
    transferEvents: number;
    activeAddresses: number;
    activeTokens: number;
    mintEvents: number;
    burnEvents: number;
    latestBlock: number | null;
    lastObservedAt: string | null;
  };
  coverage: {
    trackedTokens: number;
    tokensWithStoredTransfers: number;
    scannedInCycle: number;
    completedCycles: number;
    cycleProgressPct: number;
    lastBatchSize: number;
    lookbackHours: number;
    status: string;
    lastIndexedAt: string | null;
  };
  timeline: OverviewTimelinePoint[];
  topTokens: ActivityTokenRow[];
  recentTransfers: RecentTransferRow[];
  dataQuality: {
    scope: string;
    completeness: "partial" | "cycle-complete";
    syntheticExcluded: true;
    note: string;
  };
  lastUpdatedAt: string;
}

type AggregateRow = {
  transfer_count: number | string;
  active_tokens: number | string;
  active_addresses: number | string;
  mint_events: number | string;
  burn_events: number | string;
  latest_block: number | string | null;
  last_observed_at: Date | string | null;
};

type TimelineRow = {
  bucket: Date | string;
  transfers: number | string;
  active_addresses: number | string;
  mints: number | string;
  burns: number | string;
};

type LeaderRow = {
  token_address: string;
  symbol: string | null;
  name: string | null;
  current_transfers: number | string;
  previous_transfers: number | string;
  active_addresses: number | string;
  holder_count: number | string | null;
  holder_delta: number | string | null;
  latest_block: number | string;
  last_transfer_at: Date | string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseChainStats(value: unknown): ChainStatsData | null {
  const row = objectValue(value);
  if (!row) return null;
  const totalBlocks = numberValue(row.totalBlocks, Number.NaN);
  const totalTransactions = numberValue(row.totalTransactions, Number.NaN);
  const totalAddresses = numberValue(row.totalAddresses, Number.NaN);
  if (![totalBlocks, totalTransactions, totalAddresses].every(Number.isFinite)) return null;
  const gas = objectValue(row.gasPricesGwei);
  return {
    totalBlocks,
    totalTransactions,
    totalAddresses,
    averageBlockTimeMs: row.averageBlockTimeMs == null ? null : numberValue(row.averageBlockTimeMs),
    networkUtilizationPct: row.networkUtilizationPct == null ? null : numberValue(row.networkUtilizationPct),
    gasPricesGwei: gas ? {
      slow: gas.slow == null ? null : numberValue(gas.slow),
      average: gas.average == null ? null : numberValue(gas.average),
      fast: gas.fast == null ? null : numberValue(gas.fast),
    } : null,
    observedAt: typeof row.observedAt === "string" ? row.observedAt : new Date(0).toISOString(),
  };
}

function parseTransferCursor(value: unknown) {
  const row = objectValue(value);
  return {
    scannedInCycle: numberValue(row?.scannedInCycle),
    completedCycles: numberValue(row?.completedCycles),
    totalTokens: numberValue(row?.totalTokens),
    lastBatchSize: numberValue(row?.lastBatchSize),
    lookbackHours: numberValue(row?.lookbackHours, 48),
  };
}

export async function getOverviewData(db: Db, window: string): Promise<OverviewData> {
  const hours = windowHours(window);
  const now = new Date();
  const windowStart = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - hours * 2 * 60 * 60 * 1000);
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  const [aggregateResult, timelineResult, leadersResult, recentRows, tokenCounts, stateRows] = await Promise.all([
    db.execute<AggregateRow>(sql`
      SELECT
        count(*)::int AS transfer_count,
        count(DISTINCT token_address)::int AS active_tokens,
        (SELECT count(DISTINCT address)::int FROM (
          SELECT from_address AS address FROM token_transfers WHERE timestamp >= ${windowStart}
          UNION
          SELECT to_address AS address FROM token_transfers WHERE timestamp >= ${windowStart}
        ) addresses) AS active_addresses,
        count(*) FILTER (WHERE from_address = ${zeroAddress})::int AS mint_events,
        count(*) FILTER (WHERE to_address = ${zeroAddress})::int AS burn_events,
        max(block_number) AS latest_block,
        max(timestamp) AS last_observed_at
      FROM token_transfers
      WHERE timestamp >= ${windowStart}
    `),
    db.execute<TimelineRow>(sql`
      WITH bucket_counts AS (
        SELECT date_trunc('hour', timestamp) AS bucket,
          count(*)::int AS transfers,
          count(*) FILTER (WHERE from_address = ${zeroAddress})::int AS mints,
          count(*) FILTER (WHERE to_address = ${zeroAddress})::int AS burns
        FROM token_transfers
        WHERE timestamp >= ${windowStart}
        GROUP BY 1
      ), address_events AS (
        SELECT date_trunc('hour', timestamp) AS bucket, from_address AS address
        FROM token_transfers WHERE timestamp >= ${windowStart}
        UNION
        SELECT date_trunc('hour', timestamp) AS bucket, to_address AS address
        FROM token_transfers WHERE timestamp >= ${windowStart}
      ), address_counts AS (
        SELECT bucket, count(DISTINCT address)::int AS active_addresses
        FROM address_events GROUP BY bucket
      )
      SELECT b.bucket, b.transfers, COALESCE(a.active_addresses, 0)::int AS active_addresses, b.mints, b.burns
      FROM bucket_counts b LEFT JOIN address_counts a USING (bucket)
      ORDER BY b.bucket
    `),
    db.execute<LeaderRow>(sql`
      WITH counts AS (
        SELECT token_address,
          count(*) FILTER (WHERE timestamp >= ${windowStart})::int AS current_transfers,
          count(*) FILTER (WHERE timestamp < ${windowStart})::int AS previous_transfers,
          max(block_number) FILTER (WHERE timestamp >= ${windowStart}) AS latest_block,
          max(timestamp) FILTER (WHERE timestamp >= ${windowStart}) AS last_transfer_at
        FROM token_transfers
        WHERE timestamp >= ${previousStart}
        GROUP BY token_address
      ), address_events AS (
        SELECT token_address, from_address AS address FROM token_transfers WHERE timestamp >= ${windowStart}
        UNION
        SELECT token_address, to_address AS address FROM token_transfers WHERE timestamp >= ${windowStart}
      ), address_counts AS (
        SELECT token_address, count(DISTINCT address)::int AS active_addresses
        FROM address_events GROUP BY token_address
      ), latest_metrics AS (
        SELECT DISTINCT ON (token_address) token_address, holder_count, holder_delta
        FROM token_metric_snapshots
        WHERE "window" = '24h'
        ORDER BY token_address, calculated_at DESC
      )
      SELECT c.token_address, t.symbol, t.name, c.current_transfers, c.previous_transfers,
        COALESCE(a.active_addresses, 0)::int AS active_addresses,
        m.holder_count, m.holder_delta, c.latest_block, c.last_transfer_at
      FROM counts c
      LEFT JOIN tokens t ON t.address = c.token_address
      LEFT JOIN address_counts a ON a.token_address = c.token_address
      LEFT JOIN latest_metrics m ON m.token_address = c.token_address
      WHERE c.current_transfers > 0
      ORDER BY c.current_transfers DESC, a.active_addresses DESC
      LIMIT 12
    `),
    db.select({
      txHash: tokenTransfers.txHash,
      logIndex: tokenTransfers.logIndex,
      blockNumber: tokenTransfers.blockNumber,
      tokenAddress: tokenTransfers.tokenAddress,
      symbol: tokens.symbol,
      fromAddress: tokenTransfers.fromAddress,
      toAddress: tokenTransfers.toAddress,
      normalizedValue: tokenTransfers.normalizedValue,
      timestamp: tokenTransfers.timestamp,
    }).from(tokenTransfers)
      .leftJoin(tokens, eq(tokens.address, tokenTransfers.tokenAddress))
      .where(gte(tokenTransfers.timestamp, windowStart))
      .orderBy(desc(tokenTransfers.timestamp), desc(tokenTransfers.blockNumber))
      .limit(12),
    Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(tokens).where(eq(tokens.canonicalStatus, "CANONICAL")),
      db.select({ count: sql<number>`count(DISTINCT token_address)::int` }).from(tokenTransfers),
    ]),
    db.select({
      jobName: sourceSyncState.jobName,
      cursor: sourceSyncState.cursor,
      lastSuccessAt: sourceSyncState.lastSuccessAt,
      status: sourceSyncState.status,
    }).from(sourceSyncState).where(eq(sourceSyncState.source, "blockscout")),
  ]);

  const aggregate = aggregateResult.rows[0];
  const transferState = stateRows.find((row) => row.jobName === "token-transfers");
  const statsState = stateRows.find((row) => row.jobName === "chain-stats");
  const cursor = parseTransferCursor(transferState?.cursor);
  const trackedTokens = numberValue(tokenCounts[0][0]?.count);
  const tokensWithStoredTransfers = numberValue(tokenCounts[1][0]?.count);
  const completedCycles = cursor.completedCycles;
  const scannedInCycle = Math.min(trackedTokens, cursor.scannedInCycle);
  const cycleProgressPct = trackedTokens > 0
    ? Math.round((scannedInCycle / trackedTokens) * 100)
    : 0;

  const rawLeaders = leadersResult.rows.map((row) => ({
    address: row.token_address,
    symbol: row.symbol,
    name: row.name,
    transferCount: numberValue(row.current_transfers),
    previousTransferCount: numberValue(row.previous_transfers),
    activeAddresses: numberValue(row.active_addresses),
    holderCount: row.holder_count == null ? null : numberValue(row.holder_count),
    holderDelta: row.holder_delta == null ? null : numberValue(row.holder_delta),
    latestBlock: numberValue(row.latest_block),
    lastTransferAt: toIso(row.last_transfer_at) ?? new Date(0).toISOString(),
  }));
  const maxTransfers = Math.max(0, ...rawLeaders.map((row) => row.transferCount));
  const maxAddresses = Math.max(0, ...rawLeaders.map((row) => row.activeAddresses));
  const topTokens: ActivityTokenRow[] = rawLeaders.map((row) => ({
    ...row,
    momentumPct: calculateMomentum(row.transferCount, row.previousTransferCount),
    activityIndex: calculateActivityIndex(row.transferCount, row.activeAddresses, maxTransfers, maxAddresses),
    evidence: buildActivityEvidence(row.transferCount, row.previousTransferCount, row.activeAddresses, row.holderDelta),
  }));

  const lastIndexedAt = toIso(transferState?.lastSuccessAt);
  const chain = parseChainStats(statsState?.cursor);
  const lastUpdatedAt = [lastIndexedAt, toIso(statsState?.lastSuccessAt)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? new Date(0).toISOString();

  return {
    window,
    chain,
    activity: {
      transferEvents: numberValue(aggregate?.transfer_count),
      activeAddresses: numberValue(aggregate?.active_addresses),
      activeTokens: numberValue(aggregate?.active_tokens),
      mintEvents: numberValue(aggregate?.mint_events),
      burnEvents: numberValue(aggregate?.burn_events),
      latestBlock: aggregate?.latest_block == null ? null : numberValue(aggregate.latest_block),
      lastObservedAt: toIso(aggregate?.last_observed_at),
    },
    coverage: {
      trackedTokens,
      tokensWithStoredTransfers,
      scannedInCycle,
      completedCycles,
      cycleProgressPct,
      lastBatchSize: cursor.lastBatchSize,
      lookbackHours: cursor.lookbackHours,
      status: transferState?.status ?? "not-started",
      lastIndexedAt,
    },
    timeline: timelineResult.rows.map((row) => ({
      timestamp: toIso(row.bucket) ?? new Date(0).toISOString(),
      transfers: numberValue(row.transfers),
      activeAddresses: numberValue(row.active_addresses),
      mints: numberValue(row.mints),
      burns: numberValue(row.burns),
    })),
    topTokens,
    recentTransfers: recentRows.map((row) => ({
      ...row,
      normalizedValue: row.normalizedValue ?? null,
      kind: classifyTransfer(row.fromAddress, row.toAddress),
      timestamp: toIso(row.timestamp) ?? new Date(0).toISOString(),
    })),
    dataQuality: {
      scope: "Bounded rotating sample of canonical Robinhood Chain token transfers",
      completeness: completedCycles > 0 ? "cycle-complete" : "partial",
      syntheticExcluded: true,
      note: "Counts are page-bounded Blockscout observations for tracked canonical tokens and may be lower bounds, not an exhaustive full-chain index.",
    },
    lastUpdatedAt,
  };
}

// ── Stock tokens ────────────────────────────────────────────────────────────

export interface CanonicalAssetRef {
  id: string;
  symbol: string | null;
  multiplier: string | null;
  status: string | null;
}

export interface StockTokenRow {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  canonicalStatus: string | null;
  canonicalAsset: CanonicalAssetRef | null;
  metrics: {
    holderCount: number | null;
    holderDelta: number | null;
    uniqueBuyers: number | null;
    uniqueSellers: number | null;
    netFlowUsd: number | null;
    liquidityUsd: number | null;
    depth1pctUsd: number | null;
    volumeUsd: number | null;
    top10Share: number | null;
    dataCompleteness: number | null;
  } | null;
  lastSeenAt: string | null;
}

export async function getStockTokensData(
  db: Db,
  window: string,
  canonicalOnly: boolean
): Promise<StockTokenRow[]> {
  const tokenQuery = canonicalOnly
    ? db.select().from(tokens).where(eq(tokens.canonicalStatus, "CANONICAL"))
    : db.select().from(tokens);

  const [canonical, tokenList, metricRows] = await Promise.all([
    db.select().from(canonicalAssets),
    tokenQuery,
    db
      .select()
      .from(tokenMetricSnapshots)
      .where(eq(tokenMetricSnapshots.window, window))
      .orderBy(desc(tokenMetricSnapshots.calculatedAt)),
  ]);

  const canonicalByAddress = new Map(
    canonical.map((asset) => [asset.contractAddress.toLowerCase(), asset]),
  );
  const latestMetricByToken = new Map<string, (typeof metricRows)[number]>();
  for (const metric of metricRows) {
    if (!latestMetricByToken.has(metric.tokenAddress)) {
      latestMetricByToken.set(metric.tokenAddress, metric);
    }
  }

  return tokenList.map((token) => {
    const latestMetric = latestMetricByToken.get(token.address) ?? null;
    const canonicalAsset = canonicalByAddress.get(token.address.toLowerCase());

    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      canonicalStatus: token.canonicalStatus,
      canonicalAsset: canonicalAsset
        ? {
            id: canonicalAsset.id,
            symbol: canonicalAsset.symbol,
            multiplier: canonicalAsset.currentMultiplier,
            status: canonicalAsset.assetStatus,
          }
        : null,
      metrics: latestMetric
        ? {
            holderCount: latestMetric.holderCount,
            holderDelta: latestMetric.holderDelta,
            uniqueBuyers: latestMetric.uniqueBuyers,
            uniqueSellers: latestMetric.uniqueSellers,
            netFlowUsd: latestMetric.netFlowUsd,
            liquidityUsd: latestMetric.liquidityUsd,
            depth1pctUsd: latestMetric.depth1pctUsd,
            volumeUsd: latestMetric.volumeUsd,
            top10Share: latestMetric.top10Share,
            dataCompleteness: latestMetric.dataCompleteness,
          }
        : null,
      lastSeenAt: toIso(token.lastSeenAt),
    };
  });
}

// ── Token detail ────────────────────────────────────────────────────────────

export interface TokenDetailData {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  canonicalStatus: string | null;
  canonicalAsset: CanonicalAssetRef | null;
  isVerified: boolean | null;
  metrics: StockTokenRow["metrics"];
  signals: Array<{
    id: string;
    type: string;
    rawScore: number;
    riskScore: number;
    adjustedScore: number;
    confidence: string;
  }>;
}

export async function getTokenDetailData(db: Db, address: string): Promise<TokenDetailData | null> {
  const normalizedAddress = address.toLowerCase();

  const tokenList = await db
    .select()
    .from(tokens)
    .where(eq(tokens.address, normalizedAddress))
    .limit(1);

  if (tokenList.length === 0) return null;
  const token = tokenList[0];

  let canonicalAsset = null;
  if (token.canonicalAssetId) {
    const caList = await db
      .select()
      .from(canonicalAssets)
      .where(eq(canonicalAssets.id, token.canonicalAssetId))
      .limit(1);
    canonicalAsset = caList[0] || null;
  }

  const metricsList = await db
    .select()
    .from(tokenMetricSnapshots)
    .where(
      and(
        eq(tokenMetricSnapshots.tokenAddress, normalizedAddress),
        eq(tokenMetricSnapshots.window, "24h")
      )
    )
    .orderBy(desc(tokenMetricSnapshots.calculatedAt))
    .limit(1);

  const metric = metricsList[0] || null;

  const signalList = await db
    .select()
    .from(signals)
    .where(and(eq(signals.entityId, normalizedAddress), eq(signals.status, "ACTIVE")))
    .orderBy(desc(signals.adjustedScore))
    .limit(10);

  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    canonicalStatus: token.canonicalStatus,
    canonicalAsset: canonicalAsset
      ? {
          id: canonicalAsset.id,
          symbol: canonicalAsset.symbol,
          multiplier: canonicalAsset.currentMultiplier,
          status: canonicalAsset.assetStatus,
        }
      : null,
    isVerified: token.isVerified,
    metrics: metric
      ? {
          holderCount: metric.holderCount,
          holderDelta: metric.holderDelta,
          uniqueBuyers: metric.uniqueBuyers,
          uniqueSellers: metric.uniqueSellers,
          netFlowUsd: metric.netFlowUsd,
          liquidityUsd: metric.liquidityUsd,
          depth1pctUsd: metric.depth1pctUsd,
          volumeUsd: metric.volumeUsd,
          top10Share: metric.top10Share,
          dataCompleteness: metric.dataCompleteness,
        }
      : null,
    signals: signalList.map((s) => ({
      id: s.id,
      type: s.signalType,
      rawScore: s.rawScore ? Number(s.rawScore) : 0,
      riskScore: s.riskScore ? Number(s.riskScore) : 0,
      adjustedScore: s.adjustedScore ? Number(s.adjustedScore) : 0,
      confidence: s.confidence || "LOW",
    })),
  };
}

// ── Token scanner list ──────────────────────────────────────────────────────

export interface TokensScannerItem {
  address: string;
  symbol: string | null;
  name: string | null;
  tokenType: string | null;
  isVerified: boolean | null;
  holderCount: number | null;
  holderDelta: number | null;
  uniqueBuyers: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  top10Share: number | null;
  canonicalStatus: string | null;
  opportunityScore: number | null;
  riskScore: number | null;
  createdAt: string | null;
}

export async function getTokensScannerData(db: Db): Promise<TokensScannerItem[]> {
  const [tokenList, metricRows, signalRows] = await Promise.all([
    db.select().from(tokens),
    db
      .select()
      .from(tokenMetricSnapshots)
      .where(eq(tokenMetricSnapshots.window, "24h"))
      .orderBy(desc(tokenMetricSnapshots.calculatedAt)),
    db
      .select()
      .from(signals)
      .where(eq(signals.status, "ACTIVE"))
      .orderBy(desc(signals.adjustedScore)),
  ]);

  const latestMetricByToken = new Map<string, (typeof metricRows)[number]>();
  for (const metric of metricRows) {
    if (!latestMetricByToken.has(metric.tokenAddress)) {
      latestMetricByToken.set(metric.tokenAddress, metric);
    }
  }

  const topSignalByToken = new Map<string, (typeof signalRows)[number]>();
  for (const signal of signalRows) {
    if (!topSignalByToken.has(signal.entityId)) {
      topSignalByToken.set(signal.entityId, signal);
    }
  }

  return tokenList.map((token): TokensScannerItem => {
    const metric = latestMetricByToken.get(token.address) ?? null;
    const latestSignal = topSignalByToken.get(token.address) ?? null;

    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      tokenType: token.tokenType,
      isVerified: token.isVerified,
      holderCount: metric?.holderCount ?? null,
      holderDelta: metric?.holderDelta ?? null,
      uniqueBuyers: metric?.uniqueBuyers ?? null,
      volumeUsd: metric?.volumeUsd ?? null,
      liquidityUsd: metric?.liquidityUsd ?? null,
      top10Share: metric?.top10Share ?? null,
      canonicalStatus: token.canonicalStatus,
      opportunityScore: latestSignal?.adjustedScore ?? null,
      riskScore: latestSignal?.riskScore ?? null,
      createdAt: toIso(token.createdAt),
    };
  });
}

const SCANNER_KEYS: Record<string, keyof TokensScannerItem> = {
  holders: "holderCount",
  volume: "volumeUsd",
  risk: "riskScore",
};

/** Sort scanner rows by a numeric key, descending, nulls last. */
export function sortScannerItems(list: TokensScannerItem[], sort: string): TokensScannerItem[] {
  const key = SCANNER_KEYS[sort] ?? "holderCount";
  return [...list].sort((a, b) => {
    const av = a[key] as number | null;
    const bv = b[key] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

// ── Source sync state (for /api/v1/source-health) ──────────────────────────

export interface SyncStateRow {
  source: string;
  jobName: string;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export async function getSyncStatesData(db: Db): Promise<SyncStateRow[]> {
  const rows = await db.select().from(sourceSyncState).orderBy(desc(sourceSyncState.lastSuccessAt));
  return rows.map((r) => ({
    source: r.source,
    jobName: r.jobName,
    lastSuccessAt: toIso(r.lastSuccessAt),
    lastError: r.lastError,
  }));
}
