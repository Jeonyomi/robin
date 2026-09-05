import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, toHex, type Address, type Hex } from "viem";
import * as adapter from "@/lib/sources/uniswap-v3/leaders";
import { isFreshLeaderboard, LpLeaderboardSchema, LpLeaderSchema, rankLpLeaders } from "@/lib/lp-leaders";
import { GET } from "@/app/api/v1/lp-leaders/route";

// EXPLICIT SYNTHETIC TEST FIXTURES ONLY. These are not live NFTs, prices, or user holdings.
// The fixed manager/factory identify the adapter contract; all observations below are invented for tests.
const NOW = Date.parse("2026-09-05T06:00:00.000Z");
const MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3" as const;
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const LOW = "0x1111111111111111111111111111111111111111" as const;
const WETH = "0x2222222222222222222222222222222222222222" as const;
const HIGH = "0x3333333333333333333333333333333333333333" as const;
const POOL = "0x4444444444444444444444444444444444444444" as const;
const OWNER = "0x5555555555555555555555555555555555555555" as const;
const MINTER = "0x6666666666666666666666666666666666666666" as const;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const OTHER_HASH = `0x${"cd".repeat(32)}` as Hex;
const BLOCK = BigInt(1000);
const MINT = BigInt(100);
const Q96 = BigInt(2) ** BigInt(96);
const Q128 = BigInt(2) ** BigInt(128);
const EVENTS = parseAbi([
  "event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);

type EventName = "IncreaseLiquidity" | "DecreaseLiquidity" | "Collect" | "Transfer";
function log(eventName: EventName, id: bigint, block: bigint, index: number, from: Address = ZERO, to: Address = MINTER) {
  const topics = eventName === "Transfer"
    ? encodeEventTopics({ abi: EVENTS, eventName, args: { tokenId: id, from, to } })
    : encodeEventTopics({ abi: EVENTS, eventName, args: { tokenId: id } });
  const data = eventName === "Transfer" ? "0x" as Hex : eventName === "Collect"
    ? encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }], [OWNER, BigInt(80), BigInt(120)])
    : encodeAbiParameters([{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }], eventName === "IncreaseLiquidity"
      ? [BigInt(2000), BigInt(250), BigInt(350)] : [BigInt(1000), BigInt(50), BigInt(70)]);
  return { address: MANAGER as Address, blockNumber: toHex(block), blockHash: OTHER_HASH, transactionHash: toHex(BigInt(index + 1), { size: 32 }), logIndex: toHex(index), data, topics, removed: false };
}

