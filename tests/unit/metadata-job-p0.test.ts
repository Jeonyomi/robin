import { beforeEach, describe, expect, it, vi } from "vitest";
import { tokenMetricSnapshots, tokens } from "@/db/schema";
import { fetchTokenMetadata, type BlockscoutToken } from "@/lib/sources/blockscout/token";
import { SourceRequestError } from "@/lib/sources/source-request";
import { syncTokenMetadata } from "@/lib/jobs/sync-token-metadata";
import { address, otherAddress, asset, oldTime, fakeDb } from "./p0-job-db";
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/sources/blockscout/token", () => ({ fetchTokenMetadata: vi.fn() }));
const cursor = { nextOffset: 0, completedCycles: 4, scannedInCycle: 0, totalTokens: 3 };
const canonical = [asset, { ...asset, id: "rhj-2", contractAddress: otherAddress }, { ...asset, id: "rhj-3", contractAddress: "0x" + "c".repeat(40) }];
const meta: BlockscoutToken = { address, symbol: null, name: null, decimals: null, tokenType: null, totalSupply: null, holdersCount: 12, exchangeRate: null, marketCap: null, volume24h: null, isVerified: null, isProxy: null, implementationAddress: null, transfersCount: null };
beforeEach(() => { vi.resetAllMocks(); });
describe("metadata job truthful progress P0", () => {
  it("catches individual failures and reports partial attempted/succeeded counts", async () => {
    const db = fakeDb(canonical, cursor);
    vi.mocked(fetchTokenMetadata).mockRejectedValueOnce(new Error("bad response secret")).mockResolvedValueOnce({ ...meta, address: otherAddress }).mockResolvedValueOnce(null);
    expect(await syncTokenMetadata()).toMatchObject({ processed: 3, enriched: 1, errors: 2 });
    expect(fetchTokenMetadata).toHaveBeenCalledTimes(3);
    expect(db.state).toMatchObject({ status: "degraded", recordsProcessed: 1 });
    expect(db.state.lastError).toMatch(/2 of 3/);
    expect(db.state.lastError).not.toMatch(/secret/);
    expect(db.state.lastSuccessAt).not.toEqual(oldTime);
  });
  it.each([null, new Error("bad response")])("retains cursor and last success when every token fails (%s)", async (response) => {
    const db = fakeDb(canonical, cursor);
    if (response instanceof Error) vi.mocked(fetchTokenMetadata).mockRejectedValue(response);
    else vi.mocked(fetchTokenMetadata).mockResolvedValue(response);
    expect(await syncTokenMetadata()).toMatchObject({ processed: 3, enriched: 0, errors: 3, completedCycles: 4, scannedInCycle: 0 });
    expect(db.state).toMatchObject({ cursor, lastSuccessAt: oldTime, status: "error", recordsProcessed: 0 });
    expect(db.writes).toEqual([]);
  });
  it("stops the batch on a blocked source without advancing all-failed cursor", async () => {
    const db = fakeDb(canonical, cursor);
    vi.mocked(fetchTokenMetadata).mockRejectedValue(new SourceRequestError("http", 429, 60000));
    expect(await syncTokenMetadata()).toMatchObject({ processed: 1, enriched: 0, errors: 1 });
    expect(fetchTokenMetadata).toHaveBeenCalledTimes(1);
    expect(db.state).toMatchObject({ cursor, lastSuccessAt: oldTime, status: "error" });
    expect(db.state.lastError).toMatch(/429/);
  });
  it("advances only attempted positions after a partial blocked batch", async () => {
    const db = fakeDb(canonical, cursor);
    vi.mocked(fetchTokenMetadata).mockResolvedValueOnce(meta).mockRejectedValue(new SourceRequestError("http", 403));
    expect(await syncTokenMetadata()).toMatchObject({ processed: 2, enriched: 1, errors: 1 });
    expect(fetchTokenMetadata).toHaveBeenCalledTimes(2);
    expect(db.state).toMatchObject({ status: "degraded", cursor: { nextOffset: 2, completedCycles: 4, scannedInCycle: 2 } });
  });
  it("does not overwrite known fields with unverified nulls or copy old metrics into new snapshots", async () => {
    const db = fakeDb([asset], cursor); vi.mocked(fetchTokenMetadata).mockResolvedValue(meta);
    await syncTokenMetadata();
    expect(db.token).toMatchObject({ decimals: 18, isVerified: true, isProxy: true, implementationAddress: otherAddress });
    const update = db.writes.find((write) => write.table === tokens)?.values;
    expect(update).not.toHaveProperty("isVerified");
    expect(update).not.toHaveProperty("name");
    const snapshot = db.writes.find((write) => write.table === tokenMetricSnapshots)?.values;
    expect(snapshot).toMatchObject({ holderCount: 12, volumeUsd: null });
  });
  it("does not enrich a token from another address", async () => {
    const db = fakeDb([asset], cursor); vi.mocked(fetchTokenMetadata).mockResolvedValue({ ...meta, address: otherAddress });
    expect(await syncTokenMetadata()).toMatchObject({ enriched: 0, errors: 1 });
    expect(db.writes).toEqual([]);
    expect(db.state.lastSuccessAt).toEqual(oldTime);
  });
  it("does not claim success when metadata update matches no stored token", async () => {
    const db = fakeDb([asset], cursor, Infinity, false);
    vi.mocked(fetchTokenMetadata).mockResolvedValue({ ...meta, holdersCount: null, symbol: "ABC" });
    expect(await syncTokenMetadata()).toMatchObject({ enriched: 0, errors: 1 });
    expect(db.state).toMatchObject({ lastSuccessAt: oldTime, status: "error", cursor });
  });
  it("does not create empty metric snapshots when metrics are unknown", async () => {
    const db = fakeDb([asset], cursor); vi.mocked(fetchTokenMetadata).mockResolvedValue({ ...meta, holdersCount: null });
    await syncTokenMetadata();
    expect(db.writes.filter((write) => write.table === tokenMetricSnapshots)).toEqual([]);
  });
});
