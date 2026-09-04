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
  tokens,
  canonicalAssets,
  tokenMetricSnapshots,
  signals,
  sourceSyncState,
  tokenTransfers,
  economicActions,
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
  return v;
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface OverviewTimelinePoint {
  timestamp: string;
  bridgeIn: number;
  bridgeOut: number;
  dexBuy: number;
  dexSell: number;
}

export interface OverviewData {
  netCapitalInflow24h: number;
  activeWallets24h: number;
  dexVolume24h: number;
  usdgNetFlow24h: number;
  signals24h: number;
  highRiskAlerts: number;
  tokenCount: number;
  lastUpdatedAt: string;
  timeline: OverviewTimelinePoint[];
  composition: Array<{ name: string; value: number }>;
}

export async function getOverviewData(db: Db, window: string): Promise<OverviewData> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours(window) * 60 * 60 * 1000);

  const tokenCount = await db.select({ count: sql<number>`count(*)` }).from(tokens);

  const transferCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(tokenTransfers)
    .where(gte(tokenTransfers.timestamp, windowStart));

  const signalCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(signals)
    .where(gte(signals.createdAt, windowStart));

  const highRiskCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(signals)
    .where(and(gte(signals.createdAt, windowStart), eq(signals.status, "ACTIVE")));

  const volumeRow = await db
    .select({ total: sql<number>`COALESCE(SUM(usd_value), 0)` })
    .from(economicActions)
    .where(and(gte(economicActions.timestamp, windowStart), eq(economicActions.actionType, "SWAP")));

  // Postgres: bucket timestamptz values into UTC hours and return stable ISO text.
  const hourExpr = sql<string>`to_char(
    date_trunc('hour', ${economicActions.timestamp} AT TIME ZONE 'UTC'),
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )`;
  const timelineRows = await db
    .select({
      hour: hourExpr,
      bridgeIn: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'BRIDGE_IN' THEN usd_value ELSE 0 END), 0)`,
      bridgeOut: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'BRIDGE_OUT' THEN usd_value ELSE 0 END), 0)`,
      dexBuy: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'SWAP' AND usd_value >= 0 THEN usd_value ELSE 0 END), 0)`,
      dexSell: sql<number>`COALESCE(SUM(CASE WHEN action_type = 'SWAP' AND usd_value < 0 THEN ABS(usd_value) ELSE 0 END), 0)`,
    })
    .from(economicActions)
    .where(gte(economicActions.timestamp, windowStart))
    .groupBy(hourExpr)
    .orderBy(hourExpr);

  const timeline = timelineRows.map((r) => ({
    timestamp: toIso(r.hour) ?? new Date(0).toISOString(),
    bridgeIn: Number(r.bridgeIn) || 0,
    bridgeOut: Number(r.bridgeOut) || 0,
    dexBuy: Number(r.dexBuy) || 0,
    dexSell: Number(r.dexSell) || 0,
  }));

  const compositionRows = await db
    .select({ type: economicActions.actionType, total: sql<number>`COALESCE(SUM(usd_value), 0)` })
    .from(economicActions)
    .where(gte(economicActions.timestamp, windowStart))
    .groupBy(economicActions.actionType);

  const composition = compositionRows.map((r) => ({
    name: r.type.replace(/_/g, " "),
    value: Number(r.total) || 0,
  }));

  const lastSync = await db
    .select()
    .from(sourceSyncState)
    .orderBy(sql`last_success_at DESC NULLS LAST`)
    .limit(1);

  const dexVolume = Number(volumeRow[0]?.total) || 0;

  return {
    netCapitalInflow24h: timeline.reduce((acc, t) => acc + (t.bridgeIn - t.bridgeOut), 0),
    activeWallets24h: Number(transferCount[0]?.count) || 0,
    dexVolume24h: dexVolume,
    usdgNetFlow24h: 0,
    signals24h: Number(signalCount[0]?.count) || 0,
    highRiskAlerts: Number(highRiskCount[0]?.count) || 0,
    tokenCount: Number(tokenCount[0]?.count) || 0,
    lastUpdatedAt: toIso(lastSync[0]?.lastSuccessAt) ?? new Date().toISOString(),
    timeline,
    composition,
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
