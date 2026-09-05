import { createPublicClient, http, parseAbi, type Abi, type Address, type Hex } from "viem";
import { z } from "zod";

// Fixed, public, read-only mainnet inspector. No environment/provider overrides.
// https://docs.robinhood.com/chain/connecting (rate-limited; no production SLA)
// https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments.md
// https://developers.uniswap.org/docs/sdks/v3/guides/managing-liquidity/position-fetching.md
const CHAIN_ID = 4663;
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const POSITION_MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const ZERO = "0x0000000000000000000000000000000000000000";
const TOTAL_TIMEOUT_MS = 18_000;
const RPC_TIMEOUT_MS = 5_500;
const MAX_REQUESTS = 17;
const UNAVAILABLE = "Public position data is unavailable. The position may not exist or the public RPC may be unavailable.";

export interface LpPositionSnapshot {
  chainId: 4663;
  protocol: "uniswap-v3";
  tokenId: string;
  positionManager: string;
  factory: string;
  pool: string;
  owner: string;
  blockNumber: string;
  blockHash: string;
  observedAt: string;
  token0: { address: string; decimals: number };
  token1: { address: string; decimals: number };
  /** Raw hundredths of a basis point, not an APR or earned fee amount. */
  feeTier: number;
  tick: number;
  tickLower: number;
  tickUpper: number;
  liquidityRaw: string;
  sqrtPriceX96: string;
  /** Approximate token1 per token0, never USD or a performance measure. */
  priceToken1PerToken0: number;
  lowerToken1PerToken0: number;
  upperToken1PerToken0: number;
  rangeState: "in-range" | "below-range" | "above-range" | "closed";
}

const ABI = parseAbi([
  "function factory() view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function getPool(address token0, address token1, uint24 fee) view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function decimals() view returns (uint8)",
]);

// Minimal read-only injection seam for tests. Unknown results are validated below.
export interface LpPositionReadRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber: bigint;
}
export interface LpPositionReadClient {
  getChainId(): Promise<number>;
  getBlock(input: { blockTag?: "latest"; blockNumber?: bigint }): Promise<{
    number: bigint | null; hash: Hex | null; timestamp: bigint;
  }>;
  getCode(input: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  readContract(input: LpPositionReadRequest): Promise<unknown>;
}

const uint = (bits: number) => z.bigint().min(BigInt(0)).max(BigInt(2) ** BigInt(bits) - BigInt(1));
const rawAddress = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => value.toLowerCase() as Address);
const address = rawAddress.refine((value) => value !== ZERO);
const tickSchema = z.number().int().min(-887272).max(887272);
const decimalsSchema = z.number().int().min(0).max(36);
const feeSchema = z.number().int().min(1).max(999999);
const positionSchema = z.tuple([
  uint(96), rawAddress, address, address, feeSchema, tickSchema, tickSchema, uint(128),
  uint(256), uint(256), uint(128), uint(128),
]);
const slotSchema = z.tuple([
  // Canonical v3 TickMath domain: lower inclusive, upper exclusive.
  uint(160).refine((value) => value >= BigInt("4295128739")
    && value < BigInt("1461446703485210103287273052203988822378723970342")), tickSchema,
  z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.boolean(),
]);
const blockSchema = z.object({
  number: z.bigint().min(BigInt(0)),
  hash: z.string().regex(/^0x[\da-fA-F]{64}$/).refine((value) => !/^0x0+$/.test(value)),
  timestamp: z.bigint().min(BigInt(0)),
});

// Only internal, fixed messages may cross the adapter boundary; never RPC errors.
class UnavailableError extends Error {}
function requireState(condition: unknown, message: string): asserts condition {
  if (!condition) throw new UnavailableError(message);
}
function requireFresh(timestamp: bigint, nowMs: number) {
  const age = nowMs / 1000 - Number(timestamp);
  requireState(Number.isFinite(age) && age >= -30 && age <= 120,
    "Public position data failed the block freshness check.");
}

/** Canonical positive decimal uint256; bounded before parsing and before any RPC. */
export function isValidLpTokenId(tokenId: string): boolean {
  return typeof tokenId === "string" && /^[1-9][0-9]{0,77}$/.test(tokenId)
    && BigInt(tokenId) < BigInt(2) ** BigInt(256);
}

function publicReadClient(signal: AbortSignal): LpPositionReadClient {
  let requests = 0;
  const client = createPublicClient({
    cacheTime: 0,
    batch: { multicall: false },
    transport: http(RPC, {
      retryCount: 0,
      timeout: RPC_TIMEOUT_MS,
      batch: false,
      fetchFn: (url, init) => {
        signal.throwIfAborted();
        requireState(++requests <= MAX_REQUESTS, "Public position request limit exceeded.");
        // Combine the total deadline and per-request deadline, including body reads.
        return fetch(url, {
          ...init, cache: "no-store", redirect: "error",
          signal: AbortSignal.any([
            signal, AbortSignal.timeout(RPC_TIMEOUT_MS), ...(init?.signal ? [init.signal] : []),
          ]),
        });
      },
    }),
  });
  return {
    getChainId: () => client.getChainId(),
    getBlock: ({ blockNumber }) => client.getBlock(blockNumber === undefined
      ? { blockTag: "latest" } : { blockNumber }),
    getCode: (input) => client.getCode(input),
    readContract: (input) => client.readContract(input),
  };
}

