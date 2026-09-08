import {
  decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData,
  keccak256, parseAbi, parseAbiParameters, toEventSelector, toHex, type Abi, type Address, type Hex,
} from "viem";
import { z } from "zod";
import type { PairPosition, PairPositions, PoolInspection, StockPair } from "@/lib/meme-stock-types";
import { inventoryAtPrice } from "@/lib/domain/lp/fees";
import { isValidLpTokenId } from "./uniswap-v3/position";

// Official Robinhood mainnet deployments, not caller-configurable endpoints:
// https://developers.uniswap.org/deployments.json (chainId 4663)
// https://developers.uniswap.org/docs/protocols/v4/deployments.md
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as Address;
const V3_NFT = "0x73991a25c818bf1f1128deaab1492d45638de0d3" as Address;
const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as Address;
const V4_NFT = "0x58daec3116aae6d93017baaea7749052e8a04fa7" as Address;
const V4_STATE = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as Address;
const ZERO = "0x0000000000000000000000000000000000000000";
const SAMPLE_SIZE = 8;
const TOTAL_MS = 25_000;
const REQUEST_MS = 6_000;
const MAX_HTTP_REQUESTS = 16;
const MAX_RPC_METHODS = 96;
const MAX_RESPONSE_BYTES = 1_048_576;
// One topic-filtered, finite historical query, never an unbounded pagination loop.
// Covers the launch history at implementation time; older pools require a manual NFT.
const INITIALIZE_LOOKBACK = BigInt(64_000_000);
const INIT_SIGNATURE = "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)";
const ABI = parseAbi([
  "function factory() view returns (address)",
  "function poolManager() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function liquidity() view returns (uint128)",
  "function decimals() view returns (uint8)",
  "function getPool(address token0, address token1, uint24 fee) view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 info)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
]);
const rawAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s.toLowerCase() as Address);
const address = rawAddress.refine(s => s !== ZERO);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(s => s.toLowerCase() as Hex);
const uint = (bits: number) => z.bigint().min(BigInt(0)).max((BigInt(1) << BigInt(bits)) - BigInt(1));
const quantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/).transform(BigInt);
const tickSchema = z.number().int().min(-887272).max(887272);
const decimalsSchema = z.number().int().min(0).max(36);
const feeSchema = z.number().int().min(0).max(1_000_000);
const spacingSchema = z.number().int().min(1).max(32767);
const keySchema = z.object({
  currency0: rawAddress, currency1: address,
  fee: z.number().int().refine(n => (n >= 0 && n <= 1_000_000) || n === 0x800000),
  tickSpacing: spacingSchema, hooks: rawAddress,
});
type PoolKey = z.infer<typeof keySchema>;
const blockSchema = z.object({ number: quantity, hash, timestamp: quantity });
type Block = z.infer<typeof blockSchema>;
type Call = { address: Address; functionName: string; args?: readonly unknown[] };
type Result = { ok: true; value: unknown } | { ok: false };
const call = (target: Address, functionName: string, args?: readonly unknown[]): Call => ({ address: target, functionName, args });
class InspectionError extends Error {}
function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InspectionError(message);
}
function required(result: Result): unknown {
  demand(result.ok, "Required onchain read failed; public RPC or contract data is unavailable.");
  return result.value;
}
function fresh(block: Block) {
  const age = Date.now() / 1000 - Number(block.timestamp);
  demand(Number.isFinite(age) && age >= -30 && age <= 120, "Onchain block failed the freshness check.");
  demand(!/^0x0+$/.test(block.hash), "Onchain block hash is unavailable.");
}
function keyHash(key: PoolKey): Hex {
  demand(BigInt(key.currency0) < BigInt(key.currency1), "Invalid v4 currency ordering.");
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address, address, uint24, int24, address"),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  ));
}
function currencies(pair: StockPair): [Address, Address] {
  const a = rawAddress.parse(pair.base.address);
  const b = rawAddress.parse(pair.quote.address);
  demand(a !== b, "Source pair has duplicate currencies.");
  const stock = address.parse(pair.stock.address);
  demand(stock === (pair.stockSide === "base" ? a : b), "Source stock currency does not match the pair.");
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}
function validatePair(pair: StockPair): Hex {
  demand(pair.protocol === "uniswap-v3" || pair.protocol === "uniswap-v4", "Unsupported pool protocol.");
  currencies(pair);
  // A v4 pool identifier is a bytes32 hash, NEVER an EVM contract address.
  return pair.protocol === "uniswap-v4" ? hash.parse(pair.id) : address.parse(pair.id);
}

