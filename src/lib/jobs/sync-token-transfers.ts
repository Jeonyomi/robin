import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { canonicalAssets, sourceSyncState, tokenTransfers } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchTokenTransfers, type BlockscoutPageCursor } from "@/lib/sources/blockscout/transfers";
import { isSourceBlocked } from "@/lib/sources/source-request";

const DEFAULT_BATCH_SIZE = 24;
const DEFAULT_HOT_TOKENS = 6;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_LOOKBACK_HOURS = 48;
const CONCURRENCY = 4;
const MAX_SELECTED_TOKENS = 70;

// Never persist response bodies, URLs, credentials, or arbitrary exception text.
function safeFailure(error: unknown): string {
  const detail = error && typeof error === "object"
    ? error as { code?: unknown; status?: unknown; retryAfterMs?: unknown }
    : {};
  const code = typeof detail.code === "string" && /^[A-Z_][A-Z0-9_-]{0,63}$/i.test(detail.code)
    ? detail.code : "TRANSFER_SYNC_ERROR";
  const status = typeof detail.status === "number" && Number.isInteger(detail.status) && detail.status >= 100 && detail.status <= 599
    ? ` HTTP ${detail.status}` : "";
  const retry = typeof detail.retryAfterMs === "number" && Number.isFinite(detail.retryAfterMs) && detail.retryAfterMs >= 0
    ? ` retryAfterMs=${Math.min(Math.floor(detail.retryAfterMs), 86_400_000)}` : "";
  return `${code}${status}${retry}`;
}

class TransferBatchError extends Error {}

function failureSummary(failed: { tokenAddress: string; error: string }[]): string {
  return failed.slice(0, 5).map((item) => `${/^0x[0-9a-f]{40}$/i.test(item.tokenAddress) ? item.tokenAddress : "invalid-token"}: ${item.error}`).join("; ");
}

type TransferSyncCursor = {
  nextOffset: number;
  scannedInCycle: number;
  completedCycles: number;
  totalTokens: number;
  lastBatchSize: number;
  tokensAttempted: number;
  tokensSkipped: number;
  observationExposureVerified: false;
  pendingTokenAddresses: string[];
  tokensSucceeded: number;
  tokensFailed: number;
  eventsFetched: number;
  eventsInserted: number;
  latestBlock: number | null;
  latestTransferAt: string | null;
  lookbackHours: number;
};

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function readCursor(value: unknown): TransferSyncCursor | null {
  if (!value || typeof value !== "object") return null;
  const cursor = value as Partial<TransferSyncCursor>;
  if (!Number.isInteger(cursor.nextOffset) || !Number.isInteger(cursor.completedCycles)) return null;
  return {
    nextOffset: cursor.nextOffset ?? 0,
    scannedInCycle: cursor.scannedInCycle ?? 0,
    completedCycles: cursor.completedCycles ?? 0,
    totalTokens: cursor.totalTokens ?? 0,
    lastBatchSize: cursor.lastBatchSize ?? 0,
    tokensAttempted: cursor.tokensAttempted ?? (cursor.tokensSucceeded ?? 0) + (cursor.tokensFailed ?? 0),
    tokensSkipped: cursor.tokensSkipped ?? 0,
    observationExposureVerified: false,
    pendingTokenAddresses: Array.isArray(cursor.pendingTokenAddresses)
      ? cursor.pendingTokenAddresses.filter((address): address is string => typeof address === "string" && /^0x[0-9a-f]{40}$/i.test(address)).slice(0, MAX_SELECTED_TOKENS).map((address) => address.toLowerCase())
      : [],
    tokensSucceeded: cursor.tokensSucceeded ?? 0,
    tokensFailed: cursor.tokensFailed ?? 0,
    eventsFetched: cursor.eventsFetched ?? 0,
    eventsInserted: cursor.eventsInserted ?? 0,
    latestBlock: cursor.latestBlock ?? null,
    latestTransferAt: cursor.latestTransferAt ?? null,
    lookbackHours: cursor.lookbackHours ?? DEFAULT_LOOKBACK_HOURS,
  };
}

function rotatingSlice<T>(items: T[], offset: number, size: number): T[] {
  if (items.length === 0) return [];
  const count = Math.min(size, items.length);
  return Array.from({ length: count }, (_, index) => items[(offset + index) % items.length]);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>, canStart: () => boolean): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length && canStart()) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results.filter(() => true); // Drop holes for work never started after a block.
}

