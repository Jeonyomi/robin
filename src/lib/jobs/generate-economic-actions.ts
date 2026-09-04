import { getDb } from "@/lib/db";
import { tokens, tokenMetricSnapshots, economicActions, sourceSyncState } from "@/db/schema";
import { eq, and, desc, or, sql } from "drizzle-orm";

/**
 * Job 5a — Generate synthetic economic actions from metric snapshots.
 */
export async function generateEconomicActions(): Promise<{
  processed: number;
  created: number;
}> {
  const db = getDb();

  await db
    .insert(sourceSyncState)
    .values({
      source: "internal",
      jobName: "economic-actions",
      lastStartedAt: new Date(),
      status: "running",
    })
    .onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],        set: { lastStartedAt: new Date(), status: "running" },
    });

  let created = 0;

  try {
    const tokenList = await db
      .select()
      .from(tokens)
      .where(eq(tokens.canonicalStatus, "CANONICAL"));

    const now = Date.now();

    for (const token of tokenList.slice(0, 50)) {
      const snapshots = await db
        .select()
        .from(tokenMetricSnapshots)
        .where(
          and(
            eq(tokenMetricSnapshots.tokenAddress, token.address),
            eq(tokenMetricSnapshots.window, "24h")
          )
        )
        .orderBy(desc(tokenMetricSnapshots.calculatedAt))
        .limit(1);

      const snapshot = snapshots[0];
      if (!snapshot || !snapshot.volumeUsd || snapshot.volumeUsd === 0) continue;

      const recentCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(economicActions)
        .where(
          or(
            eq(economicActions.inputAsset, token.address),
            eq(economicActions.outputAsset, token.address),
          ),
        );

      if (recentCount[0] && Number(recentCount[0].count) > 0) continue;

      const hourlyVolume = snapshot.volumeUsd / 24;
      const numActions = Math.min(5, Math.max(3, Math.floor(snapshot.volumeUsd / 10000)));
      
      for (let i = 0; i < numActions; i++) {
        const hoursAgo = Math.floor(Math.random() * 24);
        const timestamp = new Date(now - hoursAgo * 60 * 60 * 1000);
        const usdValue = hourlyVolume * (0.2 + Math.random() * 1.6);
        const isBuy = Math.random() > 0.45;
        
        await db.insert(economicActions).values({
          txHash: `0x${now.toString(16)}${token.address.slice(2, 10)}${i.toString(16).padStart(4, '0')}`,
          actionIndex: i,
          actionType: "SWAP",
          actorAddress: null,
          protocol: "robinhood-dex",
          inputAsset: isBuy ? "0x0000000000000000000000000000000000000000" : token.address,
          inputAmount: isBuy ? usdValue / 1800 : 1,
          outputAsset: isBuy ? token.address : "0x0000000000000000000000000000000000000000",
          outputAmount: isBuy ? 1 : usdValue / 1800,
          usdValue: isBuy ? usdValue : -usdValue,
          metadata: { synthetic: true, tokenAddress: token.address },
          timestamp,
        });
        
        created++;
      }
    }

    await db
      .update(sourceSyncState)
      .set({
        lastSuccessAt: new Date(),
        status: "success",
        recordsProcessed: created,
        lastError: null,
      })
      .where(
        and(
          eq(sourceSyncState.source, "internal"),
          eq(sourceSyncState.jobName, "economic-actions")
        )
      );

    return { processed: tokenList.length, created };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourceSyncState)
      .set({
        lastErrorAt: new Date(),
        lastError: msg,
        status: "error",
      })
      .where(
        and(
          eq(sourceSyncState.source, "internal"),
          eq(sourceSyncState.jobName, "economic-actions")
        )
      );
    throw error;
  }
}
