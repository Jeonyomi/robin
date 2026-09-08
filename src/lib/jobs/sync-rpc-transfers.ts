import { and, asc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalAssets, sourceSyncState, tokenTransfers, tokens } from "@/db/schema";
import { getDb } from "@/lib/db";

export type RpcSyncReader = {
  chainId(): Promise<number>;
  head(): Promise<{ number: number; hash: string; timestamp: Date }>;
  block(number: number): Promise<{ number: number; hash: string; timestamp: Date }>;
  range(from: number, to: number, assets: { address: string; decimals: number }[]): Promise<{
    blockNumber: number; blockHash: string; txHash: string; logIndex: number;
    tokenAddress: string; fromAddress: string; toAddress: string; rawValue: string;
    normalizedValue: string; timestamp: Date;
  }[]>;
  readonly calls: number;
};
export type RpcTransferSyncDependencies = {
  getDb?: typeof getDb;
  reader?: RpcSyncReader;
  now?: () => Date;
  acquireLock?: () => Promise<() => Promise<void>>;
};
export type RpcTransferCursor = {
  version: 1; collectionMode: "bounded-recent-rpc"; observationExposureVerified: false;
  chainId: 4663; headBlock: number; safetyDepth: 128; scanFromBlock: number;
  scannedToBlock: number; scannedToHash: string; scannedAt: string;
  latestTransferAt: string | null; eventsFetched: number; eventsInserted: number;
  totalTokens: number; eligibleTokens: number; skippedTokens: number;
  skippedBlocks: number; lastGap: { from: number; to: number } | null;
  assetsFingerprint: string; lookbackHours: 48;
  historyProvenance: "mixed-source-transfer-table";
};
const fail = (code: string) => Object.assign(new Error(code), { code });
function safeCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "RPC_TRANSFER_SYNC_ERROR";
}
/** Exclusive local lock is acquired before DB access; stale locks fail closed. */
export async function acquireRpcTransferLock(): Promise<() => Promise<void>> {
  const path = resolve("data/rpc-transfer-sync.lock");
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try { handle = await open(path, "wx"); } catch { throw fail("RPC_SYNC_LOCKED"); }
  return async () => { await handle.close(); await unlink(path); };
}

export async function syncRpcTransfers(dependencies: RpcTransferSyncDependencies = {}) {
  try { return await runRpcTransferSync(dependencies); }
  catch (error) { throw fail(safeCode(error)); }
}