/** Test seam; production always uses publicReadClient, never caller-supplied URLs. */
export function createLpPositionFetcher(
  clientFactory: (signal: AbortSignal) => LpPositionReadClient,
  now: () => number = Date.now,
): (tokenId: string) => Promise<LpPositionSnapshot> {
  return async (tokenId) => {
    if (!isValidLpTokenId(tokenId)) throw new Error("tokenId must be a positive decimal uint256 without leading zeros.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new UnavailableError("Public position request timed out."));
        controller.abort();
      }, TOTAL_TIMEOUT_MS);
    });
    try {
      const client = clientFactory(controller.signal);
      // Prevent additional requests after a timeout, including with a delayed test client.
      const read = async <T>(operation: () => Promise<T>): Promise<T> => {
        controller.signal.throwIfAborted();
        const value = await operation();
        controller.signal.throwIfAborted();
        return value;
      };
      const inspect = async (): Promise<LpPositionSnapshot> => {
        requireState(await read(() => client.getChainId()) === CHAIN_ID,
          "Public position data failed the network check.");
        const block = blockSchema.parse(await read(() => client.getBlock({ blockTag: "latest" })));
        requireFresh(block.timestamp, now());
        const blockNumber = block.number;
        const contract = (target: Address, functionName: string, args?: readonly unknown[]) =>
          read(() => client.readContract({ address: target, abi: ABI, functionName, args, blockNumber }));
        const requireCode = async (target: Address) => {
          const code = await read(() => client.getCode({ address: target, blockNumber }));
          requireState(typeof code === "string" && /^0x(?:[\da-fA-F]{2})+$/.test(code),
            "Public position data is unavailable: required contract code is missing.");
        };
        await Promise.all([requireCode(POSITION_MANAGER), requireCode(FACTORY)]);
        const [managerFactory, rawPosition, rawOwner] = await Promise.all([
          contract(POSITION_MANAGER, "factory"),
          contract(POSITION_MANAGER, "positions", [BigInt(tokenId)]),
          contract(POSITION_MANAGER, "ownerOf", [BigInt(tokenId)]),
        ]);
        requireState(address.parse(managerFactory) === FACTORY,
          "Public position data failed the manager provenance check.");
        const owner = address.parse(rawOwner);
        const [, , token0, token1, feeTier, tickLower, tickUpper, liquidity] = positionSchema.parse(rawPosition);
        requireState(BigInt(token0) < BigInt(token1) && tickLower < tickUpper,
          "Public position data has an invalid token pair or tick range.");
        const pool = address.parse(await contract(FACTORY, "getPool", [token0, token1, feeTier]));
        await requireCode(pool);
        const [poolFactory, poolToken0, poolToken1, poolFee, rawSlot, rawDecimals0, rawDecimals1] = await Promise.all([
          contract(pool, "factory"), contract(pool, "token0"), contract(pool, "token1"),
          contract(pool, "fee"), contract(pool, "slot0"), contract(token0, "decimals"), contract(token1, "decimals"),
        ]);
        requireState(address.parse(poolFactory) === FACTORY && address.parse(poolToken0) === token0
          && address.parse(poolToken1) === token1 && feeSchema.parse(poolFee) === feeTier,
        "Public position data failed the pool provenance check.");
        const [sqrtPriceX96, tick] = slotSchema.parse(rawSlot);
        const approximateTick = 2 * Math.log(Number(sqrtPriceX96) / 2 ** 96) / Math.log(1.0001);
        requireState(approximateTick >= tick - 1e-6 && approximateTick <= tick + 1 + 1e-6,
          "Public position data has inconsistent price and tick state.");
        const decimals0 = decimalsSchema.parse(rawDecimals0);
        const decimals1 = decimalsSchema.parse(rawDecimals1);
        const scale = 10 ** (decimals0 - decimals1);
        const priceToken1PerToken0 = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * scale;
        const lowerToken1PerToken0 = 1.0001 ** tickLower * scale;
        const upperToken1PerToken0 = 1.0001 ** tickUpper * scale;
        requireState([priceToken1PerToken0, lowerToken1PerToken0, upperToken1PerToken0]
          .every((value) => Number.isFinite(value) && value > 0),
        "Public position data has an unsupported price.");
        // All state reads use one block number. Re-read its hash to reject reorgs.
        const finalBlock = blockSchema.parse(await read(() => client.getBlock({ blockNumber })));
        requireState(finalBlock.number === blockNumber && finalBlock.hash.toLowerCase() === block.hash.toLowerCase()
          && finalBlock.timestamp === block.timestamp,
        "Public position data changed block identity during the read.");
        const observedAtMs = now();
        requireFresh(block.timestamp, observedAtMs);
        return {
          chainId: CHAIN_ID, protocol: "uniswap-v3", tokenId, positionManager: POSITION_MANAGER,
          factory: FACTORY, pool, owner, blockNumber: blockNumber.toString(), blockHash: block.hash,
          // Freshness in the UI follows the source block, NOT the fetch clock.
          observedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
          token0: { address: token0, decimals: decimals0 }, token1: { address: token1, decimals: decimals1 },
          feeTier, tick, tickLower, tickUpper, liquidityRaw: liquidity.toString(), sqrtPriceX96: sqrtPriceX96.toString(),
          priceToken1PerToken0, lowerToken1PerToken0, upperToken1PerToken0,
          rangeState: liquidity === BigInt(0) ? "closed"
            : tick < tickLower ? "below-range" : tick >= tickUpper ? "above-range" : "in-range",
        };
      };
      return await Promise.race([inspect(), deadline]);
    } catch (error) {
      throw new Error(error instanceof UnavailableError ? error.message : UNAVAILABLE);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

const fetchPublicPosition = createLpPositionFetcher(publicReadClient);
export async function fetchLpPosition(tokenId: string): Promise<LpPositionSnapshot> {
  return fetchPublicPosition(tokenId);
}
