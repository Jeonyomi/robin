import { and, asc, eq } from "drizzle-orm";
import { canonicalAssets, tokens, tokenMetricSnapshots, sourceSyncState } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchTokenMetadata } from "@/lib/sources/blockscout/token";

const DEFAULT_BATCH_SIZE = 50;

type MetadataCursor = {
  nextOffset: number;
  scannedInCycle: number;
  completedCycles: number;
  totalTokens: number;
};

function readCursor(value: unknown): MetadataCursor | null {
  if (!value || typeof value !== "object") return null;
  const cursor = value as Partial<MetadataCursor>;
  if (!Number.isInteger(cursor.nextOffset) || !Number.isInteger(cursor.completedCycles)) return null;
  return {
    nextOffset: cursor.nextOffset ?? 0,
    scannedInCycle: cursor.scannedInCycle ?? 0,
    completedCycles: cursor.completedCycles ?? 0,
    totalTokens: cursor.totalTokens ?? 0,
  };
}

function rotatingSlice<T>(items: T[], offset: number, size: number): T[] {
  if (items.length === 0) return [];
  const count = Math.min(size, items.length);
  return Array.from({ length: count }, (_, index) => items[(offset + index) % items.length]);
}

/**
 * Enrich a bounded, rotating batch of canonical tokens with Blockscout metadata.
 * Holder counts are source observations; unavailable values remain null.
 */
export async function syncTokenMetadata(): Promise<{
  processed: number;
  enriched: number;
  errors: number;
  completedCycles: number;
  scannedInCycle: number;
}> {
  const db = getDb();
  const started = new Date();
  const stateKey = and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "token-metadata"));
  const configured = Number(process.env.METADATA_SYNC_BATCH_SIZE);
  const batchSize = Number.isInteger(configured) ? Math.max(1, Math.min(100, configured)) : DEFAULT_BATCH_SIZE;

  await db.insert(sourceSyncState).values({
    source: "blockscout",
    jobName: "token-metadata",
    lastStartedAt: started,
    status: "running",
  }).onConflictDoUpdate({
    target: [sourceSyncState.source, sourceSyncState.jobName],
    set: { lastStartedAt: started, status: "running" },
  });

  let enriched = 0;
  let errors = 0;

  try {
    const [canonical, stateRows] = await Promise.all([
      db.select().from(canonicalAssets).orderBy(asc(canonicalAssets.contractAddress)),
      db.select({ cursor: sourceSyncState.cursor }).from(sourceSyncState).where(stateKey).limit(1),
    ]);
    if (canonical.length === 0) throw new Error("No canonical tokens are available for metadata sync");

    const previous = readCursor(stateRows[0]?.cursor);
    const startOffset = (previous?.nextOffset ?? 0) % canonical.length;
    const batch = rotatingSlice(canonical, startOffset, batchSize);

    for (const asset of batch) {
      const meta = await fetchTokenMetadata(asset.contractAddress);
      if (!meta) {
        errors++;
        continue;
      }

      await db.update(tokens).set({
        symbol: meta.symbol || asset.symbol,
        name: meta.name || asset.name,
        decimals: meta.decimals,
        tokenType: meta.tokenType,
        isVerified: meta.isVerified,
        isProxy: meta.isProxy,
        implementationAddress: meta.implementationAddress,
        canonicalStatus: "CANONICAL",
        lastSeenAt: new Date(),
      }).where(eq(tokens.address, asset.contractAddress.toLowerCase()));

      await db.insert(tokenMetricSnapshots).values({
        tokenAddress: asset.contractAddress.toLowerCase(),
        window: "24h",
        holderCount: meta.holdersCount,
        volumeUsd: meta.volume24h ? parseFloat(meta.volume24h) : null,
        dataCompleteness: meta.holdersCount === null ? 0.35 : 0.6,
        calculatedAt: new Date(),
      });
      enriched++;
    }

    const rawNext = startOffset + batch.length;
    const wrapped = rawNext >= canonical.length;
    const nextOffset = rawNext % canonical.length;
    const completedCycles = (previous?.completedCycles ?? 0) + (wrapped ? 1 : 0);
    const scannedInCycle = wrapped ? nextOffset : Math.min(canonical.length, (previous?.scannedInCycle ?? 0) + batch.length);
    const cursor: MetadataCursor = { nextOffset, scannedInCycle, completedCycles, totalTokens: canonical.length };

    await db.update(sourceSyncState).set({
      cursor,
      lastSuccessAt: new Date(),
      status: errors > 0 ? "degraded" : "success",
      recordsProcessed: enriched,
      lastError: errors > 0 ? `${errors} of ${batch.length} metadata requests returned no usable response` : null,
    }).where(stateKey);

    return { processed: batch.length, enriched, errors, completedCycles, scannedInCycle };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.update(sourceSyncState).set({
      lastErrorAt: new Date(),
      lastError: message,
      status: "error",
    }).where(stateKey);
    throw error;
  }
}
