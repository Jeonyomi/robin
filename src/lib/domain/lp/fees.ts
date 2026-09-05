// Pure math, no RPC or ownership assumptions. Sources:
// https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/Tick.sol (getFeeGrowthInside)
// https://github.com/Uniswap/v3-periphery/blob/main/contracts/NonfungiblePositionManager.sol
const ZERO = BigInt(0);
const Q96 = BigInt(2) ** BigInt(96);
const Q128 = BigInt(2) ** BigInt(128);
const Q256 = BigInt(2) ** BigInt(256);
const MAX128 = Q128 - BigInt(1);
const MAX256 = Q256 - BigInt(1);
const HALF_LOG_TICK = Math.log1p(0.0001) / 2;

function uint(value: bigint, max: bigint, name: string): void {
  if (typeof value !== "bigint" || value < ZERO || value > max) throw new RangeError(`${name} must be an unsigned integer within bounds`);
}
function tick(value: number): void {
  if (!Number.isInteger(value) || value < -887272 || value > 887272) throw new RangeError("Invalid v3 tick");
}
function range(lower: number, upper: number): void {
  tick(lower); tick(upper);
  if (lower >= upper) throw new RangeError("Invalid tick range");
}
function mod256(value: bigint): bigint {
  return ((value % Q256) + Q256) % Q256;
}

/** uint256 modular fee growth within the half-open [lowerTick, upperTick) range. */
export function feeGrowthInside(global: bigint, lowerOutside: bigint, upperOutside: bigint, currentTick: number, lowerTick: number, upperTick: number): bigint {
  uint(global, MAX256, "global"); uint(lowerOutside, MAX256, "lowerOutside"); uint(upperOutside, MAX256, "upperOutside");
  range(lowerTick, upperTick); tick(currentTick);
  const below = currentTick >= lowerTick ? lowerOutside : mod256(global - lowerOutside);
  const above = currentTick < upperTick ? upperOutside : mod256(global - upperOutside);
  return mod256(global - below - above);
}

/** Uncheckpointed entitlement, rounded down in raw token units. Never silently truncate uint128 overflow. */
export function pendingFee(growthInside: bigint, lastGrowthInside: bigint, liquidity: bigint): bigint {
  uint(growthInside, MAX256, "growthInside"); uint(lastGrowthInside, MAX256, "lastGrowthInside"); uint(liquidity, MAX128, "liquidity");
  const result = mod256(growthInside - lastGrowthInside) * liquidity / Q128;
  uint(result, MAX128, "pending fee");
  return result;
}

export type FeeEvent = {
  kind: "increase" | "decrease" | "collect";
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  blockNumber: bigint;
  logIndex: number;
};

/**
 * Lifetime recorded fee entitlement across ALL owners, not realized/net PnL.
 * tokensOwed contains both checkpointed fees and uncollected decreased principal.
 * Callers must provide complete logs through the same block as the live state.
 * Reconciliation catches inconsistencies, but cannot prove logs are complete when
 * omitted events cancel each other (or an omitted collect changes no liquidity).
 */
