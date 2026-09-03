import { getDb } from "@/lib/db";
import { canonicalAssets, stockTokenPriceSnapshots, sourceSyncState } from "@/db/schema";
import { fetchAllReferencePrices, adjustReferencePrice } from "@/lib/sources/robinhood/prices";
import { eq, and } from "drizzle-orm";

/**
 * Job 2 — Reference Prices: fetch ALL quotes via the batch /rhj/prices endpoint
 * (1 request), join with canonical multipliers, store snapshots.
 */
export async function syncReferencePrices(): Promise<{ processed: number; stored: number; errors: number }> {
  const db = getDb();
  const started = new Date();

  await db
    .insert(sourceSyncState)
    .values({ source: "robinhood", jobName: "reference-prices", lastStartedAt: started, status: "running" })
    .onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],
      set: { lastStartedAt: started, status: "running" },
    });

  let stored = 0;
  let errors = 0;

  try {
    const canonical = await db.select().from(canonicalAssets);
    const quotes = await fetchAllReferencePrices();

    for (const quote of quotes) {
      const asset = canonical.find(
        (a) => a.symbol.toLowerCase() === quote.symbol.toLowerCase(),
      );
      if (!asset) {
        errors++;
        continue;
      }

      await db.insert(stockTokenPriceSnapshots).values({
        canonicalAssetId: asset.id,
        rawBid: quote.rawBid,
        rawAsk: quote.rawAsk,
        rawMid: quote.rawMid,
        multiplier: asset.currentMultiplier ? parseFloat(asset.currentMultiplier) : null,
        adjustedReferencePrice: adjustReferencePrice(quote.rawMid, asset.currentMultiplier),
        dexMidPrice: null, // filled by DEX pool sync (P1)
        premiumDiscount: null,
        referenceTimestamp: quote.referenceTimestamp,
        snapshotAt: new Date(),
      });

      stored++;
    }

    await db
      .update(sourceSyncState)
      .set({ lastSuccessAt: new Date(), status: "success", recordsProcessed: stored, lastError: null })
      .where(and(eq(sourceSyncState.source, "robinhood"), eq(sourceSyncState.jobName, "reference-prices")));

    return { processed: quotes.length, stored, errors };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourceSyncState)
      .set({ lastErrorAt: new Date(), lastError: msg, status: "error" })
      .where(and(eq(sourceSyncState.source, "robinhood"), eq(sourceSyncState.jobName, "reference-prices")));
    throw error;
  }
}