function fixture(ids = [BigInt(10), BigInt(2), BigInt(100)]) {
  const state = {
    chainId: 4663, timestamp: BigInt(NOW / 1000), finalHash: HASH, finalNumber: BLOCK,
    managerFactory: FACTORY as Address, poolFactory: FACTORY as Address,
    wethDecimals: 18, baseDecimals: 18, token0: LOW as Address, token1: WETH as Address,
    poolToken0: undefined as Address | undefined, owner: OWNER as Address,
    sqrtPrice: Q96, tick: 0, lower: -60, upper: 60, liquidity: BigInt(1000),
    supply: ids.length, ids: [...ids], unsupported: new Set<string>(), invalid: new Set<string>(),
    owed0: BigInt(40), owed1: BigInt(60), missingCode: "", mintNumber: MINT,
    fees: ids.flatMap((id, i) => [log("IncreaseLiquidity", id, MINT, i * 10 + 1), log("DecreaseLiquidity", id, BigInt(200), i * 10 + 2), log("Collect", id, BigInt(300), i * 10 + 3)]),
    // Receipt-extracted mint evidence only; ownerOf may legitimately differ.
    transfers: ids.map((id, i) => log("Transfer", id, MINT, i * 10)),
  };
  const client = {
    getChainId: vi.fn(async () => state.chainId),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) => blockNumber === MINT
      ? { number: state.mintNumber, hash: OTHER_HASH, timestamp: state.timestamp - BigInt(3600) }
      : { number: blockNumber === undefined ? BLOCK : state.finalNumber, hash: blockNumber === undefined ? HASH : state.finalHash, timestamp: state.timestamp }),
    getCode: vi.fn(async ({ address }: { address: Address; blockNumber: bigint }) => state.missingCode === address ? undefined : "0x6000" as Hex),
    readContract: vi.fn(async ({ address, functionName, args }: Parameters<adapter.LeaderReadClient["readContract"]>[0]): Promise<unknown> => {
      const id = String(args?.[0]);
      switch (functionName) {
        case "factory": return address === MANAGER ? state.managerFactory : state.poolFactory;
        case "WETH9": return WETH;
        case "totalSupply": return BigInt(state.supply);
        case "tokenByIndex": return state.ids[Number(args?.[0])];
        case "positions": return [BigInt(0), ZERO, state.token0, state.unsupported.has(id) ? HIGH : state.token1, 3000,
          state.lower, state.upper, state.invalid.has(id) ? BigInt(999) : state.liquidity, BigInt(0), BigInt(0), state.owed0, state.owed1];
        case "ownerOf": return state.owner;
        case "getPool": return POOL;
        case "token0": return state.poolToken0 ?? state.token0;
        case "token1": return state.token1;
        case "fee": return 3000;
        case "tickSpacing": return 1;
        case "slot0": return [state.sqrtPrice, state.tick, 0, 1, 1, 0, true];
        case "feeGrowthGlobal0X128": return Q128;
        case "feeGrowthGlobal1X128": return Q128 * BigInt(2);
        case "ticks": return [BigInt(10000), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), 0, true];
        case "decimals": return address === WETH ? state.wethDecimals : state.baseDecimals;
        case "symbol": return address === WETH ? "WETH" : "SYNTHETIC";
        default: throw new Error(`Unexpected synthetic read: ${functionName}`);
      }
    }),
    logs: vi.fn(async ({ transfers }: Parameters<adapter.LeaderReadClient["logs"]>[0]) => transfers ? state.transfers : state.fees),
  } satisfies adapter.LeaderReadClient;
  const factory = vi.fn<(signal: AbortSignal) => adapter.LeaderReadClient>().mockReturnValue(client);
  return { state, client, factory, fetch: adapter.createLpLeaderboardFetcher(factory, () => NOW) };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("automatic LP discovery — synthetic injected read client", () => {
  it("enumerates NFTs without wallet/ID input and fixes every read to canonical chain/block provenance", async () => {
    const f = fixture();
    const data = await f.fetch();
    expect(data).toMatchObject({ chainId: 4663, protocol: "uniswap-v3", positionManager: MANAGER, weth: WETH,
      blockNumber: String(BLOCK), blockHash: HASH, observedAt: new Date(NOW).toISOString(), totalNfts: 3,
      sampled: 3, eligible: 3, excluded: 0, unsupported: 0, sampleMethod: "stratified-enumerable-indices-v1", ranking: "lifetime-native-weth-fees" });
    expect(data.rows.map((row) => row.tokenId)).toEqual(["2", "10", "100"]);
    expect(f.client.readContract.mock.calls.filter(([r]) => r.functionName === "tokenByIndex").map(([r]) => r.args)).toEqual([[BigInt(0)], [BigInt(1)], [BigInt(2)]]);
    for (const [request] of f.client.readContract.mock.calls) expect(request.blockNumber).toBe(BLOCK);
    for (const [request] of f.client.getCode.mock.calls) expect(request.blockNumber).toBe(BLOCK);
    expect(f.client.logs).toHaveBeenCalledTimes(2);
    for (const [request] of f.client.logs.mock.calls) expect(request).toMatchObject({ ids: f.state.ids, blockNumber: BLOCK });
    expect(f.client.getBlock.mock.calls).toEqual([[{}], [{ blockNumber: MINT }], [{ blockNumber: BLOCK }]]);
    expect(f.client.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: FACTORY, functionName: "getPool", args: [LOW, WETH, 3000] }));
    expect(f.factory.mock.calls[0][0].aborted).toBe(true);
  });

  it("reconciles real ABI ledger shapes: collected + owed + pending minus withdrawn principal, across owners", async () => {
    const f = fixture([BigInt(1)]);
    // Deliberately unsort the RPC history: chronological reconciliation must still work.
    f.state.fees.reverse(); f.state.transfers.reverse();
    const [row] = (await f.fetch()).rows;
    const fees0 = BigInt(80) + BigInt(40) + BigInt(1000) - BigInt(50);
    const fees1 = BigInt(120) + BigInt(60) + BigInt(2000) - BigInt(70);
    expect(row).toMatchObject({ fees0: String(fees0), fees1: String(fees1), increases: 1, decreases: 1, collections: 1, transfers: null, owner: OWNER,
      mintedAt: new Date(NOW - 3_600_000).toISOString() });
    expect(row.feeIncomeWeth).toBeCloseTo(Number(fees1) / 1e18, 25);
    expect(row.spotFeeValueWeth).toBeCloseTo(Number(fees0 + fees1) / 1e18, 25);
    expect(row.fees0).not.toBe(String(BigInt(80) + BigInt(40) + BigInt(1000)));
    expect(row.capitalWeth).toBeGreaterThan(0);
    expect(row).not.toHaveProperty("apr"); expect(row).not.toHaveProperty("cashReceived");
  });

  it.each([false, true])("normalizes cross-token price, fees and range with WETH token0=%s", async (wethIs0) => {
    const f = fixture([BigInt(1)]);
    Object.assign(f.state, { token0: wethIs0 ? WETH : LOW, token1: wethIs0 ? HIGH : WETH, baseDecimals: 6,
      sqrtPrice: Q96 * BigInt(2), tick: 13863, lower: 0, upper: 20000 });
    const [row] = (await f.fetch()).rows;
    const d0 = wethIs0 ? 18 : 6; const d1 = wethIs0 ? 6 : 18;
    const p01 = 4 * 10 ** (d0 - d1);
    const expectedPrice = wethIs0 ? 1 / p01 : p01;
    expect(row.priceWethPerBase / expectedPrice).toBeCloseTo(1, 12);
    expect(row.baseAddress).toBe(wethIs0 ? HIGH : LOW);
    expect(row.baseSymbol).toBe("SYNTHETIC");
    const expectedFees = wethIs0 ? Number(row.fees0) / 1e18 + Number(row.fees1) / 1e6 / p01 : Number(row.fees0) / 1e6 * p01 + Number(row.fees1) / 1e18;
    expect(row.spotFeeValueWeth! / expectedFees).toBeCloseTo(1, 12);
    expect(row.feeIncomeWeth / (Number(wethIs0 ? row.fees0 : row.fees1) / 1e18)).toBeCloseTo(1, 12);
    const lower01 = 10 ** (d0 - d1); const upper01 = 1.0001 ** 20000 * lower01;
    expect(row.lowerWethPerBase / (wethIs0 ? 1 / upper01 : lower01)).toBeCloseTo(1, 12);
    expect(row.upperWethPerBase / (wethIs0 ? 1 / lower01 : upper01)).toBeCloseTo(1, 12);
    expect(row.rangeState).toBe("in-range");
  });

  it("counts unsupported non-WETH pairs separately from failed validation", async () => {
    const f = fixture(); f.state.unsupported.add("10"); f.state.invalid.add("100");
    expect(await f.fetch()).toMatchObject({ sampled: 3, eligible: 1, unsupported: 1, excluded: 1, rows: [{ tokenId: "2" }] });
  });
  it("allows an entirely unsupported sample, but never calls it validated leaders", async () => {
    const f = fixture([BigInt(1)]); f.state.unsupported.add("1");
    expect(await f.fetch()).toMatchObject({ eligible: 0, unsupported: 1, excluded: 0, rows: [] });
  });
  it("returns a correctly labeled empty enumeration without fabricated rows or history requests", async () => {
    const f = fixture([]);
    expect(await f.fetch()).toMatchObject({ sampled: 0, totalNfts: 0, eligible: 0, rows: [] });
    expect(f.client.logs).not.toHaveBeenCalled();
  });
  it("rejects a wrong network before contract reads", async () => {
    const f = fixture(); f.state.chainId = 1;
    await expect(f.fetch()).rejects.toThrow(/network/); expect(f.client.readContract).not.toHaveBeenCalled();
  });
  it.each([-121, 31])("rejects stale/future source timestamps (%s seconds)", async (seconds) => {
    const f = fixture(); f.state.timestamp += BigInt(seconds);
    await expect(f.fetch()).rejects.toThrow(/stale/); expect(f.client.readContract).not.toHaveBeenCalled();
  });
  it("preserves block observation time and rejects a scan that ages out", async () => {
    const f = fixture(); f.state.timestamp -= BigInt(90);
    expect((await f.fetch()).observedAt).toBe(new Date(NOW - 90_000).toISOString());
    const now = vi.fn().mockReturnValueOnce(NOW).mockReturnValue(NOW + 121_000);
    await expect(adapter.createLpLeaderboardFetcher(f.factory, now)()).rejects.toThrow(/aged out/);
  });
  it.each(["hash", "number"])("rejects end-of-scan reorg/identity drift: %s", async (field) => {
    const f = fixture(); if (field === "hash") f.state.finalHash = OTHER_HASH; else f.state.finalNumber += BigInt(1);
    await expect(f.fetch()).rejects.toThrow(/identity changed/);
  });
  it("rejects duplicate enumerated IDs before reading history", async () => {
    const f = fixture(); f.state.ids[1] = f.state.ids[0];
    await expect(f.fetch()).rejects.toThrow(/duplicate NFTs/); expect(f.client.logs).not.toHaveBeenCalled();
  });
  it.each(["missing mint", "zero owner", "non-mint transfer evidence", "second mint", "incorrect liquidity", "missing increase", "mint block mismatch", "pool provenance"])("fails closed for %s", async (fault) => {
    const f = fixture([BigInt(1)]);
    switch (fault) {
      case "missing mint": f.state.transfers.shift(); break;
      case "zero owner": f.state.owner = ZERO; break;
      case "non-mint transfer evidence": f.state.transfers[1] = log("Transfer", BigInt(1), BigInt(400), 4, LOW, OWNER); break;
      case "second mint": f.state.transfers.push(log("Transfer", BigInt(1), BigInt(500), 5)); break;
      case "incorrect liquidity": f.state.invalid.add("1"); break;
      case "missing increase": f.state.fees.shift(); break;
      case "mint block mismatch": f.state.mintNumber += BigInt(1); break;
      case "pool provenance": f.state.poolFactory = LOW; break;
    }
    await expect(f.fetch()).rejects.toThrow(/No sampled NFTs passed/);
  });
  it.each(["duplicate fee", "duplicate transfer", "wrong manager", "future log", "unrelated NFT", "removed log"])("rejects malformed/provenance history: %s", async (fault) => {
    const f = fixture([BigInt(1)]);
    switch (fault) {
      case "duplicate fee": f.state.fees.push(f.state.fees[0]); break;
      case "duplicate transfer": f.state.transfers.push(f.state.transfers[0]); break;
      case "wrong manager": f.state.fees[0].address = LOW; break;
      case "future log": f.state.fees[0].blockNumber = toHex(BLOCK + BigInt(1)); break;
      case "unrelated NFT": f.state.fees.push(log("Collect", BigInt(999), BigInt(500), 99)); break;
      case "removed log": f.state.fees[0].removed = true; break;
    }
    await expect(f.fetch()).rejects.toThrow();
  });
  it.each(["factory", "weth decimals", "missing code"])("rejects canonical deployment/denomination failures: %s", async (fault) => {
    const f = fixture();
    if (fault === "factory") f.state.managerFactory = LOW;
    if (fault === "weth decimals") f.state.wethDecimals = 6;
    if (fault === "missing code") f.state.missingCode = MANAGER;
    await expect(f.fetch()).rejects.toThrow();
  });
  it("sanitizes malicious provider errors and never substitutes a prior successful snapshot", async () => {
    const f = fixture(); await f.fetch();
    f.client.getChainId.mockRejectedValue(new Error("<script>secret</script> https://private.invalid/API_KEY"));
    const error = await f.fetch().catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("LP ranking data is unavailable. No estimated or stale ranking is substituted.");
    expect((error as Error).message).not.toMatch(/script|secret|private|API_KEY/);
  });
  it("aborts a hanging source on its bounded deadline", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.client.getChainId.mockImplementation(() => new Promise(() => {}));
    const rejected = expect(f.fetch()).rejects.toThrow(/timed out.*No stale/);
    await vi.advanceTimersByTimeAsync(45_000); await rejected;
    expect(f.factory.mock.calls[0][0].aborted).toBe(true);
    expect(f.client.getBlock).not.toHaveBeenCalled();
  });
});

