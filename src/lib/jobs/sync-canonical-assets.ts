import { getDb } from "@/lib/db";
import { canonicalAssets, tokens, sourceSyncState } from "@/db/schema";
import { fetchCanonicalAssets, detectTickerCollisions } from "@/lib/sources/robinhood/assets";
import { eq, and } from "drizzle-orm";
import { SourceRequestError } from "@/lib/sources/source-request";

export async function syncCanonicalAssets(): Promise<{
  processed: number;
  created: number;
  updated: number;
  collisions: Array<{ symbol: string; canonicalAddress: string; collisionAddresses: string[] }>;
}> {
  const db = getDb();
  const startTime = new Date();
  let applied = 0;

  // Record sync start
  await db
    .insert(sourceSyncState)
    .values({
      source: "robinhood",
      jobName: "canonical-assets",
      lastStartedAt: startTime,
      status: "running",
    })
    .onConflictDoUpdate({
      target: [sourceSyncState.source, sourceSyncState.jobName],
      set: { lastStartedAt: startTime, status: "running" },
    });

  try {
    // Fetch from Robinhood API
    const assets = await fetchCanonicalAssets();
    if (assets.length === 0) throw new Error("Canonical registry has no usable assets");

    let created = 0;
    let updated = 0;

    // Upsert each canonical asset
    for (const asset of assets) {
      const existing = await db
        .select()
        .from(canonicalAssets)
        .where(eq(canonicalAssets.contractAddress, asset.contractAddress))
        .limit(1);

      if (existing.length > 0 && existing[0].chainId !== asset.chainId) {
        throw new Error("Canonical registry chain identity conflict");
      }
      if (existing.length === 0) {
        // Insert new canonical asset
        await db.insert(canonicalAssets).values({
          id: asset.id,
          assetId: asset.assetId,
          symbol: asset.symbol,
          name: asset.name,
          contractAddress: asset.contractAddress,
          chainId: asset.chainId,
          currentMultiplier: asset.currentMultiplier,
          pendingMultiplier: asset.pendingMultiplier,
          assetStatus: asset.status,
          tradingCapabilities: asset.tradingCapabilities,
          isin: asset.isin,
          sourceUpdatedAt: asset.sourceUpdatedAt,
          syncedAt: new Date(),
        });

        applied++;
        // Also ensure token exists with canonical status
        await db
          .insert(tokens)
          .values({
            address: asset.contractAddress.toLowerCase(),
            symbol: asset.symbol,
            name: asset.name,
            canonicalAssetId: asset.id,
            canonicalStatus: "CANONICAL",
          })
          .onConflictDoUpdate({
            target: [tokens.address],
            set: {
              symbol: asset.symbol,
              name: asset.name,
              canonicalAssetId: asset.id,
              canonicalStatus: "CANONICAL",
              lastSeenAt: new Date(),
            },
          });

        created++;
      } else {
        // Update existing canonical asset
        await db
          .update(canonicalAssets)
          .set({
            currentMultiplier: asset.currentMultiplier,
            pendingMultiplier: asset.pendingMultiplier,
            assetStatus: asset.status,
            tradingCapabilities: asset.tradingCapabilities,
            sourceUpdatedAt: asset.sourceUpdatedAt,
            syncedAt: new Date(),
          })
          .where(eq(canonicalAssets.contractAddress, asset.contractAddress));
        applied++;
        updated++;
      }
    }

    // Detect ticker collisions
    const collisions = detectTickerCollisions(assets);

    // Mark colliding tokens
    for (const collision of collisions) {
      for (const addr of collision.collisionAddresses) {
        await db
          .update(tokens)
          .set({ canonicalStatus: "TICKER_COLLISION" })
          .where(eq(tokens.address, addr.toLowerCase()));
      }
    }

    // Mark tokens that are in canonical list as CANONICAL
    for (const asset of assets) {
      await db
        .update(tokens)
        .set({ canonicalStatus: "CANONICAL", canonicalAssetId: asset.id })
        .where(eq(tokens.address, asset.contractAddress.toLowerCase()));
    }

    // Record success
    await db
      .update(sourceSyncState)
      .set({
        lastSuccessAt: new Date(),
        status: "success",
        recordsProcessed: assets.length,
        lastError: null,
      })
      .where(and(eq(sourceSyncState.source, "robinhood"), eq(sourceSyncState.jobName, "canonical-assets")));

    return { processed: assets.length, created, updated, collisions };
  } catch (error) {
    const errorMessage = error instanceof SourceRequestError
      ? `Canonical registry request failed (${error.code}; HTTP ${error.status ?? "unknown"})`
      : "Canonical registry sync failed (invalid registry or persistence error)";

    await db
      .update(sourceSyncState)
      .set({
        lastErrorAt: new Date(),
        lastError: `${errorMessage}; ${applied} registry rows applied before failure`,
        status: applied > 0 ? "degraded" : "error",
        recordsProcessed: applied,
      })
      .where(and(eq(sourceSyncState.source, "robinhood"), eq(sourceSyncState.jobName, "canonical-assets")));

    throw new Error(errorMessage);
  }
}
