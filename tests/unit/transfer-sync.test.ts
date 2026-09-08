// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalAssets, sourceSyncState, tokenTransfers } from "@/db/schema";
import { getDb } from "@/lib/db";
import { fetchTokenTransfers, type BlockscoutTransfer } from "@/lib/sources/blockscout/transfers";
import { syncTokenTransfers } from "@/lib/jobs/sync-token-transfers";
import { SourceRequestError } from "@/lib/sources/source-request";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/sources/blockscout/transfers", () => ({ fetchTokenTransfers: vi.fn() }));
const address = (index: number) => `0x${index.toString(16).padStart(40, "0")}`;
const oldTime = new Date("2026-09-08T00:00:00Z");
const oldCursor = { nextOffset: 0, scannedInCycle: 0, completedCycles: 3, totalTokens: 8, latestBlock: 123, latestTransferAt: oldTime.toISOString() };
type State = Partial<typeof sourceSyncState.$inferSelect>;
function fakeDatabase(count = 8, cursor: unknown = oldCursor, hot: string[] = []) {
  let state: State = { cursor, lastSuccessAt: oldTime, status: "success" };
  const updates: State[] = [];
  const transfers: (typeof tokenTransfers.$inferInsert)[] = [];
  const insertBatches: (typeof tokenTransfers.$inferInsert)[][] = [];
  const db = {
    insert: (table: unknown) => ({ values: (values: State | (typeof tokenTransfers.$inferInsert)[]) => {
      if (table === tokenTransfers) {
        const rows = values as (typeof tokenTransfers.$inferInsert)[];
        return { onConflictDoNothing: () => ({ returning: async () => {
          insertBatches.push(rows);
          const inserted = [];
          for (const row of rows) {
            if (transfers.some((existing) => existing.txHash === row.txHash && existing.logIndex === row.logIndex && existing.tokenAddress === row.tokenAddress)) continue;
            transfers.push(row);
            inserted.push({ id: transfers.length });
          }
          return inserted;
        } }) };
      }
      expect(table).toBe(sourceSyncState);
      expect(values).toMatchObject({ source: "blockscout", jobName: "token-transfers", status: "running" });
      return { onConflictDoUpdate: async ({ set }: { set: State }) => { state = { ...state, ...set }; } };
    } }),
    select: () => ({ from: (table: unknown) => {
      if (table === canonicalAssets) return { orderBy: async () => Array.from({ length: count }, (_, i) => ({ address: address(i) })) };
      if (table === sourceSyncState) return { where: () => ({ limit: async () => [{ cursor: state.cursor }] }) };
      expect(table).toBe(tokenTransfers);
      return { where: () => ({ groupBy: () => ({ orderBy: () => ({ limit: async () => hot.map((address) => ({ address })) }) }) }) };
    } }),
    update: () => ({ set: (values: State) => ({ where: async () => { updates.push(values); state = { ...state, ...values }; } }) }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { state: () => state, updates, transfers, insertBatches };
}
function transfer(overrides: Partial<BlockscoutTransfer> = {}): BlockscoutTransfer {
  return {
    blockNumber: 456, txHash: `0x${"ab".repeat(32)}`, logIndex: 1,
    tokenAddress: address(0), fromAddress: address(20), toAddress: address(21),
    rawValue: "1000000", normalizedValue: 1, timestamp: new Date("2026-09-08T03:00:00Z"), method: null,
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T04:00:00Z"));
  vi.stubEnv("TRANSFER_SYNC_BATCH_SIZE", "8");
  vi.stubEnv("TRANSFER_SYNC_HOT_TOKENS", "0");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("transfer sync failure truth", () => {
  it.each([503, 429])("persists a nonempty first page before page two fails with HTTP %s", async (status) => {
    const db = fakeDatabase(1);
    const event = transfer();
    vi.stubEnv("TRANSFER_SYNC_MAX_PAGES", "2");
    vi.mocked(fetchTokenTransfers).mockImplementation(async (_token, cursor) => {
      if (cursor) {
        expect(db.transfers).toHaveLength(1); // Durable before requesting the next page.
        throw Object.assign(new Error("unavailable"), { code: "HTTP_ERROR", status });
      }
      return { items: [event, event], nextCursor: { index: 1, blockNumber: 456 } };
    });
    const result = await syncTokenTransfers();
    expect(result).toMatchObject({ tokensAttempted: 1, tokensSucceeded: 0, tokensFailed: 1, tokensSkipped: 0, eventsFetched: 1, eventsInserted: 1, completedCycles: 3, scannedInCycle: 0 });
    expect(result.tokensFailed).toBeGreaterThan(0); // Existing CLI maps this outcome to exit 1.
    expect(db.transfers).toHaveLength(1);
    expect(db.transfers[0]).toMatchObject({ txHash: event.txHash, rawValue: "1000000", timestamp: event.timestamp });
    expect(db.state()).toMatchObject({ status: "degraded", recordsProcessed: 1, lastSuccessAt: new Date(), cursor: {
      nextOffset: 0, scannedInCycle: 0, completedCycles: 3, pendingTokenAddresses: [address(0)],
      eventsFetched: 1, eventsInserted: 1, latestBlock: 456, latestTransferAt: event.timestamp.toISOString(), observationExposureVerified: false,
    } });
    expect(db.state().lastError).toContain(`HTTP ${status}`);
    // Recovery re-fetches but does not double-count durable rows.
    vi.mocked(fetchTokenTransfers).mockResolvedValue({ items: [event], nextCursor: null });
    expect(await syncTokenTransfers()).toMatchObject({ tokensSucceeded: 1, tokensFailed: 0, eventsFetched: 1, eventsInserted: 0, completedCycles: 4 });
    expect(db.transfers).toHaveLength(1);
    expect(db.state()).toMatchObject({ status: "success", cursor: { pendingTokenAddresses: [] } });
  });

  it("keeps a nonempty in-flight page when another concurrent token blocks the source", async () => {
    const db = fakeDatabase();
    const event = transfer();
    vi.stubEnv("TRANSFER_SYNC_MAX_PAGES", "2");
    let releasePage!: () => void;
    const pageReady = new Promise<void>((resolve) => { releasePage = resolve; });
    vi.mocked(fetchTokenTransfers).mockImplementation(async (token) => {
      if (token === address(0)) {
        await pageReady;
        return { items: [event], nextCursor: { index: 1, blockNumber: 456 } };
      }
      releasePage();
      throw new SourceRequestError("cooldown");
    });
    const result = await syncTokenTransfers();
    expect(db.transfers).toHaveLength(1);
    expect(fetchTokenTransfers).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ tokensAttempted: 4, tokensSucceeded: 0, tokensFailed: 4, tokensSkipped: 4, eventsFetched: 1, eventsInserted: 1, completedCycles: 3, scannedInCycle: 0 });
    expect(db.state()).toMatchObject({ status: "degraded", recordsProcessed: 1, lastSuccessAt: new Date(), cursor: {
      nextOffset: 0, completedCycles: 3, scannedInCycle: 0, pendingTokenAddresses: Array.from({ length: 8 }, (_, i) => address(i)),
      latestBlock: 456, latestTransferAt: event.timestamp.toISOString(), eventsFetched: 1, eventsInserted: 1,
    } });
    expect(db.state().lastError).toContain("BATCH_BLOCKED");
  });

  it.each([false, true])("retains newer last-good observations after accepting older rows (later page fails: %s)", async (fails) => {
    const db = fakeDatabase(1);
    const event = transfer({ blockNumber: 100, timestamp: new Date("2026-09-07T23:00:00Z") });
    vi.stubEnv("TRANSFER_SYNC_MAX_PAGES", "2");
    vi.mocked(fetchTokenTransfers).mockImplementation(async (_token, cursor) => {
      if (cursor) throw Object.assign(new Error("unavailable"), { code: "HTTP_ERROR", status: 503 });
      return { items: [event], nextCursor: fails ? { index: 1, blockNumber: 100 } : null };
    });
    expect(await syncTokenTransfers()).toMatchObject({ tokensSucceeded: fails ? 0 : 1, tokensFailed: fails ? 1 : 0, eventsFetched: 1, eventsInserted: 1 });
    expect(db.transfers).toHaveLength(1);
    expect(db.state()).toMatchObject({ status: fails ? "degraded" : "success", cursor: { latestBlock: oldCursor.latestBlock, latestTransferAt: oldCursor.latestTransferAt } });
  });

  it("deduplicates accepted page batches across pages and excludes out-of-window rows", async () => {
    const db = fakeDatabase(1);
    const first = transfer();
    const second = transfer({ logIndex: 2, blockNumber: 455 });
    const expired = transfer({ logIndex: 3, timestamp: new Date("2026-09-01T00:00:00Z") });
    vi.stubEnv("TRANSFER_SYNC_MAX_PAGES", "2");
    vi.mocked(fetchTokenTransfers)
      .mockResolvedValueOnce({ items: [first, first], nextCursor: { index: 1, blockNumber: 456 } })
      .mockResolvedValueOnce({ items: [first, second, expired], nextCursor: null });
    expect(await syncTokenTransfers()).toMatchObject({ tokensSucceeded: 1, eventsFetched: 2, eventsInserted: 2 });
    expect(db.transfers).toHaveLength(2);
    expect(db.insertBatches.map((batch) => batch.length)).toEqual([1, 1]);
    expect(db.state()).toMatchObject({ recordsProcessed: 2, cursor: { latestBlock: 456, latestTransferAt: first.timestamp.toISOString() } });
  });

  it.each(["cooldown", "budget", "state", "wait-budget", "challenge"] as const)("stops pending tokens for source policy %s without hiding its safe cause", async (code) => {
    fakeDatabase();
    vi.mocked(fetchTokenTransfers).mockRejectedValue(new SourceRequestError(code));
    await expect(syncTokenTransfers()).rejects.toThrow(new RegExp(`No usable transfer result: 4 failed, 4 skipped, 4 attempted:.*${code}`));
    expect(fetchTokenTransfers).toHaveBeenCalledTimes(4);
  });

  it("durably retries failed hot tokens even after they fall out of the hot selection", async () => {
    const hot = [address(9)];
    const db = fakeDatabase(10, { ...oldCursor, totalTokens: 10 }, hot);
    vi.stubEnv("TRANSFER_SYNC_HOT_TOKENS", "1");
    vi.mocked(fetchTokenTransfers).mockImplementation(async (token) => {
      if (token === address(9)) throw new Error("upstream failed");
      return { items: [], nextCursor: null };
    });
    await syncTokenTransfers();
    expect(db.state().cursor).toMatchObject({ nextOffset: 0, pendingTokenAddresses: [address(9)] });
    hot.length = 0;
    vi.mocked(fetchTokenTransfers).mockClear().mockResolvedValue({ items: [], nextCursor: null });
    await syncTokenTransfers();
    expect(fetchTokenTransfers).toHaveBeenCalledWith(address(9), undefined);
    expect(db.state().cursor).toMatchObject({ nextOffset: 8, pendingTokenAddresses: [] });
  });

  it.each([503, 429])("queues disappeared hot tokens after zero-success HTTP %s while preserving last-good progress", async (status) => {
    const hot = [address(9)];
    const previous = { ...oldCursor, nextOffset: 2, scannedInCycle: 2, totalTokens: 10, pendingTokenAddresses: [address(8)] };
    const db = fakeDatabase(10, previous, hot);
    vi.stubEnv("TRANSFER_SYNC_BATCH_SIZE", "4");
    vi.stubEnv("TRANSFER_SYNC_HOT_TOKENS", "1");
    vi.mocked(fetchTokenTransfers).mockRejectedValue(Object.assign(new Error("unavailable"), { code: "HTTP_ERROR", status }));
    await expect(syncTokenTransfers()).rejects.toThrow(/No usable transfer result/);
    expect(db.state()).toMatchObject({ status: "error", lastSuccessAt: oldTime, cursor: {
      ...previous, pendingTokenAddresses: expect.arrayContaining([address(8), address(9), ...[2, 3, 4, 5].map(address)]),
      tokensAttempted: status === 429 ? 4 : 6, tokensFailed: status === 429 ? 4 : 6,
      tokensSkipped: status === 429 ? 2 : 0, tokensSucceeded: 0, eventsFetched: 0, eventsInserted: 0,
    } });
    hot.length = 0;
    vi.mocked(fetchTokenTransfers).mockClear().mockResolvedValue({ items: [], nextCursor: null });
    await syncTokenTransfers();
    expect(fetchTokenTransfers).toHaveBeenCalledWith(address(9), undefined);
    expect(fetchTokenTransfers).toHaveBeenCalledWith(address(8), undefined);
    expect(db.state().cursor).toMatchObject({ nextOffset: 6, scannedInCycle: 6, completedCycles: 3, pendingTokenAddresses: [] });
  });

  it("keeps partial rotation at its recovery offset and advances only after a successful retry", async () => {
    const db = fakeDatabase();
    vi.mocked(fetchTokenTransfers).mockImplementation(async (token) => {
      if (token === address(1)) throw Object.assign(new Error("unavailable"), { code: "HTTP_ERROR", status: 503 });
      return { items: [], nextCursor: null };
    });
    expect(await syncTokenTransfers()).toMatchObject({ tokensAttempted: 8, tokensSucceeded: 7, tokensFailed: 1, tokensSkipped: 0, completedCycles: 3, scannedInCycle: 0 });
    expect(db.state()).toMatchObject({ status: "degraded", cursor: { nextOffset: 0, completedCycles: 3, scannedInCycle: 0, tokensAttempted: 8, tokensSucceeded: 7, tokensFailed: 1, observationExposureVerified: false } });
    expect(db.state().lastError).toContain(`${address(1)}: HTTP_ERROR HTTP 503`);
    vi.mocked(fetchTokenTransfers).mockClear().mockResolvedValue({ items: [], nextCursor: null });
    expect(await syncTokenTransfers()).toMatchObject({ tokensAttempted: 8, tokensSucceeded: 8, tokensFailed: 0, completedCycles: 4 });
    expect(fetchTokenTransfers).toHaveBeenCalledWith(address(1), undefined);
    expect(db.state()).toMatchObject({ status: "success", cursor: { observationExposureVerified: false } });
  });

  it.each([403, 429])("stops pending tokens on HTTP %s, allowing only the four in-flight requests", async (status) => {
    const db = fakeDatabase();
    vi.mocked(fetchTokenTransfers).mockRejectedValue(Object.assign(new Error("blocked"), { code: "HTTP_ERROR", status }));
    await expect(syncTokenTransfers()).rejects.toThrow(/No usable transfer result: 4 failed, 4 skipped, 4 attempted/);
    expect(fetchTokenTransfers).toHaveBeenCalledTimes(4);
    expect(db.state()).toMatchObject({ status: "error", cursor: { ...oldCursor, tokensAttempted: 4, tokensFailed: 4, tokensSkipped: 4, tokensSucceeded: 0, pendingTokenAddresses: Array.from({ length: 8 }, (_, i) => address(i)) }, lastSuccessAt: oldTime });
    expect(db.state().lastError).toContain(`HTTP ${status}`);
  });

  it("retains bounded per-token structured causes without leaking raw errors on total failure", async () => {
    const db = fakeDatabase();
    vi.mocked(fetchTokenTransfers).mockRejectedValue(Object.assign(new Error("https://user:secret@example.test/?api_key=SECRET\nprivate response body"), { code: "HTTP_ERROR", status: 503, retryAfterMs: 1200 }));
    await expect(syncTokenTransfers()).rejects.toThrow(/No usable transfer result: 8 failed, 0 skipped, 8 attempted:.*HTTP_ERROR.*503/);
    expect(db.state()).toMatchObject({ status: "error", cursor: { ...oldCursor, tokensAttempted: 8, tokensFailed: 8, tokensSkipped: 0, tokensSucceeded: 0, pendingTokenAddresses: Array.from({ length: 8 }, (_, i) => address(i)) }, lastSuccessAt: oldTime });
    expect(db.state().lastError).toContain(address(0));
    expect(db.state().lastError).not.toMatch(/secret|private|https|\n/i);
    expect(db.state().lastError!.length).toBeLessThanOrEqual(1600);
    expect(db.updates.some((update) => update.cursor !== undefined)).toBe(true);
    expect(db.updates.every((update) => !("lastSuccessAt" in update))).toBe(true);
  });
});