describe("bounded sampling, schema and deterministic ranks", () => {
  it.each([0, 1, 64, 65, 751148])("samples supply %s uniquely, in bounds, with deterministic endpoint coverage", (supply) => {
    const indices = adapter.sampleNftIndices(supply);
    // The transport may lower its operational sample budget; 64 is the public ceiling, not a minimum.
    expect(indices.length).toBeLessThanOrEqual(Math.min(supply, 64)); expect(new Set(indices).size).toBe(indices.length);
    expect(indices.every((i) => Number.isInteger(i) && i >= 0 && i < supply)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b)); expect(adapter.sampleNftIndices(supply)).toEqual(indices);
    if (supply <= 1) expect(indices).toEqual(Array.from({ length: supply }, (_, i) => i));
    else {
      expect(indices.length).toBeGreaterThanOrEqual(8);
      expect(indices.slice(0, 2)).toEqual([0, 1]);
      expect(indices.slice(-2)).toEqual([supply - 2, supply - 1]);
    }
  });
  it.each([-1, 1.5, NaN, Infinity, 2_000_000_001])("rejects invalid supply %s", (supply) => {
    expect(() => adapter.sampleNftIndices(supply)).toThrow(/supply/);
  });
  it("ranks by fee income then bigint ID without mutating the input", async () => {
    const [row] = (await fixture().fetch()).rows;
    const rows = [{ ...row, tokenId: "9007199254740993", feeIncomeWeth: 2 }, { ...row, tokenId: "10", feeIncomeWeth: 2 }, { ...row, tokenId: "2", feeIncomeWeth: 2 }, { ...row, tokenId: "99", feeIncomeWeth: 3 }];
    const before = [...rows]; expect(rankLpLeaders(rows).map((r) => r.tokenId)).toEqual(["99", "2", "10", "9007199254740993"]);
    expect(rows).toEqual(before);
  });
  it.each([[-120_001, false], [-120_000, true], [0, true], [30_000, true], [30_001, false]])("checks inclusive freshness offset %s", (offset, fresh) => {
    expect(isFreshLeaderboard({ observedAt: new Date(NOW + Number(offset)).toISOString() }, NOW)).toBe(fresh);
  });
  it("rejects invalid time, wrong-chain schemas, nonfinite values and malformed raw fees", async () => {
    expect(isFreshLeaderboard({ observedAt: "not a date" }, NOW)).toBe(false);
    const board = await fixture().fetch(); expect(LpLeaderboardSchema.safeParse(board).success).toBe(true);
    expect(LpLeaderboardSchema.safeParse({ ...board, chainId: 1 }).success).toBe(false);
    expect(LpLeaderboardSchema.safeParse({ ...board, observedAt: "invalid" }).success).toBe(false);
    expect(LpLeaderboardSchema.safeParse({ ...board, rows: Array.from({ length: 65 }, () => board.rows[0]) }).success).toBe(false);
    for (const change of [{ feeIncomeWeth: Infinity }, { capitalWeth: -1 }, { fees0: "1.5" }, { fees1: "-1" }, { tokenId: "0" }])
      expect(LpLeaderSchema.safeParse({ ...board.rows[0], ...change }).success).toBe(false);
  });
});

