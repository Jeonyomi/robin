import { createPublicClient, decodeEventLog, defineChain, formatUnits, http, keccak256, pad, parseAbi, toEventSelector, toHex, type Abi, type Address, type Hex } from "viem";
import { z } from "zod";
import { setTimeout as waitForRateSlot } from "node:timers/promises";
import { feeGrowthInside, inventoryAtPrice, pendingFee, reconcileFeeLedger, type FeeEvent } from "@/lib/domain/lp/fees";
import { isFreshLeaderboard, LpLeaderboardSchema, LpLeaderSchema, rankLpLeaders, type LpLeaderboard, type LpLeader } from "@/lib/lp-leaders";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3" as const;
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const TIMEOUT_MS = 45_000;
const MAX_SAMPLE = 12;
// Runtime bytecode matched Ethereum's canonical deployment independently.
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const MULTICALL_HASH = "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
const ABI = parseAbi([
  "function factory() view returns (address)", "function WETH9() view returns (address)",
  "function totalSupply() view returns (uint256)", "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
  "function getPool(address,address,uint24) view returns (address)",
  "function token0() view returns (address)", "function token1() view returns (address)",
  "function fee() view returns (uint24)", "function tickSpacing() view returns (int24)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function feeGrowthGlobal0X128() view returns (uint256)", "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24) view returns (uint128,int128,uint256,uint256,int56,uint160,uint32,bool)",
  "function decimals() view returns (uint8)", "function symbol() view returns (string)",
]);
const EVENT_ABI = parseAbi([
  "event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);
const sigs = EVENT_ABI.map((item) => toEventSelector(item));
const uint = (bits: number) => z.bigint().min(BigInt(0)).max(BigInt(2) ** BigInt(bits) - BigInt(1));
const rawAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as Address);
const address = rawAddress.refine((v) => v !== ZERO);
const tick = z.number().int().min(-887272).max(887272);
const blockSchema = z.object({ number: uint(64), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine((v) => !/^0x0+$/.test(v)), timestamp: uint(64) });
const positionSchema = z.tuple([uint(96), rawAddress, address, address, z.number().int().min(1).max(999999), tick, tick, uint(128), uint(256), uint(256), uint(128), uint(128)]);
const slotSchema = z.tuple([uint(160).refine((v) => v >= BigInt("4295128739") && v < BigInt("1461446703485210103287273052203988822378723970342")), tick, z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.boolean()]);
const tickStateSchema = z.tuple([uint(128), z.bigint(), uint(256), uint(256), z.bigint(), uint(160), z.number().int().nonnegative(), z.boolean()]);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const logSchema = z.object({ address: rawAddress, blockNumber: z.string().regex(/^0x[0-9a-fA-F]+$/), blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), logIndex: z.string().regex(/^0x[0-9a-fA-F]+$/), data: hex, topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).min(2).max(4), removed: z.literal(false) });

export interface LeaderReadClient {
  getChainId(): Promise<number>;
  getBlock(input: { blockNumber?: bigint }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
  getCode(input: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  readContract(input: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; blockNumber: bigint }): Promise<unknown>;
  logs(input: { ids: bigint[]; blockNumber: bigint; transfers: boolean }): Promise<unknown>;
}
class SourceError extends Error {}
function requireState(value: unknown, message: string): asserts value { if (!value) throw new SourceError(message); }

/** Bounded, deterministic coverage of the current ERC721 enumerable index, not a global top-N scan. */
export function sampleNftIndices(total: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || total > 2_000_000_000) throw new Error("Unsupported NFT supply.");
  if (total <= MAX_SAMPLE) return Array.from({ length: total }, (_, i) => i);
  const set = new Set<number>();
  const edgeCount = 2; const spread = MAX_SAMPLE - edgeCount * 2 + 2;
  for (let i = 0; i < edgeCount; i++) { set.add(i); set.add(total - 1 - i); }
  for (let i = 0; i < spread; i++) set.add(Math.floor(i * (total - 1) / (spread - 1)));
  for (let i = 0; set.size < MAX_SAMPLE; i++) set.add(Math.floor((i + 0.5) * total / MAX_SAMPLE));
  return [...set].sort((a, b) => a - b);
}