async function runRpcTransferSync(dependencies: RpcTransferSyncDependencies) {
  const release = await (dependencies.acquireLock ?? acquireRpcTransferLock)();
  try {
    const db = (dependencies.getDb ?? getDb)();
    const now = dependencies.now ?? (() => new Date());
    const key = and(eq(sourceSyncState.source, "rpc"), eq(sourceSyncState.jobName, "token-transfers"));
    let completedChunks = 0, eventsFetched = 0, eventsInserted = 0, eligibleTokens = 0, skippedTokens = 0;
    let accepted: RpcTransferCursor | null = null;
    const result = (failed: boolean) => ({ tokensAttempted: eligibleTokens, tokensSucceeded: completedChunks ? eligibleTokens : 0,
      tokensFailed: failed ? 1 : 0, tokensSkipped: skippedTokens, eventsFetched, eventsInserted,
      scannedBlocks: accepted ? accepted.scannedToBlock - accepted.scanFromBlock + 1 : 0, completedChunks });
    await db.insert(sourceSyncState).values({ source: "rpc", jobName: "token-transfers", lastStartedAt: now(), status: "running" })
      .onConflictDoUpdate({ target: [sourceSyncState.source, sourceSyncState.jobName], set: { lastStartedAt: now(), status: "running" } });
    try {
      const [assets, states] = await Promise.all([
        db.select({ address: canonicalAssets.contractAddress, chainId: canonicalAssets.chainId, decimals: tokens.decimals })
          .from(canonicalAssets).leftJoin(tokens, eq(tokens.address, canonicalAssets.contractAddress))
          .orderBy(asc(canonicalAssets.contractAddress)).limit(257),
        db.select({ cursor: sourceSyncState.cursor }).from(sourceSyncState).where(key).limit(1),
      ]);
      if (assets.length > 256) throw fail("ASSET_LIMIT");
      const eligible = assets.filter((a): a is typeof a & { decimals: number } =>
        a.chainId === 4663 && /^0x[0-9a-f]{40}$/i.test(a.address) && a.decimals !== null && Number.isInteger(a.decimals) && a.decimals >= 0 && a.decimals <= 36)
        .map(a => ({ address: a.address.toLowerCase(), decimals: a.decimals }));
      eligibleTokens = eligible.length; skippedTokens = assets.length - eligibleTokens;
      if (!eligibleTokens) throw fail("NO_ELIGIBLE_ASSETS");
      const fingerprint = createHash("sha256").update(eligible.map(a => `${a.address}:${a.decimals}`).sort().join("\n")).digest("hex");
      const previous = states[0]?.cursor as RpcTransferCursor | null;
      if (previous && (previous.version !== 1 || previous.chainId !== 4663 || previous.collectionMode !== "bounded-recent-rpc" ||
          !Number.isSafeInteger(previous.scannedToBlock) || previous.scannedToBlock < 0 || !/^0x[0-9a-f]{64}$/i.test(previous.scannedToHash) ||
          !/^[0-9a-f]{64}$/.test(previous.assetsFingerprint) || previous.observationExposureVerified !== false || previous.safetyDepth !== 128 || previous.lookbackHours !== 48 ||
          ![previous.skippedBlocks, previous.eventsFetched, previous.eventsInserted, previous.totalTokens, previous.eligibleTokens, previous.skippedTokens, previous.headBlock, previous.scanFromBlock].every(n => Number.isSafeInteger(n) && n >= 0) ||
          previous.scanFromBlock > previous.scannedToBlock || previous.scannedToBlock > previous.headBlock - 128 ||
          !Number.isFinite(Date.parse(previous.scannedAt)) || (previous.latestTransferAt !== null && !Number.isFinite(Date.parse(previous.latestTransferAt))) ||
          (previous.lastGap !== null && (!previous.lastGap || !Number.isSafeInteger(previous.lastGap.from) || !Number.isSafeInteger(previous.lastGap.to) || previous.lastGap.from < 0 || previous.lastGap.to < previous.lastGap.from)))) throw fail("INVALID_CHECKPOINT");
      const reader = dependencies.reader ?? (await import("@/lib/sources/rpc-transfers")).createRpcTransferReader();
      if (await reader.chainId() !== 4663) throw fail("CHAIN_MISMATCH");
      if (previous && (await reader.block(previous.scannedToBlock)).hash.toLowerCase() !== previous.scannedToHash.toLowerCase()) throw fail("REORG_DETECTED");
      const head = await reader.head();
      const target = head.number - 128;
      if (!Number.isSafeInteger(head.number) || head.number < 0) throw fail("INVALID_BLOCK");
      if (previous && target < previous.scannedToBlock) throw fail("HEAD_REGRESSION");
      const lower = Math.max(0, target - 47);
      const changed = previous && previous.assetsFingerprint !== fingerprint;
      const start = previous && !changed ? Math.max(lower, previous.scannedToBlock + 1) : lower;
      if (target < 0 || start > target) throw fail("NO_NEW_BLOCKS");
      const gap = previous && previous.scannedToBlock + 1 < lower ? { from: previous.scannedToBlock + 1, to: lower - 1 } : null;
      const skippedBlocks = (previous?.skippedBlocks ?? 0) + (gap ? gap.to - gap.from + 1 : 0);
      let from = start, width = 8;
      while (from <= target) {
        const to = Math.min(target, from + width - 1);
        let transfers;
        try { transfers = await reader.range(from, to, eligible); }
        catch (error) {
          if (safeCode(error) === "RANGE_LIMIT" && width > 1) { width = Math.max(1, Math.floor(width / 2)); continue; }
          throw error;
        }
        const unique = [...new Map(transfers.map(t => [`${t.txHash}:${t.logIndex}:${t.tokenAddress}`, t])).values()];
        if (eventsFetched + unique.length > 5000) throw fail("EVENT_LIMIT");
        const end = await reader.block(to);
        if (end.number !== to || !/^0x[0-9a-f]{64}$/i.test(end.hash)) throw fail("INVALID_BLOCK");
        if (unique.some(t => t.blockNumber < from || t.blockNumber > to || !eligible.some(a => a.address === t.tokenAddress.toLowerCase()) ||
          (t.blockNumber === to && t.blockHash.toLowerCase() !== end.hash.toLowerCase()))) throw fail("INVALID_RANGE");
        let inserted = 0;
        if (unique.length) {
          const written = await db.insert(tokenTransfers).values(unique.map(t => ({
            blockNumber: t.blockNumber, txHash: t.txHash, logIndex: t.logIndex, tokenAddress: t.tokenAddress.toLowerCase(),
            fromAddress: t.fromAddress, toAddress: t.toAddress, rawValue: t.rawValue,
            normalizedValue: Number.isFinite(Number(t.normalizedValue)) ? Number(t.normalizedValue) : null, timestamp: t.timestamp,
          }))).onConflictDoNothing().returning({ id: tokenTransfers.id });
          inserted = written.length;
        }
        const latest = unique.reduce<string | null>((last, t) => !last || t.timestamp.toISOString() > last ? t.timestamp.toISOString() : last,
          accepted?.latestTransferAt ?? previous?.latestTransferAt ?? null);
        const cursor: RpcTransferCursor = { version: 1, collectionMode: "bounded-recent-rpc", observationExposureVerified: false,
          chainId: 4663, headBlock: head.number, safetyDepth: 128, scanFromBlock: start, scannedToBlock: to, scannedToHash: end.hash,
          scannedAt: now().toISOString(), latestTransferAt: latest, eventsFetched: eventsFetched + unique.length, eventsInserted: eventsInserted + inserted,
          totalTokens: assets.length, eligibleTokens, skippedTokens, skippedBlocks, lastGap: gap ?? previous?.lastGap ?? null,
          assetsFingerprint: fingerprint, lookbackHours: 48, historyProvenance: "mixed-source-transfer-table" };
        // Never advance until the whole chunk is durable. A failed checkpoint replays inserts idempotently.
        await db.update(sourceSyncState).set({ cursor, lastSuccessAt: new Date(cursor.scannedAt), recordsProcessed: cursor.eventsInserted, status: "running" }).where(key);
        accepted = cursor; eventsFetched = cursor.eventsFetched; eventsInserted = cursor.eventsInserted; completedChunks++;
        from = to + 1;
      }
      await db.update(sourceSyncState).set({ status: skippedTokens ? "degraded" : "success",
        lastError: skippedTokens ? `SKIPPED_ASSET_METADATA:${skippedTokens}` : null,
        ...(skippedTokens ? { lastErrorAt: now() } : {}) }).where(key);
      return result(false);
    } catch (error) {
      const code = safeCode(error);
      try { await db.update(sourceSyncState).set({ status: completedChunks ? "degraded" : "error", lastError: code, lastErrorAt: now() }).where(key); }
      catch { throw fail("RPC_STATE_WRITE_FAILED"); }
      if (completedChunks) return result(true);
      throw fail(code);
    }
  } finally { await release(); }
}
