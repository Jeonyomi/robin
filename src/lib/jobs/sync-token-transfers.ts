import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { canonicalAssets, sourceSyncState, tokenTransfers } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchTokenTransfers, type BlockscoutPageCursor } from "@/lib/sources/blockscout/transfers";

const DEFAULT_BATCH_SIZE = 24;
const DEFAULT_HOT_TOKENS = 6;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_LOOKBACK_HOURS = 48;
const CONCURRENCY = 4;

type TransferSyncCursor = {
  nextOffset: number;
  scannedInCycle: number;
  completedCycles: number;
  totalTokens: number;
  lastBatchSize: number;
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

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function syncTokenTransfers(): Promise<{
  rotatingTokens: number;
  hotTokens: number;
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
    const hot = hotRows.map((item) => item.address.toLowerCase()).filter((address) => !rotating.includes(address));
    const selected = [...rotating, ...hot];

    const outcomes = await mapWithConcurrency(selected, CONCURRENCY, async (tokenAddress) => {
      let cursor: BlockscoutPageCursor | undefined;
      const fetched = [];

      try {
        for (let page = 0; page < maxPages; page++) {
          const result = await fetchTokenTransfers(tokenAddress, cursor);
          fetched.push(...result.items.filter((item) => item.timestamp >= cutoff));
          if (!result.nextCursor || result.items.length === 0) break;
          if (result.items[result.items.length - 1]?.timestamp < cutoff) break;
          cursor = result.nextCursor;
        }

        const unique = Array.from(
          new Map(fetched.map((item) => [`${item.txHash}:${item.logIndex}:${item.tokenAddress}`, item])).values(),
        );
        const inserted = unique.length === 0
          ? []
          : await db.insert(tokenTransfers).values(unique.map((item) => ({
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

        return {
          ok: true as const,
          tokenAddress,
          fetched: unique.length,
          inserted: inserted.length,
          latestBlock: unique.reduce<number | null>((max, item) => max === null || item.blockNumber > max ? item.blockNumber : max, null),
          latestTransferAt: unique.reduce<Date | null>((max, item) => max === null || item.timestamp > max ? item.timestamp : max, null),
        };
      } catch (error) {
        return {
          ok: false as const,
          tokenAddress,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });

    const succeeded = outcomes.filter((item) => item.ok);
    const failed = outcomes.filter((item) => !item.ok);
    if (succeeded.length === 0) throw new Error(`All ${selected.length} token transfer requests failed`);

    const eventsFetched = succeeded.reduce((sum, item) => sum + item.fetched, 0);
    const eventsInserted = succeeded.reduce((sum, item) => sum + item.inserted, 0);
    const latestBlock = succeeded.reduce<number | null>((max, item) =>
      item.latestBlock !== null && (max === null || item.latestBlock > max) ? item.latestBlock : max, null);
    const latestTransferAt = succeeded.reduce<Date | null>((max, item) =>
      item.latestTransferAt !== null && (max === null || item.latestTransferAt > max) ? item.latestTransferAt : max, null);

    const rawNext = startOffset + rotating.length;
    const wrapped = rawNext >= assets.length;
    const nextOffset = rawNext % assets.length;
    const completedCycles = (previous?.completedCycles ?? 0) + (wrapped ? 1 : 0);
    const scannedInCycle = wrapped ? nextOffset : Math.min(assets.length, (previous?.scannedInCycle ?? 0) + rotating.length);
    const cursor: TransferSyncCursor = {
      nextOffset,
      scannedInCycle,
      completedCycles,
      totalTokens: assets.length,
      lastBatchSize: selected.length,
      tokensSucceeded: succeeded.length,
      tokensFailed: failed.length,
      eventsFetched,
      eventsInserted,
      latestBlock,
      latestTransferAt: latestTransferAt?.toISOString() ?? null,
      lookbackHours,
    };

    await db.update(sourceSyncState).set({
      cursor,
      lastSuccessAt: new Date(),
      recordsProcessed: eventsInserted,
      status: failed.length > 0 ? "degraded" : "success",
      lastError: failed.length > 0
        ? failed.slice(0, 5).map((item) => `${item.tokenAddress}: ${item.error}`).join("; ")
        : null,
    }).where(stateKey);

    return {
      rotatingTokens: rotating.length,
      hotTokens: hot.length,
      tokensSucceeded: succeeded.length,
      tokensFailed: failed.length,
      eventsFetched,
      eventsInserted,
      completedCycles,
      scannedInCycle,
    };
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
