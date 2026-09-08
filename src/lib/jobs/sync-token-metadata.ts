import { and, asc, eq } from "drizzle-orm";
import { canonicalAssets, tokens, tokenMetricSnapshots, sourceSyncState } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchTokenMetadata } from "@/lib/sources/blockscout/token";
import { isSourceBlocked, SourceRequestError } from "@/lib/sources/source-request";

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
  let attempted = 0;

  try {
    const [canonical, stateRows] = await Promise.all([
      db.select().from(canonicalAssets).orderBy(asc(canonicalAssets.contractAddress)),
      db.select({ cursor: sourceSyncState.cursor }).from(sourceSyncState).where(stateKey).limit(1),
    ]);
    if (canonical.length === 0) throw new Error("No canonical tokens are available for metadata sync");

    const previous = readCursor(stateRows[0]?.cursor);
    const startOffset = (previous?.nextOffset ?? 0) % canonical.length;
    const batch = rotatingSlice(canonical, startOffset, batchSize);

    const failures: Record<string, number> = {};
    const failed = (reason: string) => { errors++; failures[reason] = (failures[reason] ?? 0) + 1; };
    for (const asset of batch) {
      attempted++;
      try {
        const meta = await fetchTokenMetadata(asset.contractAddress);
        if (!meta) { failed("not-found"); continue; }
        if (meta.address.toLowerCase() !== asset.contractAddress.toLowerCase()) { failed("identity"); continue; }
        // Null is unobserved, not a verified removal. Keep known token fields,
        // but never copy old values into a newly timestamped metric observation.
        const observed = {
          ...(meta.symbol ? { symbol: meta.symbol } : {}),
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.decimals !== null ? { decimals: meta.decimals } : {}),
          ...(meta.tokenType ? { tokenType: meta.tokenType } : {}),
          ...(meta.isVerified !== null ? { isVerified: meta.isVerified } : {}),
          ...(meta.isProxy !== null ? { isProxy: meta.isProxy } : {}),
          ...(meta.implementationAddress !== null ? { implementationAddress: meta.implementationAddress } : {}),
        };
        const volumeUsd = meta.volume24h !== null && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(meta.volume24h) && Number.isFinite(Number(meta.volume24h))
          ? Number(meta.volume24h) : null;
        const holderCount = meta.holdersCount !== null && Number.isSafeInteger(meta.holdersCount) && meta.holdersCount >= 0
          ? meta.holdersCount : null;
        if (Object.keys(observed).length === 0 && holderCount === null && volumeUsd === null) { failed("no-observations"); continue; }
        const updatedTokens = await db.update(tokens).set({ ...observed, canonicalStatus: "CANONICAL", lastSeenAt: new Date() })
          .where(eq(tokens.address, asset.contractAddress.toLowerCase()))
          .returning({ address: tokens.address });
        // A successful SQL statement can update zero rows. Such a no-op is not
        // an enrichment and must not refresh source success or mint metrics.
        if (updatedTokens.length === 0) { failed("token-not-stored"); continue; }
        if (holderCount !== null || volumeUsd !== null) {
          await db.insert(tokenMetricSnapshots).values({
            tokenAddress: asset.contractAddress.toLowerCase(), window: "24h", holderCount, volumeUsd,
            dataCompleteness: holderCount === null ? 0.35 : 0.6, calculatedAt: new Date(),
          });
        }
        enriched++;
      } catch (error) {
        failed(error instanceof SourceRequestError ? `${error.code}/HTTP-${error.status ?? "unknown"}` : "request-or-persistence");
        if (isSourceBlocked(error)) break;
      }
    }

    const rawNext = startOffset + attempted;
    const wrapped = rawNext >= canonical.length;
    const nextOffset = rawNext % canonical.length;
    const completedCycles = (previous?.completedCycles ?? 0) + (enriched > 0 && wrapped ? 1 : 0);
    const scannedInCycle = enriched === 0 ? (previous?.scannedInCycle ?? 0)
      : wrapped ? nextOffset : Math.min(canonical.length, (previous?.scannedInCycle ?? 0) + attempted);
    const cursor: MetadataCursor = { nextOffset, scannedInCycle, completedCycles, totalTokens: canonical.length };

    await db.update(sourceSyncState).set({
      ...(enriched > 0 ? { cursor, lastSuccessAt: new Date() } : {}),
      status: enriched === 0 ? "error" : errors > 0 ? "degraded" : "success",
      recordsProcessed: enriched,
      lastError: errors > 0 ? `${errors} of ${attempted} metadata requests failed; ${enriched} succeeded; ${batch.length - attempted} unattempted (${Object.entries(failures).map(([reason, count]) => `${reason}=${count}`).join(", ")})` : null,
      ...(errors > 0 ? { lastErrorAt: new Date() } : {}),
    }).where(stateKey);

    return { processed: attempted, enriched, errors, completedCycles, scannedInCycle };
  } catch (error) {
    const message = error instanceof SourceRequestError
      ? `Metadata request failed (${error.code}; HTTP ${error.status ?? "unknown"})`
      : "Metadata sync failed (registry or persistence error)";
    await db.update(sourceSyncState).set({
      lastErrorAt: new Date(),
      lastError: message,
      status: enriched > 0 ? "degraded" : "error",
      recordsProcessed: enriched,
      ...(enriched > 0 ? { lastSuccessAt: new Date() } : {}),
    }).where(stateKey);
    throw new Error(message);
  }
}
