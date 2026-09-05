import { afterEach, describe, expect, it, vi } from "vitest";
import * as adapter from "@/lib/sources/uniswap-v3/position";
import { GET } from "@/app/api/v1/lp-position/route";
import type { Address, Hex } from "viem";

// TEST fixtures only: not a live position, user portfolio, or market observation.
const NOW = Date.parse("2026-09-05T06:00:00.000Z");
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
const MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3" as const;
const TOKEN0 = "0x1111111111111111111111111111111111111111" as const;
const TOKEN1 = "0x2222222222222222222222222222222222222222" as const;
const POOL = "0x3333333333333333333333333333333333333333" as const;
const OWNER = "0x4444444444444444444444444444444444444444" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const BLOCK = BigInt(12345);
const Q96 = BigInt(2) ** BigInt(96);

function fixture() {
  const state = {
    chainId: 4663,
    timestamp: BigInt(NOW / 1000),
    hash: HASH,
    finalHash: HASH,
    finalNumber: BLOCK,
    missingCode: "" as string,
    managerFactory: FACTORY as Address,
    poolFactory: FACTORY as Address,
    pool: POOL as Address,
    poolToken0: TOKEN0 as Address,
    poolToken1: TOKEN1 as Address,
    poolFee: 3000,
    owner: OWNER as Address,
    tick: 0,
    tickLower: -60,
    tickUpper: 60,
    liquidity: BigInt(1000),
    sqrtPrice: Q96,
    decimals0: 18,
    decimals1: 18,
    revert: "",
  };
  const client = {
    getChainId: vi.fn(async () => state.chainId),
    getBlock: vi.fn(async (input: { blockNumber?: bigint }) => ({
      number: input.blockNumber === undefined ? BLOCK : state.finalNumber,
      hash: input.blockNumber === undefined ? state.hash : state.finalHash,
      timestamp: state.timestamp,
    })),
    getCode: vi.fn(async ({ address }: { address: Address; blockNumber: bigint }) =>
      state.missingCode === address ? undefined : "0x6000" as Hex),
    readContract: vi.fn(async ({ address, functionName }: adapter.LpPositionReadRequest): Promise<unknown> => {
      if (state.revert === functionName) throw new Error("execution reverted: https://private.invalid/key=SECRET");
      switch (functionName) {
        case "factory": return address === MANAGER ? state.managerFactory : state.poolFactory;
        case "ownerOf": return state.owner;
        case "positions": return [
          BigInt(0), ZERO, TOKEN0, TOKEN1, 3000, state.tickLower, state.tickUpper,
          state.liquidity, BigInt(0), BigInt(0), BigInt(999), BigInt(999),
        ] as const;
        case "getPool": return state.pool;
        case "token0": return state.poolToken0;
        case "token1": return state.poolToken1;
        case "fee": return state.poolFee;
        case "slot0": return [state.sqrtPrice, state.tick, 0, 1, 1, 0, true] as const;
        case "decimals": return address === TOKEN0 ? state.decimals0 : state.decimals1;
        default: throw new Error("Unexpected TEST read");
      }
    }),
  } satisfies adapter.LpPositionReadClient;
  const factory = vi.fn<(signal: AbortSignal) => adapter.LpPositionReadClient>().mockReturnValue(client);
  return { state, client, factory, fetch: adapter.createLpPositionFetcher(factory, () => NOW) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded public v3 position adapter (TEST RPC fixtures)", () => {
  it.each(["", "0", "-1", "1.5", "1e3", "0x1", " 1", "1 ", "01", "9".repeat(79),
    (BigInt(2) ** BigInt(256)).toString()])("rejects invalid tokenId %o before RPC", async (id) => {
    const f = fixture();
    await expect(f.fetch(id)).rejects.toThrow(/tokenId/);
    expect(f.factory).not.toHaveBeenCalled();
  });

  it("accepts the uint256 maximum without Number precision loss", async () => {
    const f = fixture();
    const id = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
    expect((await f.fetch(id)).tokenId).toBe(id);
    expect(f.client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "positions", args: [BigInt(id)],
    }));
  });

  it("returns only the exact snapshot, at one verified fresh block and official provenance", async () => {
    const f = fixture();
    const data = await f.fetch("1");
    expect(data).toEqual({
      chainId: 4663, protocol: "uniswap-v3", tokenId: "1", positionManager: MANAGER,
      factory: FACTORY, pool: POOL, owner: OWNER, blockNumber: BLOCK.toString(), blockHash: HASH,
      observedAt: new Date(NOW).toISOString(), token0: { address: TOKEN0, decimals: 18 },
      token1: { address: TOKEN1, decimals: 18 }, feeTier: 3000, tick: 0, tickLower: -60, tickUpper: 60,
      liquidityRaw: "1000", sqrtPriceX96: Q96.toString(), priceToken1PerToken0: 1,
      lowerToken1PerToken0: 1.0001 ** -60, upperToken1PerToken0: 1.0001 ** 60, rangeState: "in-range",
    });
    for (const [request] of f.client.readContract.mock.calls) expect(request.blockNumber).toBe(BLOCK);
    for (const [request] of f.client.getCode.mock.calls) expect(request.blockNumber).toBe(BLOCK);
    expect(f.client.getBlock.mock.calls).toEqual([[{ blockTag: "latest" }], [{ blockNumber: BLOCK }]]);
    expect(f.client.getChainId.mock.calls.length + f.client.getBlock.mock.calls.length
      + f.client.getCode.mock.calls.length + f.client.readContract.mock.calls.length).toBe(17);
    expect(f.client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: FACTORY, functionName: "getPool", args: [TOKEN0, TOKEN1, 3000],
    }));
    expect(f.factory.mock.calls[0][0].aborted).toBe(true); // All work is disposed after completion.
  });

  it("rejects the wrong network before any contract reads", async () => {
    const f = fixture(); f.state.chainId = 46630;
    await expect(f.fetch("1")).rejects.toThrow(/network/i);
    expect(f.client.getCode).not.toHaveBeenCalled();
    expect(f.client.readContract).not.toHaveBeenCalled();
  });

  it.each([-121, 31])("rejects stale/future blocks (%s seconds)", async (offset) => {
    const f = fixture(); f.state.timestamp += BigInt(offset);
    await expect(f.fetch("1")).rejects.toThrow(/fresh/i);
    expect(f.client.readContract).not.toHaveBeenCalled();
  });

  it.each([-120, 30])("accepts inclusive freshness limits (%s seconds)", async (offset) => {
    const f = fixture(); f.state.timestamp += BigInt(offset);
    await expect(f.fetch("1")).resolves.toHaveProperty("blockHash", HASH);
  });

  it("preserves the source block timestamp instead of making old state look freshly observed", async () => {
    const f = fixture(); f.state.timestamp -= BigInt(90);
    const data = await f.fetch("1");
    expect(data.observedAt).toBe(new Date(NOW - 90_000).toISOString());
  });

  it("rechecks freshness when reads finish, not just when they start", async () => {
    const f = fixture();
    const now = vi.fn().mockReturnValueOnce(NOW).mockReturnValue(NOW + 121_000);
    await expect(adapter.createLpPositionFetcher(f.factory, now)("1")).rejects.toThrow(/fresh/i);
  });

  it.each([MANAGER, FACTORY, POOL])("rejects missing deployment code at %s", async (address) => {
    const f = fixture(); f.state.missingCode = address;
    await expect(f.fetch("1")).rejects.toThrow(/code/i);
  });

  it.each([
    { managerFactory: OWNER }, { poolFactory: OWNER }, { poolToken0: TOKEN1 },
    { poolToken1: TOKEN0 }, { poolFee: 500 }, { pool: ZERO }, { owner: ZERO },
  ])("rejects mismatched/missing provenance %o", async (overrides) => {
    const f = fixture(); Object.assign(f.state, overrides);
    await expect(f.fetch("1")).rejects.toThrow();
  });

  it.each([
    { finalHash: `0x${"cd".repeat(32)}` }, { finalNumber: BigInt(12346) }, { hash: "0x" },
  ])("rejects reorg or malformed block identity %o", async (overrides) => {
    const f = fixture(); Object.assign(f.state, overrides);
    await expect(f.fetch("1")).rejects.toThrow();
  });

  it.each([
    [-61, "below-range"], [-60, "in-range"], [59, "in-range"], [60, "above-range"], [61, "above-range"],
  ] as const)("uses the half-open tick range at tick %s", async (tick, expected) => {
    const f = fixture(); f.state.tick = tick;
    f.state.sqrtPrice = BigInt(Math.floor(Math.sqrt(1.0001 ** tick) * Number(Q96)));
    expect((await f.fetch("1")).rangeState).toBe(expected);
  });

  it("reports zero position liquidity as closed, never as missing or a zero fee balance", async () => {
    const f = fixture(); f.state.liquidity = BigInt(0);
    expect(await f.fetch("1")).toMatchObject({ liquidityRaw: "0", rangeState: "closed" });
  });

  it.each([[18, 6, 1e12], [6, 18, 1e-12], [0, 36, 1e-36], [36, 0, 1e36]])(
    "quotes token1 per token0 with decimals %s/%s", async (decimals0, decimals1, expected) => {
      const f = fixture(); Object.assign(f.state, { decimals0, decimals1 });
      const data = await f.fetch("1");
      expect(data.priceToken1PerToken0 / expected).toBeCloseTo(1, 12);
      expect(data.lowerToken1PerToken0 / (1.0001 ** -60 * expected)).toBeCloseTo(1, 12);
      expect(data.upperToken1PerToken0 / (1.0001 ** 60 * expected)).toBeCloseTo(1, 12);
    },
  );

  it.each([
    { decimals0: 37 }, { decimals1: 255 }, { decimals0: -1 }, { decimals1: 1.5 },
    { decimals0: NaN }, { decimals1: Infinity }, { sqrtPrice: BigInt(0) }, { sqrtPrice: BigInt(1) },
    { sqrtPrice: BigInt("1461446703485210103287273052203988822378723970342") },
    { sqrtPrice: BigInt(2) ** BigInt(160) }, { liquidity: BigInt(-1) },
    { tickLower: 60 }, { tickUpper: 887273 }, { tick: NaN }, { tick: 500 },
  ])("fails closed for unsupported/invalid numeric state %o", async (overrides) => {
    const f = fixture(); Object.assign(f.state, overrides);
    await expect(f.fetch("1")).rejects.toThrow();
  });

  it.each(["ownerOf", "positions", "decimals", "slot0"])("sanitizes nonexistent IDs/reverts in %s", async (functionName) => {
    const f = fixture(); f.state.revert = functionName;
    await expect(f.fetch("1")).rejects.toThrow("Public position data is unavailable");
    await expect(f.fetch("1")).rejects.not.toThrow(/SECRET|https:/);
  });

  it("does not return a prior success after an RPC outage", async () => {
    const f = fixture(); await f.fetch("1");
    f.client.getChainId.mockRejectedValue(new Error("https://secret.invalid/API_KEY"));
    await expect(f.fetch("1")).rejects.toThrow("Public position data is unavailable");
  });

  it("aborts hanging reads within 18 seconds with no downstream work", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.client.getChainId.mockImplementation(() => new Promise(() => {}));
    const result = expect(f.fetch("1")).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(18_000);
    await result;
    expect(f.factory.mock.calls[0][0].aborted).toBe(true);
    expect(f.client.getBlock).not.toHaveBeenCalled();
  });

  it("uses only the fixed no-store RPC with zero retries and a bounded transport", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("provider failure with private secret"));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", fetch);
    await expect(adapter.fetchLpPosition("1")).rejects.toThrow("Public position data is unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    expect(new URL(String(input)).href).toBe("https://rpc.mainnet.chain.robinhood.com/");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error", method: "POST" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(true);
    expect(JSON.parse(init?.body as string).method).toBe("eth_chainId");
    expect(timeout).toHaveBeenCalledWith(5_500);
  });
});

