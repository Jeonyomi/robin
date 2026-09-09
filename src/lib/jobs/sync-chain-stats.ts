import { and, eq } from "drizzle-orm";
import { sourceSyncState } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchChainStats } from "@/lib/sources/blockscout/stats";
import { fetchRpcChainSnapshot } from "@/lib/sources/rpc-chain";

async function fetchChainObservation() {
  try {
    return { ...(await fetchChainStats()), source: "blockscout" as const };
  } catch (blockscoutError) {
    let rpc;
    try {
      rpc = await fetchRpcChainSnapshot();
    } catch {
      throw blockscoutError;
    }
    return {
      totalBlocks: rpc.latestBlock,
      totalTransactions: null,
      totalAddresses: null,
      averageBlockTimeMs: null,
      networkUtilizationPct: null,
      gasUsedToday: null,
      gasPricesGwei: rpc.gasPricesGwei,
      gasPriceUpdatedAt: rpc.observedAt,
      observedAt: rpc.observedAt,
      source: rpc.source,
    };
  }
}

function previousBlockCount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = Number((value as Record<string, unknown>).totalBlocks);
  return Number.isFinite(candidate) ? candidate : null;
}

export async function syncChainStats() {
  const db = getDb();
  const started = new Date();
  const statsKey = and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "chain-stats"));
  const gasKey = and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "gas-prices"));

  await Promise.all([
    db.insert(sourceSyncState).values({
      source: "blockscout",
      jobName: "chain-stats",
      lastStartedAt: started,
      status: "running",
    }).onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],
      set: { lastStartedAt: started, status: "running" },
    }),
    db.insert(sourceSyncState).values({
      source: "blockscout",
      jobName: "gas-prices",
      lastStartedAt: started,
      status: "running",
    }).onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],
      set: { lastStartedAt: started, status: "running" },
    }),
  ]);

  try {
    const existingRows = await db.select({ cursor: sourceSyncState.cursor }).from(sourceSyncState).where(statsKey).limit(1);
    const stats = await fetchChainObservation();
    const gasValues = stats.gasPricesGwei
      ? [stats.gasPricesGwei.slow, stats.gasPricesGwei.average, stats.gasPricesGwei.fast]
      : [];
    const gasStored = gasValues.some((value) => value != null && Number.isFinite(value) && value >= 0);

    if (gasStored) {
      await db.update(sourceSyncState).set({
        cursor: {
          gasPricesGwei: stats.gasPricesGwei,
          gasPriceUpdatedAt: stats.gasPriceUpdatedAt,
          observedAt: stats.observedAt,
          source: stats.source,
        },
        lastSuccessAt: new Date(),
        recordsProcessed: 1,
        status: "success",
        lastError: null,
      }).where(gasKey);
    } else {
      await db.update(sourceSyncState).set({
        lastErrorAt: new Date(),
        lastError: "Blockscout stats response did not include a usable gas price",
        recordsProcessed: 0,
        status: "degraded",
      }).where(gasKey);
    }

    // totalBlocks is a cached consensus-block count, not a head block number.
    // Compare only with the last accepted response from this same stats source.
    const previousCount = previousBlockCount(existingRows[0]?.cursor);
    if (previousCount !== null && stats.totalBlocks < previousCount) {
      const message = `Ignored regressing Blockscout stats response: ${stats.totalBlocks} < ${previousCount}`;
      await db.update(sourceSyncState).set({
        lastErrorAt: new Date(),
        lastError: message,
        recordsProcessed: 0,
        status: "degraded",
      }).where(statsKey);
      return { ignored: true, gasStored, reason: message };
    }

    await db.update(sourceSyncState).set({
      cursor: stats,
      lastSuccessAt: new Date(),
      recordsProcessed: 1,
      status: "success",
      lastError: null,
    }).where(statsKey);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await Promise.all([
      db.update(sourceSyncState).set({
        lastErrorAt: new Date(),
        lastError: message,
        status: "error",
      }).where(statsKey),
      db.update(sourceSyncState).set({
        lastErrorAt: new Date(),
        lastError: message,
        status: "error",
      }).where(gasKey),
    ]);
    throw error;
  }
}