export function reconcileFeeLedger(input: {
  events: FeeEvent[];
  mintBlock: bigint;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  pending0: bigint;
  pending1: bigint;
}): {
  fees0: bigint; fees1: bigint;
  deposited0: bigint; deposited1: bigint;
  withdrawn0: bigint; withdrawn1: bigint;
  collected0: bigint; collected1: bigint;
  increaseCount: number; decreaseCount: number; collectCount: number;
} {
  uint(input.mintBlock, MAX256, "mintBlock");
  for (const key of ["liquidity", "tokensOwed0", "tokensOwed1", "pending0", "pending1"] as const) uint(input[key], MAX128, key);
  if (!Array.isArray(input.events) || input.events.length === 0) throw new Error("Missing mint increase history");
  for (const event of input.events) {
    if (!event || !["increase", "decrease", "collect"].includes(event.kind)) throw new Error("Invalid fee event kind");
    uint(event.blockNumber, MAX256, "blockNumber"); uint(event.liquidity, MAX128, "event liquidity");
    uint(event.amount0, MAX256, "amount0"); uint(event.amount1, MAX256, "amount1");
    if (!Number.isSafeInteger(event.logIndex) || event.logIndex < 0) throw new Error("Invalid logIndex");
    if (event.blockNumber < input.mintBlock) throw new Error("Pre-mint log");
    if (event.kind === "collect" ? event.liquidity !== ZERO : event.liquidity === ZERO) throw new Error("Invalid event liquidity");
  }
  const events = [...input.events].sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
  if (events[0].kind !== "increase" || events[0].blockNumber !== input.mintBlock) throw new Error("Missing first increase on mintBlock");
  let balance = ZERO;
  const result = { fees0: ZERO, fees1: ZERO, deposited0: ZERO, deposited1: ZERO, withdrawn0: ZERO, withdrawn1: ZERO, collected0: ZERO, collected1: ZERO, increaseCount: 0, decreaseCount: 0, collectCount: 0 };
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (i > 0 && event.blockNumber === events[i - 1].blockNumber && event.logIndex === events[i - 1].logIndex) throw new Error("Duplicate log coordinate");
    if (event.kind === "increase") {
      balance += event.liquidity; result.deposited0 += event.amount0; result.deposited1 += event.amount1; result.increaseCount++;
    } else if (event.kind === "decrease") {
      balance -= event.liquidity; result.withdrawn0 += event.amount0; result.withdrawn1 += event.amount1; result.decreaseCount++;
    } else {
      result.collected0 += event.amount0; result.collected1 += event.amount1; result.collectCount++;
    }
    uint(balance, MAX128, "historical liquidity balance");
  }
  if (balance !== input.liquidity) throw new Error("Incomplete or inconsistent liquidity history");
  result.fees0 = result.collected0 + input.tokensOwed0 + input.pending0 - result.withdrawn0;
  result.fees1 = result.collected1 + input.tokensOwed1 + input.pending1 - result.withdrawn1;
  if (result.fees0 < ZERO || result.fees1 < ZERO) throw new Error("Negative fee entitlement: inconsistent history or counters");
  return result;
}

/**
 * Approximate floating-point inventory for spot valuation, not execution quotes.
 * With a <= s <= b: amount0 = L(1/s - 1/b), amount1 = L(s - a).
 * Tick bounds use 1.0001^(tick/2), not exact onchain TickMath rounding.
 * expm1 avoids cancellation in narrow ranges; log1p retains sub-ulp moves near 1.
 */
export function inventoryAtPrice(liquidity: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number, decimals0: number, decimals1: number): { amount0: number; amount1: number } {
  uint(liquidity, MAX128, "liquidity");
  uint(sqrtPriceX96, BigInt(2) ** BigInt(160) - BigInt(1), "sqrtPriceX96");
  if (sqrtPriceX96 === ZERO) throw new RangeError("sqrtPriceX96 must be positive");
  range(tickLower, tickUpper);
  for (const decimals of [decimals0, decimals1]) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new RangeError("Invalid token decimals");
  }
  if (liquidity === ZERO) return { amount0: 0, amount1: 0 };
  const logPrice = sqrtPriceX96 >= Q96 / BigInt(2) && sqrtPriceX96 <= Q96 * BigInt(2)
    ? Math.log1p(Number(sqrtPriceX96 - Q96) / Number(Q96))
    : Math.log(Number(sqrtPriceX96) / Number(Q96));
  const lower = tickLower * HALF_LOG_TICK;
  const upper = tickUpper * HALF_LOG_TICK;
  const price = Math.max(lower, Math.min(upper, logPrice));
  const amount0 = price === upper ? 0 : Number(liquidity) * Math.exp(-price) * -Math.expm1(price - upper) / 10 ** decimals0;
  const amount1 = price === lower ? 0 : Number(liquidity) * Math.exp(lower) * Math.expm1(price - lower) / 10 ** decimals1;
  if (![amount0, amount1].every((amount) => Number.isFinite(amount) && amount >= 0)) throw new RangeError("Non-finite inventory");
  return { amount0, amount1 };
}