/** JSON-RPC batching avoids assuming a Multicall deployment. Both HTTP requests and
 * individual RPC methods are budgeted; redirects, retries and wallet methods are absent. */
class Reads {
  private requests = 0;
  private methods = 0;
  private sequence = 0;
  block!: Block;
  constructor(readonly signal: AbortSignal) {}
  async batch(items: { method: "eth_chainId" | "eth_getBlockByNumber" | "eth_getCode" | "eth_call" | "eth_getLogs"; params: unknown[] }[]): Promise<Result[]> {
    if (!items.length) return [];
    this.signal.throwIfAborted();
    demand(++this.requests <= MAX_HTTP_REQUESTS && (this.methods += items.length) <= MAX_RPC_METHODS,
      "Onchain inspection request budget exceeded.");
    const payload = items.map(item => ({ jsonrpc: "2.0", id: ++this.sequence, ...item }));
    const response = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      cache: "no-store", redirect: "error",
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(REQUEST_MS)]),
    });
    demand(response.ok && response.body, "Public RPC is unavailable.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        demand(size <= MAX_RESPONSE_BYTES, "Public RPC response exceeded the inspection limit.");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    this.signal.throwIfAborted();
    const envelopes = z.array(z.object({ jsonrpc: z.literal("2.0"), id: z.number().int(), result: z.unknown().optional(), error: z.unknown().optional() })).max(MAX_RPC_METHODS).parse(JSON.parse(text));
    demand(envelopes.length === payload.length && new Set(envelopes.map(e => e.id)).size === envelopes.length,
      "Public RPC returned an incomplete or duplicate batch.");
    const byId = new Map(envelopes.map(e => [e.id, e]));
    return payload.map(p => {
      const e = byId.get(p.id);
      return e && e.error === undefined && e.result !== undefined ? { ok: true, value: e.result } : { ok: false };
    });
  }
  async start() {
    const r = await this.batch([
      { method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] },
    ]);
    demand(quantity.parse(required(r[0])) === BigInt(CHAIN_ID), "Public RPC failed the Robinhood chain check.");
    this.block = blockSchema.parse(required(r[1]));
    fresh(this.block);
  }
  async contracts(calls: Call[]): Promise<Result[]> {
    const results = await this.batch(calls.map(c => ({
      method: "eth_call", params: [{ to: c.address, data: encodeFunctionData({ abi: ABI as Abi, functionName: c.functionName, args: c.args }) }, toHex(this.block.number)],
    })));
    return results.map((r, i) => {
      if (!r.ok) return r;
      try {
        const data = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).parse(r.value) as Hex;
        return { ok: true, value: decodeFunctionResult({ abi: ABI as Abi, functionName: calls[i].functionName, data }) };
      } catch { return { ok: false }; }
    });
  }
  async all(calls: Call[]): Promise<unknown[]> { return (await this.contracts(calls)).map(required); }
  async code(targets: Address[]) {
    const r = await this.batch([...new Set(targets)].map(target => ({ method: "eth_getCode", params: [target, toHex(this.block.number)] })));
    r.forEach(result => demand(typeof required(result) === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(required(result) as string), "Required deployment has no contract code."));
  }
  async finish() {
    const r = await this.batch([{ method: "eth_getBlockByNumber", params: [toHex(this.block.number), false] }]);
    const final = blockSchema.parse(required(r[0]));
    demand(final.number === this.block.number && final.hash === this.block.hash && final.timestamp === this.block.timestamp,
      "Block identity changed during inspection; snapshot rejected.");
    fresh(final);
  }
}

