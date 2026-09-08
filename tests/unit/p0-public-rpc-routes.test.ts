import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ position: vi.fn(), pool: vi.fn(), discovery: vi.fn() }));
vi.mock("@/lib/sources/uniswap-v3/position", () => ({ fetchLpPosition: mocks.position, isValidLpTokenId: (v: string) => /^[1-9][0-9]*$/.test(v) }));
vi.mock("@/lib/sources/meme-stock-discovery", () => ({ discoverStockPairs: mocks.discovery }));
vi.mock("@/lib/sources/meme-stock-onchain", () => ({ inspectStockPool: mocks.pool, inspectStockPositions: mocks.pool }));
const poolId = `0x${"1".repeat(40)}`;
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T00:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("public RPC route admission integration", () => {
  it("coalesces repeat legacy requests and blocks a simultaneous Meme inspection", async () => {
    const legacy = await import("@/app/api/v1/lp-position/route");
    const meme = await import("@/app/api/v1/meme-stock-pairs/route");
    let release!: (value: unknown) => void;
    mocks.position.mockImplementation(() => new Promise(r => { release = r; }));
    mocks.discovery.mockResolvedValue({ pairs: [{ id: poolId, protocol: "uniswap-v3" }] });
    const a = legacy.GET(new Request("https://test/api?tokenId=1"));
    const b = legacy.GET(new Request("https://test/api?tokenId=1"));
    await Promise.resolve();
    const blocked = await meme.GET(new Request(`https://test/api?pool=${poolId}`));
    expect(blocked.status).toBe(429);
    expect(mocks.pool).not.toHaveBeenCalled();
    release({ observedAt: new Date().toISOString() });
    expect((await a).status).toBe(200); expect((await b).status).toBe(200);
    expect(mocks.position).toHaveBeenCalledTimes(1);
    const cached = await legacy.GET(new Request("https://test/api?tokenId=1"));
    expect(cached.status).toBe(200); expect(mocks.position).toHaveBeenCalledTimes(1);
  });
  it("does not use stale snapshots or expose provider secrets; cools down after failure", async () => {
    const legacy = await import("@/app/api/v1/lp-position/route");
    mocks.position.mockRejectedValue(new Error("https://private.invalid/SECRET"));
    const first = await legacy.GET(new Request("https://test/api?tokenId=3"));
    expect(first.status).toBe(503); expect(JSON.stringify(await first.json())).not.toContain("SECRET");
    const second = await legacy.GET(new Request("https://test/api?tokenId=4"));
    expect(second.status).toBe(429); expect(second.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.position).toHaveBeenCalledTimes(1);
  });
});
