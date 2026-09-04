import { and, eq, sql } from "drizzle-orm";
import { sourceSyncState, tokenTransfers } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchChainStats } from "@/lib/sources/blockscout/stats";

function previousBlockHeight(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = Number((value as Record<string, unknown>).totalBlocks);
  return Number.isFinite(candidate) ? candidate : null;
}

export async function syncChainStats() {
  const db = getDb();
  const started = new Date();
  const key = and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "chain-stats"));

  await db.insert(sourceSyncState).values({
    source: "blockscout",
    jobName: "chain-stats",
    lastStartedAt: started,
    status: "running",
  }).onConflictDoUpdate({
    target: [sourceSyncState.source, sourceSyncState.jobName],
    set: { lastStartedAt: started, status: "running" },
  });

  try {
    const [existingRows, transferRows] = await Promise.all([
      db.select({ cursor: sourceSyncState.cursor }).from(sourceSyncState).where(key).limit(1),
      db.select({ block: sql<number>`max(${tokenTransfers.blockNumber})` }).from(tokenTransfers),
    ]);
    const stats = await fetchChainStats();
    const previousHeight = previousBlockHeight(existingRows[0]?.cursor);
    const latestTransferBlock = Number(transferRows[0]?.block) || 0;
    const minimumKnownHeight = Math.max(previousHeight ?? 0, latestTransferBlock);
    if (stats.totalBlocks < minimumKnownHeight) {
      const message = `Ignored regressing Blockscout stats response: ${stats.totalBlocks} < ${minimumKnownHeight}`;
      await db.update(sourceSyncState).set({
        lastErrorAt: new Date(),
        lastError: message,
        recordsProcessed: 0,
        status: "degraded",
      }).where(key);
      return { ignored: true, reason: message };
    }

    await db.update(sourceSyncState).set({
      cursor: stats,
      lastSuccessAt: new Date(),
      recordsProcessed: 1,
      status: "success",
      lastError: null,
    }).where(key);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.update(sourceSyncState).set({
      lastErrorAt: new Date(),
      lastError: message,
      status: "error",
    }).where(key);
    throw error;
  }
}