async function bounded<T>(operation: (reads: Reads) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new InspectionError("Onchain inspection timed out.")); }, TOTAL_MS);
  });
  try {
    return await Promise.race([operation(new Reads(controller.signal)), deadline]);
  } catch (error) {
    throw new Error(error instanceof InspectionError ? error.message : "Onchain inspection unavailable: invalid data, missing NFT, or public RPC failure.");
  } finally { clearTimeout(timer); controller.abort(); }
}

function slot(raw: unknown): { sqrt: bigint; tick: number } {
  const values = z.array(z.unknown()).min(2).parse(raw);
  const sqrt = uint(160).parse(values[0]);
  const tick = tickSchema.parse(values[1]);
  demand(sqrt >= BigInt("4295128739") && sqrt < BigInt("1461446703485210103287273052203988822378723970342"),
    "Pool is uninitialized or has unsupported price state.");
  const approximate = 2 * Math.log(Number(sqrt) / 2 ** 96) / Math.log(1.0001);
  demand(approximate >= tick - 1e-6 && approximate <= tick + 1 + 1e-6, "Pool price and tick are inconsistent.");
  return { sqrt, tick };
}
async function decimals(reads: Reads, token0: Address, token1: Address): Promise<[number, number]> {
  const tokens = [token0, token1];
  const values = await reads.all(tokens.filter(t => t !== ZERO).map(t => call(t, "decimals")));
  let i = 0;
  // v4 address(0) is the native currency; no substitution of wrapped token addresses.
  return tokens.map(t => t === ZERO ? 18 : decimalsSchema.parse(values[i++])) as [number, number];
}
async function initializeKey(reads: Reads, id: Hex, expected: [Address, Address]): Promise<PoolKey> {
  const from = reads.block.number >= INITIALIZE_LOOKBACK ? reads.block.number - INITIALIZE_LOOKBACK + BigInt(1) : BigInt(0);
  const results = await reads.batch([{ method: "eth_getLogs", params: [{
    address: V4_POOL_MANAGER, fromBlock: toHex(from), toBlock: toHex(reads.block.number),
    // Include indexed currencies as well as poolId: broad poolId-only history can
    // time out on the public node even though Initialize itself occurs only once.
    topics: [toEventSelector(INIT_SIGNATURE), id,
      `0x${expected[0].slice(2).padStart(64, "0")}`,
      `0x${expected[1].slice(2).padStart(64, "0")}`],
  }] }]);
  const logs = z.array(z.object({
    address: rawAddress, topics: z.array(hash).min(1), data: z.string().regex(/^0x[0-9a-fA-F]*$/),
    blockNumber: quantity, blockHash: hash, removed: z.boolean().optional(),
  })).max(2).parse(required(results[0]));
  demand(logs.length === 1, "Cannot verify v4 PoolKey: Initialize event was not uniquely found in the bounded 64,000,000-block window. Supply a position tokenId for older pools.");
  const log = logs[0];
  demand(log.address === V4_POOL_MANAGER && log.removed !== true && log.blockNumber >= from && log.blockNumber <= reads.block.number,
    "Invalid v4 Initialize event provenance.");
  const decoded = decodeEventLog({ abi: ABI, eventName: "Initialize", data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
  const key = keySchema.parse(decoded.args);
  demand(hash.parse(decoded.args.id) === id && keyHash(key) === id && key.currency0 === expected[0] && key.currency1 === expected[1],
    "v4 Initialize PoolKey hash or currency pair does not match the source pool.");
  const headers = await reads.batch([{ method: "eth_getBlockByNumber", params: [toHex(log.blockNumber), false] }]);
  const initBlock = blockSchema.parse(required(headers[0]));
  demand(initBlock.number === log.blockNumber && initBlock.hash === log.blockHash, "v4 Initialize event is not in its canonical block.");
  return key;
}

type PositionData = { tokenId: bigint; owner: Address; token0: Address; token1: Address; fee: number; lower: number; upper: number; liquidity: bigint; key?: PoolKey };
function positionCalls(protocol: PoolInspection["protocol"], id: bigint): Call[] {
  return protocol === "uniswap-v4"
    ? [call(V4_NFT, "getPoolAndPositionInfo", [id]), call(V4_NFT, "ownerOf", [id]), call(V4_NFT, "getPositionLiquidity", [id])]
    : [call(V3_NFT, "positions", [id]), call(V3_NFT, "ownerOf", [id])];
}
function positionData(protocol: PoolInspection["protocol"], id: bigint, raw: Result[]): PositionData {
  const values = raw.map(required);
  const owner = address.parse(values[1]);
  if (protocol === "uniswap-v4") {
    const tuple = z.tuple([keySchema, uint(256)]).parse(values[0]);
    const [key, info] = tuple;
    const idHash = keyHash(key);
    // PositionInfo's poolId is only the high 200 bits, not the full core pool ID.
    demand((info >> BigInt(56)) === (BigInt(idHash) >> BigInt(56)), "v4 packed position does not match its PoolKey.");
    const signed24 = (shift: number) => Number(BigInt.asIntN(24, info >> BigInt(shift)));
    return { tokenId: id, owner, token0: key.currency0, token1: key.currency1, fee: key.fee,
      lower: tickSchema.parse(signed24(8)), upper: tickSchema.parse(signed24(32)), liquidity: uint(128).parse(values[2]), key };
  }
  const p = z.tuple([uint(96), rawAddress, address, address, feeSchema, tickSchema, tickSchema, uint(128), uint(256), uint(256), uint(128), uint(128)]).parse(values[0]);
  return { tokenId: id, owner, token0: p[2], token1: p[3], fee: p[4], lower: p[5], upper: p[6], liquidity: p[7] };
}
type Inspected = { pool: PoolInspection; spacing: number; key?: PoolKey; manual?: PositionData };
async function poolAtBlock(reads: Reads, pair: StockPair, id: Hex, manualId?: bigint): Promise<Inspected> {
  const expected = currencies(pair);
  const warnings = ["Spot price and token inventory are approximate, not execution quotes or USD valuation.", "Liquidity is active in-range liquidity, not pool TVL or an LP count."];
  let token0: Address;
  let token1: Address;
  let fee: number;
  let spacing: number;
  let rawSlot: unknown;
  let liquidity: bigint;
  let key: PoolKey | undefined;
  let manual: PositionData | undefined;
  if (pair.protocol === "uniswap-v3") {
    const poolAddress = address.parse(id);
    await reads.code([V3_FACTORY, V3_NFT, poolAddress]);
    const p = await reads.all([
      call(poolAddress, "token0"), call(poolAddress, "token1"), call(poolAddress, "fee"), call(poolAddress, "factory"),
      call(poolAddress, "slot0"), call(poolAddress, "liquidity"), call(poolAddress, "tickSpacing"), call(V3_NFT, "factory"),
    ]);
    token0 = address.parse(p[0]); token1 = address.parse(p[1]); fee = feeSchema.parse(p[2]);
    demand(address.parse(p[3]) === V3_FACTORY && address.parse(p[7]) === V3_FACTORY, "v3 pool or NFT manager factory linkage failed.");
    demand(token0 === expected[0] && token1 === expected[1], "v3 pool currency pair does not match the source pair.");
    rawSlot = p[4]; liquidity = uint(128).parse(p[5]); spacing = spacingSchema.parse(p[6]);
    const linked = await reads.all([call(V3_FACTORY, "getPool", [token0, token1, fee])]);
    demand(address.parse(linked[0]) === poolAddress, "v3 factory getPool linkage failed.");
  } else {
    await reads.code([V4_POOL_MANAGER, V4_NFT, V4_STATE]);
    const relations = await reads.all([call(V4_NFT, "poolManager"), call(V4_STATE, "poolManager")]);
    demand(relations.every(r => address.parse(r) === V4_POOL_MANAGER), "v4 StateView or NFT manager PoolManager linkage failed.");
    if (manualId !== undefined) {
      manual = positionData("uniswap-v4", manualId, await reads.contracts(positionCalls("uniswap-v4", manualId)));
      key = manual.key!;
      demand(keyHash(key) === id && key.currency0 === expected[0] && key.currency1 === expected[1], "Requested NFT belongs to a different pool.");
      warnings.push("PoolKey verified from the official PositionManager NFT and full key hash; Initialize history was not scanned.");
    } else {
      key = await initializeKey(reads, id, expected);
      warnings.push("PoolKey verified against the official PoolManager Initialize event and full key hash.");
    }
    token0 = key.currency0; token1 = key.currency1; spacing = key.tickSpacing;
    const p = await reads.all([call(V4_STATE, "getSlot0", [id]), call(V4_STATE, "getLiquidity", [id])]);
    rawSlot = p[0]; liquidity = uint(128).parse(p[1]);
    const s = z.tuple([uint(160), tickSchema, z.number().int().min(0).max(0xffffff), feeSchema]).parse(rawSlot);
    fee = s[3]; // Current LP fee, not the PoolKey's dynamic-fee flag, and not an APR.
    demand(key.fee === 0x800000 || key.fee === fee, "v4 static PoolKey fee disagrees with StateView.");
    if (key.fee === 0x800000) warnings.push("Dynamic-fee pool: feeTier is the current StateView LP fee; hooks may override swap fees.");
    if (key.hooks !== ZERO) warnings.push("Hook-enabled pool: inventory excludes hook-specific accounting, charges and withdrawal restrictions.");
  }
  const state = slot(rawSlot);
  const [d0, d1] = await decimals(reads, token0, token1);
  const price = (Number(state.sqrt) / 2 ** 96) ** 2 * 10 ** (d0 - d1);
  demand(Number.isFinite(price) && price > 0, "Unsupported pool price.");
  return { spacing, key, manual, pool: {
    poolId: id, protocol: pair.protocol as PoolInspection["protocol"], chainId: CHAIN_ID,
    blockNumber: reads.block.number.toString(), blockHash: reads.block.hash,
    observedAt: new Date(Number(reads.block.timestamp) * 1000).toISOString(),
    token0: { address: token0, decimals: d0 }, token1: { address: token1, decimals: d1 },
    tick: state.tick, sqrtPriceX96: state.sqrt.toString(), priceToken1PerToken0: price,
    liquidityRaw: liquidity.toString(), feeTier: fee, hooks: key?.hooks ?? null,
    manager: pair.protocol === "uniswap-v4" ? V4_NFT : V3_NFT,
    stateView: pair.protocol === "uniswap-v4" ? V4_STATE : null,
    factory: pair.protocol === "uniswap-v3" ? V3_FACTORY : null, warnings,
  } };
}
function matches(p: PositionData, inspection: Inspected): boolean {
  const pool = inspection.pool;
  return p.token0 === pool.token0.address && p.token1 === pool.token1.address
    && (pool.protocol === "uniswap-v4" ? !!p.key && keyHash(p.key) === pool.poolId : p.fee === pool.feeTier);
}
function positionSnapshot(p: PositionData, inspection: Inspected): PairPosition {
  const pool = inspection.pool;
  demand(p.lower < p.upper && p.lower % inspection.spacing === 0 && p.upper % inspection.spacing === 0, "NFT has an invalid tick range.");
  const scale = 10 ** (pool.token0.decimals - pool.token1.decimals);
  const lower = 1.0001 ** p.lower * scale;
  const upper = 1.0001 ** p.upper * scale;
  demand([lower, upper].every(v => Number.isFinite(v) && v > 0), "NFT price range is unsupported.");
  let amount0: number | null = null;
  let amount1: number | null = null;
  try {
    ({ amount0, amount1 } = inventoryAtPrice(p.liquidity, BigInt(pool.sqrtPriceX96), p.lower, p.upper, pool.token0.decimals, pool.token1.decimals));
  } catch { /* Never replace unavailable inventory with fabricated zero. */ }
  return {
    tokenId: p.tokenId.toString(), poolId: pool.poolId, protocol: pool.protocol, manager: pool.manager,
    owner: p.owner, blockNumber: pool.blockNumber, observedAt: pool.observedAt,
    tickLower: p.lower, tickUpper: p.upper, tick: pool.tick, liquidityRaw: p.liquidity.toString(),
    lowerToken1PerToken0: lower, upperToken1PerToken0: upper, priceToken1PerToken0: pool.priceToken1PerToken0,
    rangeState: p.liquidity === BigInt(0) ? "closed" : pool.tick < p.lower ? "below-range" : pool.tick >= p.upper ? "above-range" : "in-range",
    amount0, amount1,
  };
}

export async function inspectStockPool(pair: StockPair): Promise<PoolInspection> {
  return bounded(async reads => {
    const id = validatePair(pair);
    await reads.start();
    const inspection = await poolAtBlock(reads, pair, id);
    await reads.finish();
    return inspection.pool;
  });
}

export async function inspectStockPositions(pair: StockPair, tokenId?: string): Promise<PairPositions> {
  return bounded(async reads => {
    const id = validatePair(pair);
    if (tokenId !== undefined) demand(isValidLpTokenId(tokenId), "tokenId must be a positive decimal uint256 without leading zeros.");
    const manualId = tokenId === undefined ? undefined : BigInt(tokenId);
    await reads.start();
    const inspection = await poolAtBlock(reads, pair, id, manualId);
    const protocol = inspection.pool.protocol;
    const manager = address.parse(inspection.pool.manager);
    let failed = 0;
    let inspected = 0;
    let selected = 0;
    let selection: string;
    const positions: PairPosition[] = [];
    if (manualId !== undefined) {
      const p = inspection.manual ?? positionData(protocol, manualId, await reads.contracts(positionCalls(protocol, manualId)));
      demand(matches(p, inspection), "Requested NFT belongs to a different pool.");
      positions.push(positionSnapshot(p, inspection));
      selected = inspected = 1;
      selection = `Manual NFT ${manualId}; exact pool match verified`;
    } else {
      const [counter] = await reads.all([call(manager, protocol === "uniswap-v4" ? "nextTokenId" : "totalSupply")]);
      const total = uint(256).parse(counter);
      let ids: bigint[] = [];
      if (protocol === "uniswap-v4") {
        demand(total >= BigInt(1), "Invalid v4 nextTokenId counter.");
        const count = Number(total - BigInt(1) < BigInt(SAMPLE_SIZE) ? total - BigInt(1) : BigInt(SAMPLE_SIZE));
        ids = Array.from({ length: count }, (_, i) => total - BigInt(1 + i));
        selected = count;
        selection = `Newest ${count} minted ID candidates before nextTokenId ${total}; burned/unreadable NFTs count as failures`;
      } else {
        const count = Number(total < BigInt(SAMPLE_SIZE) ? total : BigInt(SAMPLE_SIZE));
        selected = count;
        const indices = Array.from({ length: count }, (_, i) => total - BigInt(1 + i));
        const r = await reads.contracts(indices.map(index => call(manager, "tokenByIndex", [index])));
        r.forEach(result => {
          try { ids.push(uint(256).min(BigInt(1)).parse(required(result))); } catch { failed++; }
        });
        selection = `Last ${count} enumerable slots of ${total} manager NFTs; enumeration order is not guaranteed mint chronology`;
      }
      const unique = [...new Set(ids.map(n => n.toString()))].map(BigInt);
      failed += ids.length - unique.length;
      const width = protocol === "uniswap-v4" ? 3 : 2;
      let results: Result[];
      try { results = await reads.contracts(unique.flatMap(n => positionCalls(protocol, n))); }
      catch { results = unique.flatMap(() => Array.from({ length: width }, (): Result => ({ ok: false }))); }
      unique.forEach((n, i) => {
        try {
          const p = positionData(protocol, n, results.slice(i * width, (i + 1) * width));
          if (matches(p, inspection)) positions.push(positionSnapshot(p, inspection));
          inspected++;
        } catch { failed++; }
      });
    }
    await reads.finish();
    const inventoryFailures = positions.filter(p => p.amount0 === null || p.amount1 === null).length;
    return {
      positions, inspected, failed, poolId: id, observedAt: inspection.pool.observedAt,
      coverage: `${selection}. Selected ${selected}; successfully inspected ${inspected}; failed ${failed}; exact-pool matches ${positions.length}. Block ${inspection.pool.blockNumber}, hash ${inspection.pool.blockHash}. Bounded sample of the official NFT manager only, NOT a whole-pool LP count or all owners; non-NFT/custom-manager positions are excluded. Empty results do not prove no LPs exist. Approximate range inventory only, excluding fees, APR, hook-specific adjustments and withdrawal restrictions; unavailable inventories ${inventoryFailures}.`,
    };
  });
}
