import { getDb } from "@/lib/db";
import { tokens, tokenMetricSnapshots, sourceSyncState } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * Job 6 — Metrics: compute holder deltas between consecutive Blockscout
 * snapshots. Never fabricates metrics — tokens without real snapshot data
 * are skipped (P-06: missing data is not zeroed).
 */
export async function calculateTokenMetrics(): Promise<{ processed: number; updated: number }> {
  const db = getDb();
  const started = new Date();

  await db
    .insert(sourceSyncState)
    .values({ source: "internal", jobName: "metric-snapshots", lastStartedAt: started, status: "running" })
    .onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],
      set: { lastStartedAt: started, status: "running" },
    });

  let updated = 0;

  try {
    const tokenList = await db.select().from(tokens).where(eq(tokens.canonicalStatus, "CANONICAL"));

    for (const token of tokenList.slice(0, 200)) {
      // Two most recent 24h snapshots for delta computation
      const snapshots = await db
        .select()
        .from(tokenMetricSnapshots)
        .where(and(eq(tokenMetricSnapshots.tokenAddress, token.address), eq(tokenMetricSnapshots.window, "24h")))
        .orderBy(desc(tokenMetricSnapshots.calculatedAt))
        .limit(2);

      if (snapshots.length === 0) continue; // no real data yet — skip (P-06)
      const latest = snapshots[0];
      const prev = snapshots[1];

      if (latest.holderCount === null || latest.holderCount === undefined) continue;

      // Compute delta vs previous snapshot when both have data
      const holderDelta =
        prev && prev.holderCount !== null && prev.holderCount !== undefined
          ? latest.holderCount - prev.holderCount
          : null;

      // Only rewrite when we actually computed something new
      await db
        .update(tokenMetricSnapshots)
        .set({ holderDelta })
        .where(eq(tokenMetricSnapshots.id, latest.id));

      updated++;
    }

    await db
      .update(sourceSyncState)
      .set({ lastSuccessAt: new Date(), status: "success", recordsProcessed: updated, lastError: null })
      .where(and(eq(sourceSyncState.source, "internal"), eq(sourceSyncState.jobName, "metric-snapshots")));

    return { processed: tokenList.slice(0, 200).length, updated };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourceSyncState)
      .set({ lastErrorAt: new Date(), lastError: msg, status: "error" })
      .where(and(eq(sourceSyncState.source, "internal"), eq(sourceSyncState.jobName, "metric-snapshots")));
    throw error;
  }
}
