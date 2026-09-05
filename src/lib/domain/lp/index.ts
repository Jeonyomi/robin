import { z } from "zod";

/**
 * Manual, quote-per-base scenarios only: one deposit and one unchanged v3-style
 * range. No wallet/pool accounting, ticks, token rounding, rebalances, fee growth,
 * reinvestment, live prices, or inferred fees. All monetary values use quote units.
 *
 * Bounds are engineering limits, not market limits. Positive inputs must be in
 * [1e-100, 1e100] (days additionally <= 36500); fees/costs also accept zero/null.
 * These bounds leave headroom for price ratios, inventory, liquidity and APR in
 * IEEE-754 doubles. Derived values are checked too: never return NaN, Infinity,
 * subnormal amounts, or a zero inventory where a positive amount is required.
 */
const MIN_INPUT = 1e-100;
const MAX_INPUT = 1e100;
const MIN_NORMAL = 2 ** -1022;
const positiveNumber = z.number().finite().min(MIN_INPUT).max(MAX_INPUT);
const nonnegativeNumber = z.union([z.literal(0), positiveNumber]);

const PositionFieldsSchema = z.object({
  id: z.string().max(80),
  label: z.string().trim().min(1).max(60),
  baseSymbol: z.string().trim().min(1).max(16),
  quoteSymbol: z.string().trim().min(1).max(16),
  entryPrice: positiveNumber,
  currentPrice: positiveNumber,
  lowerPrice: positiveNumber,
  upperPrice: positiveNumber,
  capitalQuote: positiveNumber,
  feesQuote: nonnegativeNumber.nullable(),
  costsQuote: nonnegativeNumber.nullable(),
  elapsedDays: z.number().finite().min(MIN_INPUT).max(36500).nullable(),
  // Timezone required; clock-based freshness/future rejection belongs to callers.
  observedAt: z.iso.datetime({ offset: true }),
});

type PositionFields = z.infer<typeof PositionFieldsSchema>;
type PositionAnalysis = {
  liquidity: number;
  entryBase: number;
  entryQuote: number;
  currentBase: number;
  currentQuote: number;
  lpValueQuote: number;
  holdValueQuote: number;
  divergenceQuote: number;
  divergencePct: number;
  feesAprPct: number | null;
  netVsHoldQuote: number | null;
  netPnlQuote: number | null;
  rangeState: "below-range" | "in-range" | "above-range";
  rangeProgressPct: number;
  nearestEdgePct: number;
  narrowRange: boolean;
};

function requirePositive(value: number): void {
  if (!Number.isFinite(value) || value < MIN_NORMAL) {
    throw new RangeError("Scenario has an unrepresentable positive amount");
  }
}

/**
 * For a=sqrt(lower), b=sqrt(upper), s=sqrt(clamped price):
 *   base/L  = 1/s - 1/b = (upper-price)/((b+s)*s*b)
 *   quote/L = s - a     = (price-lower)/(s+a).
 * Rationalizing each root difference avoids catastrophic cancellation for narrow
 * ranges, even when two distinct prices round to the same Math.sqrt result.
 * Divisions are staged rather than multiplying a potentially huge denominator.
 */
function amountsPerLiquidity(price: number, lower: number, upper: number) {
  const root = Math.sqrt(price);
  const upperRoot = Math.sqrt(upper);
  return {
    base: (upper - price) / (upperRoot + root) / root / upperRoot,
    quote: (price - lower) / (root + Math.sqrt(lower)),
  };
}