describe("LP leaders API boundary — synthetic adapter only", () => {
  it.each(["unknown=1", "wallet=0x123", "tokenId=1", "provider=https://evil.invalid", "chainId=1"])("rejects query %s with 400 before discovery", async (query) => {
    const fetch = vi.spyOn(adapter, "fetchLpLeaderboard").mockImplementation(fixture().fetch);
    const response = await GET(new Request(`http://localhost/api/v1/lp-leaders?${query}`));
    expect(response.status).toBe(400); expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(await response.json()).toMatchObject({ data: null, error: expect.stringContaining("does not accept") });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serves a JSON success with no-store headers and source provenance", async () => {
    const f = fixture(); vi.spyOn(adapter, "fetchLpLeaderboard").mockImplementation(f.fetch);
    const response = await GET(new Request("http://localhost/api/v1/lp-leaders"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: null, data: { chainId: 4663, blockHash: HASH, eligible: 3 } });
  });
  it("returns sanitized 503 and null data after success instead of stale rows", async () => {
    const f = fixture(); vi.spyOn(adapter, "fetchLpLeaderboard").mockImplementation(f.fetch);
    expect((await GET(new Request("http://localhost/api/v1/lp-leaders"))).status).toBe(200);
    f.client.getChainId.mockRejectedValue(new Error("https://private.invalid/API_KEY <script>secret</script>"));
    const response = await GET(new Request("http://localhost/api/v1/lp-leaders"));
    expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    const body = await response.json();
    expect(body).toEqual({ data: null, error: "LP ranking data is unavailable. No estimated or stale ranking is substituted." });
    expect(JSON.stringify(body)).not.toMatch(/API_KEY|script|private|secret/);
  });
});
