import { beforeEach, describe, expect, it, vi } from "vitest";
import { stockTokenPriceSnapshots } from "@/db/schema";
import { fetchCanonicalAssets } from "@/lib/sources/robinhood/assets";
import { fetchAllReferencePrices } from "@/lib/sources/robinhood/prices";
import { syncCanonicalAssets } from "@/lib/jobs/sync-canonical-assets";
import { syncReferencePrices } from "@/lib/jobs/sync-reference-prices";
import { address, otherAddress, asset, oldTime, fakeDb } from "./p0-job-db";
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/sources/robinhood/assets", async (original) => ({ ...await original<typeof import("@/lib/sources/robinhood/assets")>(), fetchCanonicalAssets: vi.fn() }));
vi.mock("@/lib/sources/robinhood/prices", async (original) => ({ ...await original<typeof import("@/lib/sources/robinhood/prices")>(), fetchAllReferencePrices: vi.fn() }));
const quote = { symbol: "ABC", deployments: [{ chainId: 4663, contractAddress: address }], rawBid: 10, rawAsk: 12, rawMid: 11, currentMultiplier: null, adjustedReferencePrice: null, tradingHalt: false, referenceTimestamp: oldTime };
function quotes(rows: typeof quote[], rejectedCount = 0) { vi.mocked(fetchAllReferencePrices).mockResolvedValue(Object.assign(rows, { rejectedCount })); }
beforeEach(() => vi.clearAllMocks());
describe("canonical source success P0", () => {
  it("preserves registry and last success when adapter returns zero rows", async () => {
    const db = fakeDb(); vi.mocked(fetchCanonicalAssets).mockResolvedValue([]);
    await expect(syncCanonicalAssets()).rejects.toThrow();
    expect(db.writes).toEqual([]);
    expect(db.state).toMatchObject({ lastSuccessAt: oldTime, status: "error", recordsProcessed: 0 });
  });
  it("rejects an existing registry address on another chain without updating it", async () => {
    const db = fakeDb([{ ...asset, chainId: 1 }]);
    vi.mocked(fetchCanonicalAssets).mockResolvedValue([{ ...asset, pendingMultiplier: null, status: null, tradingCapabilities: null, isin: null, sourceUpdatedAt: null }]);
    await expect(syncCanonicalAssets()).rejects.toThrow();
    expect(db.writes).toHaveLength(0);
    expect(db.state.lastSuccessAt).toEqual(oldTime);
  });
  it("reports partially applied registry writes as degraded without claiming a complete refresh", async () => {
    const db = fakeDb([asset], null, 1);
    vi.mocked(fetchCanonicalAssets).mockResolvedValue([{ ...asset, pendingMultiplier: null, status: null, tradingCapabilities: null, isin: null, sourceUpdatedAt: null }]);
    await expect(syncCanonicalAssets()).rejects.toThrow();
    expect(db.writes).toHaveLength(1);
    expect(db.state).toMatchObject({ recordsProcessed: 1, status: "degraded", lastSuccessAt: oldTime });
  });
  it("does not persist arbitrary source exception text", async () => {
    const db = fakeDb(); vi.mocked(fetchCanonicalAssets).mockRejectedValue(new Error("Bearer secret-token https://api.invalid/?key=secret"));
    await expect(syncCanonicalAssets()).rejects.toThrow();
    expect(db.state.lastError).not.toMatch(/secret|Bearer/);
  });
});
describe("reference persistence P0", () => {
  it.each([
    [{ ...quote, deployments: [{ chainId: 1, contractAddress: address }] }],
    [{ ...quote, deployments: [{ chainId: 4663, contractAddress: otherAddress }] }],
    [],
  ])("does not refresh success for zero exact chain-contract matches %j", async (...rows) => {
    const db = fakeDb(); quotes(rows);
    const result = await syncReferencePrices();
    expect(result.stored).toBe(0);
    expect(db.writes).toEqual([]);
    expect(db.state).toMatchObject({ status: "error", lastSuccessAt: oldTime, recordsProcessed: 0 });
  });
  it("matches contract identity despite a changed ticker", async () => {
    const db = fakeDb(); quotes([{ ...quote, symbol: "RENAMED" }]);
    expect(await syncReferencePrices()).toMatchObject({ stored: 1, errors: 0 });
    expect(db.writes).toEqual([{ table: stockTokenPriceSnapshots, values: expect.objectContaining({ canonicalAssetId: asset.id, adjustedReferencePrice: 5.5, referenceTimestamp: oldTime }) }]);
  });
  it("reports rejected adapter rows as partial success", async () => {
    const db = fakeDb(); quotes([quote], 2);
    expect(await syncReferencePrices()).toEqual({ processed: 3, stored: 1, errors: 2 });
    expect(db.state).toMatchObject({ status: "degraded", recordsProcessed: 1 });
    expect(db.state.lastError).toMatch(/2/);
  });
  it.each([null, new Date("invalid"), new Date("2999-01-01")])("preserves last-good snapshot for unknown or invalid time %s", async (referenceTimestamp) => {
    const db = fakeDb(); quotes([{ ...quote, referenceTimestamp } as typeof quote]);
    expect(await syncReferencePrices()).toMatchObject({ stored: 0, errors: 1 });
    expect(db.writes).toEqual([]);
    expect(db.state.lastSuccessAt).toEqual(oldTime);
  });
  it("rejects ambiguous duplicate quotes instead of publishing conflicting prices", async () => {
    const db = fakeDb(); quotes([quote, { ...quote, rawMid: 50 }]);
    expect(await syncReferencePrices()).toMatchObject({ stored: 0, errors: 2 });
    expect(db.writes).toHaveLength(0);
    expect(db.state.lastSuccessAt).toEqual(oldTime);
  });
  it("does not store a price with an invalid multiplier", async () => {
    const db = fakeDb([{ ...asset, currentMultiplier: "2junk" }]); quotes([quote]);
    expect(await syncReferencePrices()).toMatchObject({ stored: 0, errors: 1 });
    expect(db.writes).toEqual([]);
  });
});
