import { and, eq } from "drizzle-orm";
import { sourceSyncState } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchChainStats } from "@/lib/sources/blockscout/stats";

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
    const stats = await fetchChainStats();
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