function publicClient(signal: AbortSignal): LeaderReadClient {
  let methods = 0; let requests = 0; let nextRequestAt = 0;
  const fetchFn: typeof fetch = async (url, init) => {
    signal.throwIfAborted();
    // Shared pace across both transports: public RPC has observable burst limits.
    const delay = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Math.max(Date.now(), nextRequestAt) + 350;
    if (delay) await waitForRateSlot(delay, undefined, { signal });
    signal.throwIfAborted();
    const body = JSON.parse(String(init?.body ?? "{}"));
    methods += Array.isArray(body) ? body.length : 1;
    requireState(++requests <= 180 && methods <= 1800, "LP source request budget exceeded.");
    const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) });
    // Bound decoded bodies as well as duration. No arbitrary RPC/provider overrides.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new SourceError("LP source response exceeded its safe limit."); }
        chunks.push(part.value);
      }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { status: response.status, headers: { "Content-Type": "application/json" } });
  };
  // The public RPC limits batch members as requests and returns malformed
  // batch-level 429 bodies. Only verified view calls use EVM Multicall below.
  const transport = () => http(RPC, { retryCount: 0, timeout: 10_000, batch: false, fetchFn });
  const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } }, contracts: { multicall3: { address: MULTICALL } } });
  const calls = createPublicClient({ chain, cacheTime: 0, transport: transport(), batch: { multicall: { batchSize: 4096, wait: 10 } } });
  const isolated = createPublicClient({ cacheTime: 0, transport: transport(), batch: { multicall: false } });
  const multicallChecks = new Map<string, Promise<void>>();
  // eth_getLogs is deliberately not JSON-RPC batched; the public endpoint can
  // return malformed batched log responses even while ordinary eth_call works.
  const logs = createPublicClient({ cacheTime: 0, transport: transport() });
  const births = new Map<string, z.infer<typeof logSchema>>();
  const receipts = new Map<string, Promise<{ transactionHash: string; blockHash: string; blockNumber: string; logs: unknown[] }>>();
  return {
    getChainId: () => calls.getChainId(),
    getBlock: ({ blockNumber }) => calls.getBlock(blockNumber === undefined ? { blockTag: "latest" } : { blockNumber }),
    getCode: (input) => calls.getCode(input),
    readContract: async (input) => {
      // Never mix untrusted token metadata CALLs with source accounting in one
      // simulated EVM transaction. JSON-RPC batching still isolates eth_calls.
      if (["symbol", "decimals"].includes(input.functionName)) return isolated.readContract(input);
      const key = String(input.blockNumber);
      if (!multicallChecks.has(key)) multicallChecks.set(key, isolated.getCode({ address: MULTICALL, blockNumber: input.blockNumber }).then((code) => { requireState(code && keccak256(code) === MULTICALL_HASH, "LP batching contract runtime failed verification."); }));
      await multicallChecks.get(key);
      return calls.readContract(input);
    },
    logs: async ({ ids, blockNumber, transfers }) => {
      if (transfers) {
        // The zero-address Transfer is verified inside the first Increase's
        // successful transaction receipt. Whole-chain Transfer filters time out
        // even for scalar IDs; receipt evidence avoids that unreliable index.
        const pages = await Promise.all(ids.map(async (id) => {
          const birth = births.get(String(id)); if (!birth) return [];
          const hash = birth.transactionHash;
          if (!receipts.has(hash)) receipts.set(hash, calls.request({ method: "eth_getTransactionReceipt", params: [hash as Hex] }).then((raw) => z.object({ status: z.literal("0x1"), transactionHash: z.string(), blockHash: z.string(), blockNumber: z.string(), logs: z.array(z.unknown()).max(4000) }).parse(raw)));
          const receipt = await receipts.get(hash)!;
          requireState(receipt.transactionHash === hash && receipt.blockHash === birth.blockHash && receipt.blockNumber === birth.blockNumber, "LP mint receipt identity failed.");
          return receipt.logs.filter((item) => {
            const log = item as { address?: string; topics?: string[] };
            return log?.address?.toLowerCase() === MANAGER && log.topics?.[0] === sigs[3] && log.topics?.[1] === pad(ZERO) && log.topics?.[3] === pad(toHex(id));
          });
        }));
        return pages.flat();
      }
      // Scalar tokenId at topic1 is the reliable sparse history index. The
      // event signatures are validated after retrieval rather than OR-filtered.
      const collected: unknown[] = [];
      for (let offset = 0; offset < ids.length; offset += 3) {
        const group = ids.slice(offset, offset + 3);
        const pages = await Promise.all(group.map((id) => logs.request({ method: "eth_getLogs", params: [{ address: MANAGER, fromBlock: "0x0", toBlock: toHex(blockNumber), topics: [null, pad(toHex(id))] }] })));
        for (let i = 0; i < pages.length; i++) {
          const page = z.array(z.unknown()).max(4000).parse(pages[i]);
          for (const item of page) {
            const log = logSchema.parse(item);
            if (log.topics[0] !== sigs[0]) continue;
            requireState(log.address === MANAGER && log.topics[1] === pad(toHex(group[i])), "LP first-increase provenance failed.");
            const previous = births.get(String(group[i]));
            if (!previous || BigInt(log.blockNumber) < BigInt(previous.blockNumber) || (log.blockNumber === previous.blockNumber && BigInt(log.logIndex) < BigInt(previous.logIndex))) births.set(String(group[i]), log);
          }
          collected.push(...page);
        }
        requireState(collected.length <= 4000, "LP history exceeded its safe limit.");
      }
      return collected;
    },
  };
}

