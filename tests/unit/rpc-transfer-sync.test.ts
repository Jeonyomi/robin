// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { canonicalAssets, sourceSyncState, tokenTransfers } from "@/db/schema";
import { syncRpcTransfers } from "@/lib/jobs/sync-rpc-transfers";
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => { throw Error("REAL DB FORBIDDEN"); }) }));
const address = `0x${"11".repeat(20)}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const now = new Date("2026-09-09T00:00:00Z");
type FakeState = { cursor: import("@/lib/jobs/sync-rpc-transfers").RpcTransferCursor; lastSuccessAt: Date; lastError?: string };
type TransferRow = typeof tokenTransfers.$inferInsert;
function fixture(cursor: unknown = null) {
  let state: FakeState = { cursor: cursor as FakeState["cursor"], lastSuccessAt: new Date(0) };
  const rows: TransferRow[] = [], updates: Partial<FakeState>[] = [];
  const assets: { address: string; decimals: number | null; chainId: number }[] = [{ address, decimals: 6, chainId: 4663 }];
  let failWrite = false, failCheckpoint = false;
  const db = {
    select: () => ({ from: (table: unknown) => table === canonicalAssets
      ? { leftJoin: () => ({ orderBy: () => ({ limit: async () => assets }) }) }
      : { where: () => ({ limit: async () => [state] }) } }),
    insert: (table: unknown) => ({ values: (values: unknown) => table === sourceSyncState
      ? { onConflictDoUpdate: async ({ set }: { set: Partial<FakeState> }) => { expect((values as { source: string }).source).toBe("rpc"); state = { ...state, ...set }; } }
      : { onConflictDoNothing: () => ({ returning: async () => {
        expect(table).toBe(tokenTransfers);
        if (failWrite) throw Error("secret db URL");
        const inserted: { id: number }[] = [];
        for (const row of values as TransferRow[]) if (!rows.some(r => r.txHash === row.txHash && r.logIndex === row.logIndex && r.tokenAddress === row.tokenAddress)) { rows.push(row); inserted.push({ id: rows.length }); }
        return inserted;
      } }) } }),
    update: () => ({ set: (value: Partial<FakeState>) => ({ where: async () => {
      if (value.cursor && failCheckpoint) throw Error("checkpoint write failed");
      updates.push(value); state = { ...state, ...value };
    } }) }),
  };
  const block = async (number: number) => ({ number, hash: hash(number), timestamp: now });
  const reader = { chainId: async () => 4663, head: async () => block(1000), block: vi.fn(block), range: vi.fn(async (...args: [number, number, { address: string; decimals: number }[]]) => { void args; return [] as ReturnType<typeof event>[]; }), calls: 0 };
  // The fake implements only the fluent operations exercised by this collector.
  const dependencies = { getDb: () => db as unknown as ReturnType<typeof import("@/lib/db").getDb>, reader, now: () => now, acquireLock: async () => async () => {} };
  return { db, dependencies, reader, rows, updates, assets, state: () => state, failWrite: () => { failWrite = true; }, failCheckpoint: (v: boolean) => { failCheckpoint = v; } };
}
function event(n: number, logIndex = 0) { return { blockNumber: n, blockHash: hash(n), txHash: hash(n), logIndex, tokenAddress: address, fromAddress: address, toAddress: address, rawValue: "1000001", normalizedValue: "1.000001", timestamp: now }; }
describe("bounded recent RPC checkpoint", () => {
  it("bounds dense samples to 48 blocks within the normal daily call budget", async () => {
    const f = fixture();
    await syncRpcTransfers(f.dependencies);
    f.reader.head = async () => ({ number: 1200, hash: hash(1200), timestamp: now });
    f.reader.range.mockClear(); f.reader.block.mockClear();
    f.reader.range.mockImplementation(async (from, to) => Array.from({ length: to - from + 1 }, (_, i) => event(from + i)));
    expect(await syncRpcTransfers(f.dependencies)).toMatchObject({ scannedBlocks: 48, completedChunks: 6, eventsFetched: 48 });
    expect(f.reader.range.mock.calls.map(c => c.slice(0, 2))).toEqual([[1025,1032],[1033,1040],[1041,1048],[1049,1056],[1057,1064],[1065,1072]]);
    // Chain/head + prior checkpoint/fresh end checks + logs + one header per dense block.
    const normalCalls = 2 + f.reader.block.mock.calls.length + f.reader.range.mock.calls.length + f.rows.length;
    expect(normalCalls).toBe(63);
    expect(normalCalls * 144).toBe(9072);
    expect(normalCalls * 144).toBeLessThan(10000);
  });
  it.each(["getDb", "initial upsert", "acquire", "release", "release after failure"])("sanitizes the whole boundary: %s", async stage => {
    const f = fixture();
    const secret = stage === "getDb" ? "secret db URL" : `secret ${stage} URL`;
    const release = vi.fn(async () => { if (stage.startsWith("release")) throw Error(secret); });
    const getDb = vi.fn(() => {
      if (stage === "getDb") throw Error(secret);
      return f.dependencies.getDb();
    });
    const acquireLock = vi.fn(async () => {
      if (stage === "acquire") throw Error(secret);
      return release;
    });
    if (stage === "initial upsert") vi.spyOn(f.db, "insert").mockReturnValue({
      values: () => ({ onConflictDoUpdate: async () => { throw Error(secret); } }),
    });
    if (stage === "release after failure") f.assets.length = 0;
    const error = await syncRpcTransfers({ ...f.dependencies, getDb, acquireLock }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("RPC_TRANSFER_SYNC_ERROR");
    expect(error.code).toBe("RPC_TRANSFER_SYNC_ERROR");
    expect(error.message).not.toContain(secret);
    expect(acquireLock).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(stage === "acquire" ? 0 : 1);
    if (stage === "acquire") expect(getDb).not.toHaveBeenCalled();
    if (stage === "release") expect(f.state()).toMatchObject({ status: "success", cursor: { scannedToBlock: 872 } });
  });
  it("reports excluded metadata as degraded while keeping accepted scan time", async () => {
    const f = fixture(); f.assets.push({ address, decimals: null, chainId: 4663 });
    await syncRpcTransfers(f.dependencies);
    expect(f.state()).toMatchObject({ status: "degraded", lastError: "SKIPPED_ASSET_METADATA:1", lastSuccessAt: now });
  });
  it("never regresses the checkpoint when head regresses and registry changes", async () => {
    const f = fixture(); await syncRpcTransfers(f.dependencies); const previous = f.state().cursor;
    f.assets[0].decimals = 8; f.reader.head = async () => ({ number: 900, hash: hash(900), timestamp: now });
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("HEAD_REGRESSION");
    expect(f.state().cursor).toEqual(previous);
  });
  it.each([NaN, -1, Infinity])("rejects corrupt skippedBlocks %s", async skippedBlocks => {
    const f = fixture(); await syncRpcTransfers(f.dependencies); f.state().cursor.skippedBlocks = skippedBlocks;
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("INVALID_CHECKPOINT");
  });
  it("replays persisted rows after checkpoint failure without duplicates", async () => {
    const f = fixture(); f.reader.range.mockImplementation(async from => [event(from)]);
    f.failCheckpoint(true);
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("RPC_TRANSFER_SYNC_ERROR");
    expect(f.rows).toHaveLength(1); expect(f.state().cursor).toBeNull();
    f.failCheckpoint(false);
    expect(await syncRpcTransfers(f.dependencies)).toMatchObject({ eventsFetched: 6, eventsInserted: 5 });
    expect(f.rows).toHaveLength(6);
    expect(f.rows[0]).toMatchObject({ rawValue: "1000001", normalizedValue: 1.000001 });
  });
  it("does not advance or leak errors after a failed transfer insert", async () => {
    const f = fixture(); f.reader.range.mockResolvedValue([event(825)]); f.failWrite();
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("RPC_TRANSFER_SYNC_ERROR");
    expect(f.state().cursor).toBeNull(); expect(f.state().lastSuccessAt).toEqual(new Date(0));
    expect(f.state().lastError).not.toContain("secret");
  });
  it("stops a reorg before any transfer write and preserves last good checkpoint", async () => {
    const f = fixture(); await syncRpcTransfers(f.dependencies);
    const previous = f.state().cursor;
    f.reader.block.mockImplementation(async n => ({ number: n, hash: hash(1), timestamp: now }));
    f.reader.range.mockClear();
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("REORG_DETECTED");
    expect(f.reader.range).not.toHaveBeenCalled(); expect(f.state().cursor).toEqual(previous);
  });
  it("records cumulative gaps and does not attempt continuous catchup", async () => {
    const f = fixture(); await syncRpcTransfers(f.dependencies);
    f.reader.head = async () => ({ number: 1200, hash: hash(1200), timestamp: now });
    await syncRpcTransfers(f.dependencies);
    expect(f.state().cursor).toMatchObject({ scanFromBlock: 1025, scannedToBlock: 1072, skippedBlocks: 152, lastGap: { from: 873, to: 1024 } });
  });
  it("rejects invalid decimals and wrong chain without defaulting to 18", async () => {
    const f = fixture(); f.assets.push({ address, decimals: null, chainId: 4663 }, { address, decimals: 37, chainId: 4663 }, { address, decimals: 6, chainId: 1 });
    expect(await syncRpcTransfers(f.dependencies)).toMatchObject({ tokensSkipped: 3, tokensSucceeded: 1 });
    f.assets.splice(0, 1);
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("NO_ELIGIBLE_ASSETS");
  });
  it("returns a degraded nonzero-compatible result after a completed chunk", async () => {
    const f = fixture(); f.reader.range.mockImplementation(async from => { if (from > 825) throw { code: "RPC_BUDGET" }; return [event(from)]; });
    expect(await syncRpcTransfers(f.dependencies)).toMatchObject({ tokensSucceeded: 1, tokensFailed: 1, eventsInserted: 1 });
    expect(f.state()).toMatchObject({ status: "degraded", cursor: { scannedToBlock: 832 } });
  });
  it("halves limited ranges without jumping forward", async () => {
    const f = fixture(); f.reader.range.mockImplementation(async (from, to) => { if (to - from >= 2) throw { code: "RANGE_LIMIT" }; return []; });
    await syncRpcTransfers(f.dependencies);
    expect(f.reader.range.mock.calls.slice(0, 3).map(c => c.slice(0, 2))).toEqual([[825,832],[825,828],[825,826]]);
    expect(f.state().cursor.scannedToBlock).toBe(872);
  });
  it("never accepts more than 5000 events or advances the rejected chunk", async () => {
    const f = fixture(); f.reader.range.mockImplementation(async from => Array.from({ length: 2000 }, (_, i) => event(from, i)));
    expect(await syncRpcTransfers(f.dependencies)).toMatchObject({ eventsFetched: 4000, eventsInserted: 4000, tokensFailed: 1 });
    expect(f.state().cursor.scannedToBlock).toBe(840);
  });
  it("fails closed above the canonical asset cap", async () => {
    const f = fixture(); f.assets.push(...Array.from({ length: 256 }, () => ({ address, decimals: 6, chainId: 4663 })));
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("ASSET_LIMIT"); expect(f.reader.range).not.toHaveBeenCalled();
  });
  it("obtains the lock before DB acquisition and releases it on failure", async () => {
    const f = fixture(), release = vi.fn(async () => {}), getDb = vi.fn(f.dependencies.getDb);
    await expect(syncRpcTransfers({ ...f.dependencies, getDb, acquireLock: async () => { throw Object.assign(Error("secret lock path"), { code: "RPC_SYNC_LOCKED" }); } })).rejects.toThrow(/^RPC_SYNC_LOCKED$/);
    expect(getDb).not.toHaveBeenCalled();
    f.assets.length = 0;
    await expect(syncRpcTransfers({ ...f.dependencies, acquireLock: async () => release })).rejects.toThrow("NO_ELIGIBLE_ASSETS"); expect(release).toHaveBeenCalledOnce();
  });
  it("does not claim a fresh success when no new blocks exist", async () => {
    const f = fixture(); await syncRpcTransfers(f.dependencies); const old = f.state().cursor;
    await expect(syncRpcTransfers(f.dependencies)).rejects.toThrow("NO_NEW_BLOCKS"); expect(f.state().cursor).toEqual(old);
  });
  it("rescans the recent snapshot on registry changes, never verifying exposure", async () => {
    const f = fixture(); await syncRpcTransfers(f.dependencies); const old = f.state().cursor.assetsFingerprint;
    f.assets[0].decimals = 8;
    await syncRpcTransfers(f.dependencies);
    expect(f.state().cursor.assetsFingerprint).not.toBe(old);
    expect(f.state().cursor).toMatchObject({ scanFromBlock: 825, observationExposureVerified: false });
  });
  it("verifies empty chunks and records sample scope without claiming exposure", async () => {
    const f = fixture();
    expect(await syncRpcTransfers(f.dependencies)).toMatchObject({ tokensSucceeded: 1, eventsFetched: 0, eventsInserted: 0 });
    expect(f.reader.range).toHaveBeenCalledTimes(6);
    expect(f.state()).toMatchObject({ status: "success", cursor: { collectionMode: "bounded-recent-rpc", observationExposureVerified: false, scanFromBlock: 825, scannedToBlock: 872, scannedToHash: hash(872), safetyDepth: 128, latestTransferAt: null } });
  });
});