function calculate(position: PositionFields): PositionAnalysis {
  const { entryPrice, currentPrice, lowerPrice, upperPrice, capitalQuote, feesQuote, costsQuote, elapsedDays } = position;
  const entry = amountsPerLiquidity(entryPrice, lowerPrice, upperPrice);
  const entryValuePerLiquidity = entry.base * entryPrice + entry.quote;
  requirePositive(entryValuePerLiquidity);

  // Capital = L * (entry base/L * entry price + entry quote/L).
  const liquidity = capitalQuote / entryValuePerLiquidity;
  const entryBase = liquidity * entry.base;
  const entryQuote = liquidity * entry.quote;
  const clampedPrice = Math.max(lowerPrice, Math.min(upperPrice, currentPrice));
  const current = amountsPerLiquidity(clampedPrice, lowerPrice, upperPrice);
  const currentBase = liquidity * current.base;
  const currentQuote = liquidity * current.quote;
  // Clamp inventory only. Both LP and the original deposited basket are marked
  // at the actual supplied current price, including beyond either range edge.
  const lpValueQuote = currentBase * currentPrice + currentQuote;
  const holdValueQuote = entryBase * currentPrice + entryQuote;

  /**
   * Divergence is LP value minus the SAME entry quantities held, not full-range
   * constant-product IL. Inside the range its algebraic identity is
   *   D(p) = -L * (sqrt(p)-sqrt(entry))^2 / sqrt(entry).
   * Evaluating that identity preserves tiny losses when LP and hold values round
   * to the same double. Rationalize the root difference before squaring it.
   * Outside the range, extend from the clamped boundary using its linear tail:
   *   below: D(lower) - (lower-p)*L*(1/sqrt(lower)-1/sqrt(entry))
   *   above: D(upper) - (p-upper)*entryBase.
   */
  const entryRoot = Math.sqrt(entryPrice);
  const rootDifference = (clampedPrice - entryPrice) / (Math.sqrt(clampedPrice) + entryRoot);
  let loss = (liquidity * (rootDifference / entryRoot)) * rootDifference;
  if (currentPrice < lowerPrice) {
    const lowerRoot = Math.sqrt(lowerPrice);
    const extraBase = liquidity * ((entryPrice - lowerPrice) / (entryRoot + lowerRoot) / entryRoot / lowerRoot);
    loss += (lowerPrice - currentPrice) * extraBase;
  } else if (currentPrice > upperPrice) {
    loss += (currentPrice - upperPrice) * entryBase;
  }
  const divergenceQuote = loss === 0 ? 0 : -loss;
  const divergencePct = (divergenceQuote / holdValueQuote) * 100;

  // Historical simple APR, not APY or a forecast. Do not annualize sub-day fees.
  const feesAprPct = feesQuote !== null && elapsedDays !== null && elapsedDays >= 1
    ? (feesQuote / capitalQuote) * (365 / elapsedDays) * 100
    : null;
  // Unknown is never zero. Both supplied amounts are required for either net.
  const netFees = feesQuote !== null && costsQuote !== null ? feesQuote - costsQuote : null;
  const netVsHoldQuote = netFees === null ? null : divergenceQuote + netFees;
  const netPnlQuote = netFees === null ? null : (lpValueQuote - capitalQuote) + netFees;

  const result: PositionAnalysis = {
    liquidity,
    entryBase,
    entryQuote,
    currentBase,
    currentQuote,
    lpValueQuote,
    holdValueQuote,
    divergenceQuote,
    divergencePct,
    feesAprPct,
    netVsHoldQuote,
    netPnlQuote,
    // v3 convention: [lower, upper), even though quote inventory is zero at lower.
    rangeState: currentPrice < lowerPrice ? "below-range" : currentPrice >= upperPrice ? "above-range" : "in-range",
    rangeProgressPct: Math.max(0, Math.min(100, ((clampedPrice - lowerPrice) / (upperPrice - lowerPrice)) * 100)),
    // Price-relative distance, NOT the fraction of range width.
    nearestEdgePct: (Math.min(Math.abs(currentPrice - lowerPrice), Math.abs(currentPrice - upperPrice)) / currentPrice) * 100,
    // Equivalent to upper/lower - 1 <= 0.10 without cancellation at exactly 10%.
    narrowRange: upperPrice <= lowerPrice * 1.1,
  };

  for (const value of Object.values(result)) {
    if (typeof value === "number" && (!Number.isFinite(value) || (value !== 0 && Math.abs(value) < MIN_NORMAL))) {
      throw new RangeError("Scenario exceeds supported numerical precision");
    }
  }
  for (const value of [liquidity, entryBase, entryQuote, lpValueQuote, holdValueQuote]) requirePositive(value);
  if (currentPrice < upperPrice) requirePositive(currentBase);
  if (currentPrice > lowerPrice) requirePositive(currentQuote);
  if (currentBase < 0 || currentQuote < 0 || loss < 0 || (currentPrice !== entryPrice && loss === 0)) {
    throw new RangeError("Scenario has an unrepresentable inventory or divergence");
  }
  if (feesQuote !== null && feesQuote > 0 && feesAprPct !== null) requirePositive(feesAprPct);
  return result;
}

/** Unknown properties are stripped. No defaults, coercion, guessed fees, or clock. */
export const PositionInputSchema = PositionFieldsSchema.superRefine((position, context) => {
  if (!(position.lowerPrice < position.upperPrice)) {
    context.addIssue({ code: "custom", path: ["lowerPrice"], message: "Lower price must be strictly below upper price" });
    return;
  }
  if (!(position.entryPrice > position.lowerPrice && position.entryPrice < position.upperPrice)) {
    context.addIssue({ code: "custom", path: ["entryPrice"], message: "Entry price must be strictly inside the range; out-of-range deposits are unsupported" });
    return;
  }
  // Imports fail closed on derived arithmetic too, not just individual fields.
  try {
    calculate(position);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    context.addIssue({ code: "custom", message: "Scenario exceeds supported numerical precision; use less extreme inputs" });
  }
});

export type PositionInput = z.infer<typeof PositionInputSchema>;

/** Pure and deterministic; revalidate at runtime even if a caller asserts the TS type. */
export function analyzePosition(input: PositionInput): PositionAnalysis {
  return calculate(PositionInputSchema.parse(input));
}

/** Portable manual workspace only; callers enforce observation freshness on load. */
export const WorkspaceSchema = z.object({
  version: z.literal(1),
  positions: z.array(PositionInputSchema).max(50),
}).superRefine((workspace, context) => {
  const ids = new Set<string>();
  workspace.positions.forEach((position, index) => {
    if (ids.has(position.id)) {
      context.addIssue({ code: "custom", path: ["positions", index, "id"], message: "Position IDs must be unique" });
    }
    ids.add(position.id);
  });
});