export async function syncTokenTransfers(): Promise<{
  rotatingTokens: number;
  hotTokens: number;
  tokensAttempted: number;
  tokensSkipped: number;
  tokensSucceeded: number;
  tokensFailed: number;
  eventsFetched: number;
  eventsInserted: number;
  completedCycles: number;
  scannedInCycle: number;
}> {
  const db = getDb();
  const started = new Date();
  const stateKey = and(eq(sourceSyncState.source, "blockscout"), eq(sourceSyncState.jobName, "token-transfers"));
  const batchSize = boundedInt(process.env.TRANSFER_SYNC_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 50);
  const hotLimit = boundedInt(process.env.TRANSFER_SYNC_HOT_TOKENS, DEFAULT_HOT_TOKENS, 0, 20);
  const maxPages = boundedInt(process.env.TRANSFER_SYNC_MAX_PAGES, DEFAULT_MAX_PAGES, 1, 5);
  const lookbackHours = boundedInt(process.env.TRANSFER_SYNC_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS, 1, 168);
  const cutoff = new Date(started.getTime() - lookbackHours * 60 * 60 * 1000);

  await db.insert(sourceSyncState).values({
    source: "blockscout",
    jobName: "token-transfers",
    lastStartedAt: started,
    status: "running",
  }).onConflictDoUpdate({
    target: [sourceSyncState.source, sourceSyncState.jobName],
    set: { lastStartedAt: started, status: "running" },
  });

  try {
    const [assets, stateRows, hotRows] = await Promise.all([
      db.select({ address: canonicalAssets.contractAddress }).from(canonicalAssets).orderBy(asc(canonicalAssets.contractAddress)),
      db.select({ cursor: sourceSyncState.cursor }).from(sourceSyncState).where(stateKey).limit(1),
      db.select({
        address: tokenTransfers.tokenAddress,
        count: sql<number>`count(*)::int`,
      }).from(tokenTransfers)
        .where(gte(tokenTransfers.timestamp, new Date(started.getTime() - 24 * 60 * 60 * 1000)))
        .groupBy(tokenTransfers.tokenAddress)
        .orderBy(desc(sql`count(*)`))
        .limit(hotLimit),
    ]);

    if (assets.length === 0) throw new Error("No canonical tokens are available for transfer sync");

    const previous = readCursor(stateRows[0]?.cursor);
    const startOffset = (previous?.nextOffset ?? 0) % assets.length;
    const rotating = rotatingSlice(assets, startOffset, batchSize).map((item) => item.address.toLowerCase());
    const canonical = new Set(assets.map((item) => item.address.toLowerCase()));
    const pending = (previous?.pendingTokenAddresses ?? []).filter((address) => canonical.has(address));
    const hot = hotRows.map((item) => item.address.toLowerCase()).filter((address) => canonical.has(address) && !rotating.includes(address));
    const selected = [...new Set([...rotating, ...pending, ...hot])].slice(0, MAX_SELECTED_TOKENS);

    let blocked = false;
    const outcomes = await mapWithConcurrency(selected, CONCURRENCY, async (tokenAddress) => {
      let cursor: BlockscoutPageCursor | undefined;
      const seen = new Set<string>();
      const progress = { fetched: 0, inserted: 0, accepted: 0, latestBlock: null as number | null, latestTransferAt: null as Date | null };

      try {
        for (let page = 0; page < maxPages; page++) {
          if (blocked) throw { code: "BATCH_BLOCKED" };
          const result = await fetchTokenTransfers(tokenAddress, cursor);
          const unique = result.items.filter((item) => {
            if (item.timestamp < cutoff) return false;
            const key = `${item.txHash}:${item.logIndex}:${item.tokenAddress}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          progress.fetched += unique.length;
          // Accept validated in-flight data even if another worker has blocked
          // new requests. Persist each page before requesting its successor.
          if (unique.length > 0) {
            const inserted = await db.insert(tokenTransfers).values(unique.map((item) => ({
              blockNumber: item.blockNumber,
              txHash: item.txHash,
              logIndex: item.logIndex,
              tokenAddress: item.tokenAddress,
              fromAddress: item.fromAddress,
              toAddress: item.toAddress,
              rawValue: item.rawValue,
              normalizedValue: item.normalizedValue,
              timestamp: item.timestamp,
            }))).onConflictDoNothing().returning({ id: tokenTransfers.id });
            progress.inserted += inserted.length;
            progress.accepted += unique.length; // Includes already-persisted deduplicated rows.
            progress.latestBlock = unique.reduce<number | null>((max, item) => max === null || item.blockNumber > max ? item.blockNumber : max, progress.latestBlock);
            progress.latestTransferAt = unique.reduce<Date | null>((max, item) => max === null || item.timestamp > max ? item.timestamp : max, progress.latestTransferAt);
          }
          if (!result.nextCursor || result.items.length === 0) break;
          if (result.items[result.items.length - 1]?.timestamp < cutoff) break;
          cursor = result.nextCursor;
        }

        return { ok: true as const, tokenAddress, ...progress };
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error ? error.status : null;
        if (isSourceBlocked(error) || status === 403 || status === 429) blocked = true;
        return {
          ok: false as const,
          tokenAddress,
          ...progress,
          error: safeFailure(error),
        };
      }
    }, () => !blocked);

    const succeeded = outcomes.filter((item) => item.ok);
    const failed = outcomes.filter((item) => !item.ok);
    const tokensSkipped = selected.length - outcomes.length;


    const eventsFetched = outcomes.reduce((sum, item) => sum + item.fetched, 0);
    const eventsInserted = outcomes.reduce((sum, item) => sum + item.inserted, 0);
    const latestBlock = outcomes.reduce<number | null>((max, item) =>
      item.latestBlock !== null && (max === null || item.latestBlock > max) ? item.latestBlock : max, previous?.latestBlock ?? null);
    const latestTransferAt = outcomes.reduce<Date | null>((max, item) =>
      item.latestTransferAt !== null && (max === null || item.latestTransferAt > max) ? item.latestTransferAt : max,
      previous?.latestTransferAt ? new Date(previous.latestTransferAt) : null);

    // A failed batch stays at its recovery offset. Attempts are not successful
    // scans, and neither a successful rotation nor an empty page proves exposure.
    const successfulAddresses = new Set(succeeded.map((item) => item.tokenAddress));
    const pendingTokenAddresses = [...new Set([...pending, ...selected])].filter((address) => !successfulAddresses.has(address));
    const batchComplete = pendingTokenAddresses.length === 0;
    const rawNext = startOffset + rotating.length;
    const wrapped = batchComplete && rawNext >= assets.length;
    const nextOffset = batchComplete ? rawNext % assets.length : startOffset;
    const completedCycles = (previous?.completedCycles ?? 0) + (wrapped ? 1 : 0);
    const scannedInCycle = !batchComplete ? previous?.scannedInCycle ?? 0
      : wrapped ? nextOffset : Math.min(assets.length, (previous?.scannedInCycle ?? 0) + rotating.length);
    const cursor: TransferSyncCursor = {
      nextOffset: succeeded.length === 0 ? previous?.nextOffset ?? startOffset : nextOffset,
      scannedInCycle,
      completedCycles,
      totalTokens: assets.length,
      lastBatchSize: selected.length,
      tokensAttempted: outcomes.length,
      tokensSkipped,
      observationExposureVerified: false,
      pendingTokenAddresses,
      tokensSucceeded: succeeded.length,
      tokensFailed: failed.length,
      eventsFetched,
      eventsInserted,
      latestBlock: latestBlock ?? previous?.latestBlock ?? null,
      latestTransferAt: latestTransferAt?.toISOString() ?? previous?.latestTransferAt ?? null,
      lookbackHours,
    };

    if (succeeded.length === 0 && !outcomes.some((item) => item.accepted > 0)) {
      // Persist recovery work even when the hot list changes before the retry.
      // The error handler records the safe cause without changing last success.
      await db.update(sourceSyncState).set({ cursor, recordsProcessed: 0, status: "error" }).where(stateKey);
      throw new TransferBatchError(`No usable transfer result: ${failed.length} failed, ${tokensSkipped} skipped, ${outcomes.length} attempted: ${failureSummary(failed)}`);
    }

    await db.update(sourceSyncState).set({
      cursor,
      lastSuccessAt: new Date(),
      recordsProcessed: eventsInserted,
      status: batchComplete ? "success" : "degraded",
      ...(!batchComplete ? { lastErrorAt: new Date() } : {}),
      lastError: !batchComplete
        ? `${outcomes.length} attempted; ${succeeded.length} succeeded; ${failed.length} failed; ${tokensSkipped} skipped: ${failureSummary(failed)}`
        : null,
    }).where(stateKey);

    return {
      rotatingTokens: rotating.length,
      hotTokens: hot.length,
      tokensAttempted: outcomes.length,
      tokensSkipped,
      tokensSucceeded: succeeded.length,
      tokensFailed: failed.length,
      eventsFetched,
      eventsInserted,
      completedCycles,
      scannedInCycle,
    };
  } catch (error) {
    const message = error instanceof TransferBatchError ? error.message : safeFailure(error);
    await db.update(sourceSyncState).set({
      lastErrorAt: new Date(),
      lastError: message,
      status: "error",
    }).where(stateKey);
    throw new TransferBatchError(message);
  }
}
