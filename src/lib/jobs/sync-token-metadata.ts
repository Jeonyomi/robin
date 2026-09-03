import { getDb } from "@/lib/db";
import { canonicalAssets, tokens, tokenMetricSnapshots, sourceSyncState } from "@/db/schema";
import { fetchTokenMetadata } from "@/lib/sources/blockscout/token";
import { eq, and } from "drizzle-orm";

/**
 * Job 3 — Blockscout Metrics: enrich canonical tokens with on-chain metadata
 * (holders, transfers, verification, supply) from Blockscout.
 */
export async function syncTokenMetadata(): Promise<{ processed: number; enriched: number; errors: number }> {
  const db = getDb();
  const started = new Date();

  await db
    .insert(sourceSyncState)
    .values({ source: "blockscout", jobName: "token-metadata", lastStartedAt: started, status: "running" })
    .onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],
      set: { lastStartedAt: started, status: "running" },
    });

  let enriched = 0;
  let errors = 0;

  try {
    const canonical = await db.select().from(canonicalAssets);

    // Bounded: process in chunks to stay well within request limits
    const batch = canonical.slice(0, 50);
    for (const asset of batch) {
      const meta = await fetchTokenMetadata(asset.contractAddress);
      if (!meta) {
        errors++;
        continue;
      }

      await db
        .update(tokens)
        .set({
          symbol: meta.symbol || asset.symbol,
          name: meta.name || asset.name,
          decimals: meta.decimals,
          tokenType: meta.tokenType,
          isVerified: meta.isVerified,
          isProxy: meta.isProxy,
          implementationAddress: meta.implementationAddress,
          canonicalStatus: "CANONICAL",
          lastSeenAt: new Date(),
        })
        .where(eq(tokens.address, asset.contractAddress.toLowerCase()));

      // Persist holder/transfer/volume snapshot as a metric row (24h window)
      await db.insert(tokenMetricSnapshots).values({
        tokenAddress: asset.contractAddress.toLowerCase(),
        window: "24h",
        holderCount: meta.holdersCount,
        volumeUsd: meta.volume24h ? parseFloat(meta.volume24h) : null,
        dataCompleteness: 0.6,
        calculatedAt: new Date(),
      });

      enriched++;
    }

    await db
      .update(sourceSyncState)
      .set({ lastSuccessAt: new Date(), status: "success", recordsProcessed: enriched, lastError: null })
      .where(and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "token-metadata")));

    return { processed: batch.length, enriched, errors };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourceSyncState)
      .set({ lastErrorAt: new Date(), lastError: msg, status: "error" })
      .where(and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "token-metadata")));
    throw error;
  }
}
