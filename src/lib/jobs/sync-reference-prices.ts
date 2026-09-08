import { getDb } from "@/lib/db";
import { canonicalAssets, stockTokenPriceSnapshots, sourceSyncState } from "@/db/schema";
import { fetchAllReferencePrices, adjustReferencePrice } from "@/lib/sources/robinhood/prices";
import { SourceRequestError } from "@/lib/sources/source-request";
import { eq, and } from "drizzle-orm";

/** One batch request; identity is chain+contract, never the ticker. */
export async function syncReferencePrices(): Promise<{ processed: number; stored: number; errors: number }> {
  const db = getDb();
  const started = new Date();
  const stateKey = and(eq(sourceSyncState.source, "robinhood"), eq(sourceSyncState.jobName, "reference-prices"));
  await db.insert(sourceSyncState)
    .values({ source: "robinhood", jobName: "reference-prices", lastStartedAt: started, status: "running" })
    .onConflictDoUpdate({ target: [sourceSyncState.source, sourceSyncState.jobName], set: { lastStartedAt: started, status: "running" } });

  let stored = 0;
  let errors = 0;
  try {
    const canonical = await db.select().from(canonicalAssets);
    const quotes = await fetchAllReferencePrices();
    const rejected = quotes.rejectedCount ?? 0;
    errors = rejected;
    const reasons = { malformed: rejected, identity: 0, timestamp: 0, price: 0 };
    const identityCounts = new Map<string, number>();
    for (const quote of quotes) {
      for (const deployment of quote.deployments ?? []) {
        const key = `${deployment.chainId}:${deployment.contractAddress.toLowerCase()}`;
        identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
      }
    }
    for (const quote of quotes) {
      const matches = canonical.filter((asset) => quote.deployments?.some((deployment) =>
        deployment.chainId === asset.chainId && /^0x[0-9a-fA-F]{40}$/.test(deployment.contractAddress) &&
        deployment.contractAddress.toLowerCase() === asset.contractAddress.toLowerCase(),
      ));
      if (matches.length !== 1) { errors++; reasons.identity++; continue; }
      const asset = matches[0];
      if (identityCounts.get(`${asset.chainId}:${asset.contractAddress.toLowerCase()}`) !== 1) {
        errors++; reasons.identity++; continue;
      }
      const time = quote.referenceTimestamp;
      // Keep last-good snapshots: an unobserved provider time cannot establish a
      // new reference observation, even though the current schema allows null.
      if (!(time instanceof Date) || !Number.isFinite(time.getTime()) || time.getTime() > Date.now()) {
        errors++; reasons.timestamp++; continue;
      }
      const adjusted = adjustReferencePrice(quote.rawMid, asset.currentMultiplier);
      if (adjusted === null) { errors++; reasons.price++; continue; }
      await db.insert(stockTokenPriceSnapshots).values({
        canonicalAssetId: asset.id,
        rawBid: quote.rawBid,
        rawAsk: quote.rawAsk,
        rawMid: quote.rawMid,
        multiplier: Number(asset.currentMultiplier),
        adjustedReferencePrice: adjusted,
        dexMidPrice: null,
        premiumDiscount: null,
        referenceTimestamp: time,
        snapshotAt: new Date(),
      });
      stored++;
    }
    const processed = quotes.length + rejected;
    const lastError = stored === 0 || errors > 0
      ? `${errors} of ${processed} quotes rejected (malformed=${reasons.malformed}, identity=${reasons.identity}, timestamp=${reasons.timestamp}, price=${reasons.price}); ${stored} stored`
      : null;
    await db.update(sourceSyncState).set({
      ...(stored > 0 ? { lastSuccessAt: new Date() } : {}),
      status: stored === 0 ? "error" : errors > 0 ? "degraded" : "success",
      recordsProcessed: stored,
      lastError,
      ...(lastError ? { lastErrorAt: new Date() } : {}),
    }).where(stateKey);
    return { processed, stored, errors };
  } catch (error) {
    const message = error instanceof SourceRequestError
      ? `Reference prices request failed (${error.code}; HTTP ${error.status ?? "unknown"})`
      : "Reference prices sync failed (invalid quotes or persistence error)";
    await db.update(sourceSyncState).set({
      lastErrorAt: new Date(), lastError: message, status: stored > 0 ? "degraded" : "error", recordsProcessed: stored,
      ...(stored > 0 ? { lastSuccessAt: new Date() } : {}),
    }).where(stateKey);
    throw new Error(message);
  }
}