type History = { fees: FeeEvent[]; transfers: { blockNumber: bigint; logIndex: number; from: Address; to: Address }[] };
function histories(raw: unknown[], ids: bigint[], endBlock: bigint): Map<string, History> {
  const result = new Map(ids.map((id) => [String(id), { fees: [], transfers: [] } as History]));
  const unique = new Set<string>();
  requireState(raw.length <= 4000, "LP history exceeded the bounded scan limit.");
  for (const item of raw) {
    const log = logSchema.parse(item);
    requireState(log.address === MANAGER && BigInt(log.blockNumber) <= endBlock, "LP log provenance failed.");
    const key = `${BigInt(log.blockNumber)}:${BigInt(log.logIndex)}`;
    requireState(!unique.has(key), "LP source returned duplicate log coordinates."); unique.add(key);
    const event = decodeEventLog({ abi: EVENT_ABI, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
    const history = result.get(String(event.args.tokenId));
    requireState(history, "LP source returned an unrelated NFT log.");
    const blockNumber = BigInt(log.blockNumber); const logIndex = Number(BigInt(log.logIndex));
    requireState(Number.isSafeInteger(logIndex), "LP log coordinate is invalid.");
    if (event.eventName === "Transfer") history.transfers.push({ blockNumber, logIndex, from: rawAddress.parse(event.args.from), to: rawAddress.parse(event.args.to) });
    else history.fees.push({ kind: event.eventName === "IncreaseLiquidity" ? "increase" : event.eventName === "DecreaseLiquidity" ? "decrease" : "collect", liquidity: "liquidity" in event.args ? event.args.liquidity : BigInt(0), amount0: event.args.amount0, amount1: event.args.amount1, blockNumber, logIndex });
  }
  for (const history of result.values()) history.transfers.sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
  return result;
}

/** Pure read-client seam for network, block, sampling and accounting failure tests. */
export function createLpLeaderboardFetcher(factory: (signal: AbortSignal) => LeaderReadClient, now: () => number = Date.now) {
  return async (): Promise<LpLeaderboard> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SourceError("LP ranking request timed out. No stale ranking is substituted.")); }, TIMEOUT_MS); });
    const scan = async (): Promise<LpLeaderboard> => {
      const client = factory(controller.signal);
      const read = async <T>(fn: () => Promise<T>) => { controller.signal.throwIfAborted(); const result = await fn(); controller.signal.throwIfAborted(); return result; };
      requireState(await read(() => client.getChainId()) === 4663, "LP source network identity failed.");
      const block = blockSchema.parse(await read(() => client.getBlock({})));
      const observedAt = new Date(Number(block.timestamp) * 1000).toISOString();
      requireState(isFreshLeaderboard({ observedAt }, now()), "LP source block is stale.");
      const memo = new Map<string, Promise<unknown>>();
      const contract = (target: Address, functionName: string, args?: readonly unknown[]): Promise<unknown> => {
        const key = `${target}:${functionName}:${(args ?? []).map(String).join(":")}`;
        if (!memo.has(key)) memo.set(key, read(() => client.readContract({ address: target, abi: ABI, functionName, args, blockNumber: block.number })));
        return memo.get(key)!;
      };
      const checkedCode = new Map<string, Promise<void>>();
      const code = (target: Address) => {
        if (!checkedCode.has(target)) checkedCode.set(target, read(() => client.getCode({ address: target, blockNumber: block.number })).then((value) => { requireState(typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value), "LP contract code is unavailable."); }));
        return checkedCode.get(target)!;
      };
      await Promise.all([code(MANAGER), code(FACTORY)]);
      const [managerFactory, rawWeth, rawSupply] = await Promise.all([contract(MANAGER, "factory"), contract(MANAGER, "WETH9"), contract(MANAGER, "totalSupply")]);
      requireState(address.parse(managerFactory) === FACTORY, "LP manager provenance failed.");
      const weth = address.parse(rawWeth); await code(weth);
      requireState(await contract(weth, "decimals") === 18, "Unsupported wrapped-native denomination.");
      const supply = Number(uint(64).parse(rawSupply));
      const indices = sampleNftIndices(supply);
      const ids = await Promise.all(indices.map(async (index) => uint(256).refine((v) => v > BigInt(0)).parse(await contract(MANAGER, "tokenByIndex", [BigInt(index)]))));
      requireState(new Set(ids.map(String)).size === ids.length, "LP enumeration returned duplicate NFTs.");
      if (!ids.length) return LpLeaderboardSchema.parse({ chainId: 4663, protocol: "uniswap-v3", positionManager: MANAGER, weth, blockNumber: String(block.number), blockHash: block.hash, observedAt, totalNfts: supply, sampled: 0, eligible: 0, excluded: 0, unsupported: 0, sampleMethod: "stratified-enumerable-indices-v1", ranking: "lifetime-native-weth-fees", rows: [] });
      const feeLogs = z.array(z.unknown()).max(4000).parse(await read(() => client.logs({ ids, blockNumber: block.number, transfers: false })));
      const mintLogs = z.array(z.unknown()).max(4000).parse(await read(() => client.logs({ ids, blockNumber: block.number, transfers: true })));
      const historyById = histories([...feeLogs, ...mintLogs], ids, block.number);
      const mintBlocks = new Map<string, Promise<z.infer<typeof blockSchema>>>();
      const mintBlock = (number: bigint) => {
        const key = String(number);
        if (!mintBlocks.has(key)) mintBlocks.set(key, read(() => client.getBlock({ blockNumber: number })).then((value) => { const result = blockSchema.parse(value); requireState(result.number === number && result.timestamp <= block.timestamp, "LP mint block failed validation."); return result; }));
        return mintBlocks.get(key)!;
      };
      const metadata = async (target: Address) => {
        await code(target);
        const [rawDecimals, rawSymbol] = await Promise.all([contract(target, "decimals"), contract(target, "symbol").catch(() => `${target.slice(0, 6)}…${target.slice(-4)}`)]);
        return { address: target, decimals: z.number().int().min(0).max(36).parse(rawDecimals), symbol: typeof rawSymbol === "string" && rawSymbol.trim() && rawSymbol.length <= 24 && !/[\u0000-\u001f\u007f]/.test(rawSymbol) ? rawSymbol.trim() : `${target.slice(0, 6)}…${target.slice(-4)}` };
      };
      const results = await Promise.all(ids.map(async (id): Promise<{ state: "eligible"; row: LpLeader } | { state: "unsupported" | "excluded" }> => {
        try {
          const position = positionSchema.parse(await contract(MANAGER, "positions", [id]));
          const [, , token0, token1, fee, lo, hi, liquidity, last0, last1, owed0, owed1] = position;
          requireState(BigInt(token0) < BigInt(token1) && lo < hi, "LP position shape failed.");
          if (token0 !== weth && token1 !== weth) return { state: "unsupported" };
          const [rawOwner, rawPool] = await Promise.all([contract(MANAGER, "ownerOf", [id]), contract(FACTORY, "getPool", [token0, token1, fee])]);
          const owner = address.parse(rawOwner); const pool = address.parse(rawPool); await code(pool);
          const [pf, p0, p1, pfee, rawSpacing, rawSlot, rawG0, rawG1, meta0, meta1] = await Promise.all([contract(pool, "factory"), contract(pool, "token0"), contract(pool, "token1"), contract(pool, "fee"), contract(pool, "tickSpacing"), contract(pool, "slot0"), contract(pool, "feeGrowthGlobal0X128"), contract(pool, "feeGrowthGlobal1X128"), metadata(token0), metadata(token1)]);
          const spacing = z.number().int().positive().max(887272).parse(rawSpacing);
          requireState(address.parse(pf) === FACTORY && address.parse(p0) === token0 && address.parse(p1) === token1 && pfee === fee && lo % spacing === 0 && hi % spacing === 0, "LP pool provenance failed.");
          const [sqrtPriceX96, currentTick] = slotSchema.parse(rawSlot);
          const approxTick = 2 * Math.log(Number(sqrtPriceX96) / 2 ** 96) / Math.log(1.0001);
          requireState(approxTick >= currentTick - 1e-6 && approxTick <= currentTick + 1 + 1e-6, "LP price/tick state is inconsistent.");
          let pending0 = BigInt(0); let pending1 = BigInt(0);
          if (liquidity > BigInt(0)) {
            const [lower, upper] = await Promise.all([contract(pool, "ticks", [lo]), contract(pool, "ticks", [hi])]);
            const low = tickStateSchema.parse(lower); const high = tickStateSchema.parse(upper);
            requireState(low[7] && high[7] && low[0] >= liquidity && high[0] >= liquidity, "LP range ticks are not initialized.");
            pending0 = pendingFee(feeGrowthInside(uint(256).parse(rawG0), low[2], high[2], currentTick, lo, hi), last0, liquidity);
            pending1 = pendingFee(feeGrowthInside(uint(256).parse(rawG1), low[3], high[3], currentTick, lo, hi), last1, liquidity);
          }
          const history = historyById.get(String(id))!;
          const transfers = history.transfers;
          // Mint-only filter is indexed; full Transfer history can time out.
          // Current owner is read independently. No ownership transfer count is claimed.
          requireState(transfers.length === 1 && transfers[0].from === ZERO && transfers[0].to !== ZERO, "LP mint evidence is incomplete.");
          const ledger = reconcileFeeLedger({ events: history.fees, mintBlock: transfers[0].blockNumber, liquidity, tokensOwed0: owed0, tokensOwed1: owed1, pending0, pending1 });
          const minted = await mintBlock(transfers[0].blockNumber);
          const { amount0, amount1 } = inventoryAtPrice(liquidity, sqrtPriceX96, lo, hi, meta0.decimals, meta1.decimals);
          const p01 = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (meta0.decimals - meta1.decimals);
          const lower01 = 1.0001 ** lo * 10 ** (meta0.decimals - meta1.decimals);
          const upper01 = 1.0001 ** hi * 10 ** (meta0.decimals - meta1.decimals);
          const wethIs0 = token0 === weth;
          const price = wethIs0 ? 1 / p01 : p01;
          const lower = wethIs0 ? 1 / upper01 : lower01; const upper = wethIs0 ? 1 / lower01 : upper01;
          const fees0 = Number(formatUnits(ledger.fees0, meta0.decimals)); const fees1 = Number(formatUnits(ledger.fees1, meta1.decimals));
          const toWeth = (a0: number, a1: number) => wethIs0 ? a0 + a1 / p01 : a0 * p01 + a1;
          const width = (upper / lower - 1) * 100;
          const state = liquidity === BigInt(0) ? "closed" : (wethIs0 ? currentTick >= hi : currentTick < lo) ? "below-range" : (wethIs0 ? currentTick < lo : currentTick >= hi) ? "above-range" : "in-range";
          return { state: "eligible", row: LpLeaderSchema.parse({ tokenId: String(id), pool, owner, token0: meta0, token1: meta1, baseSymbol: wethIs0 ? meta1.symbol : meta0.symbol, baseAddress: wethIs0 ? token1 : token0, feeTier: fee, feeIncomeWeth: wethIs0 ? fees0 : fees1, spotFeeValueWeth: toWeth(fees0, fees1), capitalWeth: toWeth(amount0, amount1), fees0: String(ledger.fees0), fees1: String(ledger.fees1), amount0, amount1, priceWethPerBase: price, lowerWethPerBase: lower, upperWethPerBase: upper, rangeState: state, rangeWidthPct: width, nearestEdgePct: Math.min(Math.abs(price - lower), Math.abs(upper - price)) / price * 100, structure: lo === Math.ceil(-887272 / spacing) * spacing && hi === Math.floor(887272 / spacing) * spacing ? "full-range" : width <= 20 ? "concentrated" : "wide", mintedAt: new Date(Number(minted.timestamp) * 1000).toISOString(), increases: ledger.increaseCount, decreases: ledger.decreaseCount, collections: ledger.collectCount, transfers: null }) };
        } catch { return { state: "excluded" }; }
      }));
      const finalBlock = blockSchema.parse(await read(() => client.getBlock({ blockNumber: block.number })));
      requireState(finalBlock.hash.toLowerCase() === block.hash.toLowerCase() && finalBlock.number === block.number && finalBlock.timestamp === block.timestamp, "LP source block identity changed during collection.");
      requireState(isFreshLeaderboard({ observedAt }, now()), "LP source aged out during collection.");
      const rows = rankLpLeaders(results.flatMap((result) => result.state === "eligible" ? [result.row] : []));
      const excluded = results.filter((result) => result.state === "excluded").length;
      requireState(rows.length > 0 || excluded === 0, "No sampled NFTs passed source and fee-ledger validation.");
      return LpLeaderboardSchema.parse({ chainId: 4663, protocol: "uniswap-v3", positionManager: MANAGER, weth, blockNumber: String(block.number), blockHash: block.hash, observedAt, totalNfts: supply, sampled: ids.length, eligible: rows.length, excluded, unsupported: results.filter((result) => result.state === "unsupported").length, sampleMethod: "stratified-enumerable-indices-v1", ranking: "lifetime-native-weth-fees", rows });
    };
    try { return await Promise.race([scan(), deadline]); }
    catch (error) { throw new Error(error instanceof SourceError ? error.message : "LP ranking data is unavailable. No estimated or stale ranking is substituted.", { cause: error }); }
    finally { clearTimeout(timer); controller.abort(); }
  };
}
const fetchLive = createLpLeaderboardFetcher(publicClient);
let cached: { data: LpLeaderboard; fetchedAt: number } | undefined;
let flight: Promise<LpLeaderboard> | undefined;
export function fetchLpLeaderboard(): Promise<LpLeaderboard> {
  if (cached && Date.now() - cached.fetchedAt < 45_000 && isFreshLeaderboard(cached.data)) return Promise.resolve(cached.data);
  if (!flight) flight = fetchLive().then((data) => { cached = { data, fetchedAt: Date.now() }; return data; }).catch((error) => { cached = undefined; throw error; }).finally(() => { flight = undefined; });
  return flight;
}