describe("GET /api/v1/lp-position", () => {
  const request = (query = "tokenId=1") => new Request(`https://robin.test/api/v1/lp-position?${query}`);

  it.each(["", "tokenId=0", "tokenId=1&tokenId=2", "tokenId=1&rpc=https://evil.invalid", "tokenId=1&wallet=0x123"])(
    "returns 400/null and no-store without upstream work for %o", async (query) => {
      const spy = vi.spyOn(adapter, "fetchLpPosition");
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ data: null, error: expect.any(String) });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("returns the snapshot with withheld fee/performance metadata, then 503/null on failure", async () => {
    const data = await fixture().fetch("1");
    vi.spyOn(adapter, "fetchLpPosition").mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error("https://provider.invalid/SECRET"));
    const success = await GET(request());
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toContain("no-store");
    expect(await success.json()).toEqual({ data, meta: {
      source: "Robinhood Chain public RPC", fees: "withheld", performance: "withheld", reason: expect.any(String),
    } });
    const failure = await GET(request());
    expect(failure.status).toBe(503);
    expect(failure.headers.get("cache-control")).toContain("no-store");
    const body = await failure.json();
    expect(body).toEqual({ data: null, error: expect.any(String) });
    expect(body.error).not.toMatch(/SECRET|https:/);
  });
});
