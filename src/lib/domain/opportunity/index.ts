import { OPPORTUNITY_WEIGHTS } from "@/lib/config";

// ── Types ───────────────────────────────────────────────────────────────────

export type OpportunityFactors = {
  capitalFlow: number;        // 0-100
  adoptionMomentum: number;   // 0-100
  liquidityQuality: number;   // 0-100
  smartMoney: number;         // 0-100
  relativeValue: number;      // 0-100
  catalyst: number;           // 0-100
};

export type OpportunityScore = {
  rawScore: number;           // 0-100
  riskScore: number;          // 0-100
  adjustedScore: number;      // 0-100
  factors: OpportunityFactors;
  factorWeights: Record<keyof OpportunityFactors, number>;
  dataCompleteness: number;   // 0-1
  confidence: "HIGH" | "MEDIUM" | "LOW";
  status: "ACTIVE" | "RESTRICTED" | "INSUFFICIENT_DATA";
};

// ── Score Calculation ───────────────────────────────────────────────────────

export function calculateOpportunityScore(params: {
  factors: Partial<OpportunityFactors>;
  riskScore: number;
  dataCompleteness: number;
  restricted: boolean;
}): OpportunityScore {
  const availableFactors: Array<keyof OpportunityFactors> = [];
  let totalWeight = 0;
  let weightedSum = 0;

  // Calculate weighted score with available factors
  for (const [factor, weight] of Object.entries(OPPORTUNITY_WEIGHTS) as Array<[keyof OpportunityFactors, number]>) {
    const value = params.factors[factor];
    if (value !== undefined && value !== null) {
      availableFactors.push(factor);
      totalWeight += weight;
      weightedSum += value * weight;
    }
  }

  // Renormalize if some factors are missing. Factors are already 0-100 and
  // weights sum to 1.0, so weightedSum is the raw score (no extra *100).
  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Apply risk adjustment
  const adjustedScore = rawScore * (1 - params.riskScore / 125);

  // Determine status
  let status: OpportunityScore["status"] = "ACTIVE";
  if (params.restricted) {
    status = "RESTRICTED";
  } else if (params.dataCompleteness < 0.6) {
    status = "INSUFFICIENT_DATA";
  }

  // Calculate confidence
  const confidence = params.dataCompleteness >= 0.9 && availableFactors.length >= 5
    ? "HIGH"
    : params.dataCompleteness >= 0.6 && availableFactors.length >= 3
      ? "MEDIUM"
      : "LOW";

  // Build factor weights object
  const factorWeights = {} as Record<keyof OpportunityFactors, number>;
  for (const [factor, weight] of Object.entries(OPPORTUNITY_WEIGHTS) as Array<[keyof OpportunityFactors, number]>) {
    factorWeights[factor] = availableFactors.includes(factor) ? weight : 0;
  }

  return {
    rawScore: Math.round(rawScore * 100) / 100,
    riskScore: params.riskScore,
    adjustedScore: Math.max(0, Math.round(adjustedScore * 100) / 100),
    factors: params.factors as OpportunityFactors,
    factorWeights,
    dataCompleteness: params.dataCompleteness,
    confidence,
    status,
  };
}

// ── Factor Calculators ──────────────────────────────────────────────────────

export function calculateCapitalFlowFactor(params: {
  netBuyUsd1h: number;
  netBuyUsd24h: number;
  bridgeInflow: number;
  stablecoinInflow: number;
  whaleNetFlow: number;
  smartMoneyNetFlow: number;
  liquidityUsd: number;
}): number {
  // Normalize each metric by liquidity
  const normalized1h = params.liquidityUsd > 0 ? (params.netBuyUsd1h / params.liquidityUsd) * 100 : 0;
  const normalized24h = params.liquidityUsd > 0 ? (params.netBuyUsd24h / params.liquidityUsd) * 100 : 0;
  const normalizedBridge = params.liquidityUsd > 0 ? (params.bridgeInflow / params.liquidityUsd) * 100 : 0;
  const normalizedStable = params.liquidityUsd > 0 ? (params.stablecoinInflow / params.liquidityUsd) * 100 : 0;
  const normalizedWhale = params.liquidityUsd > 0 ? (params.whaleNetFlow / params.liquidityUsd) * 100 : 0;
  const normalizedSmart = params.liquidityUsd > 0 ? (params.smartMoneyNetFlow / params.liquidityUsd) * 100 : 0;

  // Weighted average
  const raw = (
    normalized1h * 0.15 +
    normalized24h * 0.20 +
    normalizedBridge * 0.15 +
    normalizedStable * 0.15 +
    normalizedWhale * 0.15 +
    normalizedSmart * 0.20
  );

  // Clamp to 0-100
  return Math.max(0, Math.min(100, raw));
}

export function calculateAdoptionMomentumFactor(params: {
  holderDelta: number;
  activeHolderDelta: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  newWalletRatio: number;
}): number {
  // Buy/sell ratio
  const totalTraders = params.uniqueBuyers + params.uniqueSellers;
  const buyRatio = totalTraders > 0 ? params.uniqueBuyers / totalTraders : 0.5;

  // Holder growth (normalized)
  const holderGrowth = Math.max(0, Math.min(50, params.holderDelta / 10));

  // Active holder growth
  const activeGrowth = Math.max(0, Math.min(30, params.activeHolderDelta / 5));

  // New wallet quality
  const walletQuality = Math.max(0, Math.min(20, params.newWalletRatio * 100));

  return Math.max(0, Math.min(100,
    holderGrowth + activeGrowth + walletQuality + (buyRatio * 20)
  ));
}

export function calculateLiquidityQualityFactor(params: {
  liquidityUsd: number;
  depth1pctUsd: number;
  volumeUsd: number;
  netLpChange: number;
  poolCount: number;
}): number {
  // Depth ratio (depth / liquidity)
  const depthRatio = params.liquidityUsd > 0 ? params.depth1pctUsd / params.liquidityUsd : 0;

  // Volume/Liquidity ratio
  const volumeLiquidityRatio = params.liquidityUsd > 0 ? params.volumeUsd / params.liquidityUsd : 0;

  // LP stability (positive change is good)
  const lpStability = Math.max(0, Math.min(50, params.netLpChange / 1000));

  // Pool diversity
  const poolDiversity = Math.max(0, Math.min(20, params.poolCount * 5));

  return Math.max(0, Math.min(100,
    depthRatio * 30 +
    volumeLiquidityRatio * 30 +
    lpStability +
    poolDiversity
  ));
}

export function calculateSmartMoneyFactor(params: {
  smartMoneyNetFlow: number;
  profitableWalletAccumulation: number;
  newWalletRatio: number;
  sybilRatio: number;
  botTradeRatio: number;
}): number {
  // Positive smart money flow is good
  const flowScore = Math.max(0, Math.min(40, params.smartMoneyNetFlow / 1000));

  // Profitable wallets accumulating
  const accumulationScore = Math.max(0, Math.min(30, params.profitableWalletAccumulation * 30));

  // New wallet quality (inverse of sybil/bot)
  const qualityScore = Math.max(0, Math.min(30, (1 - params.sybilRatio - params.botTradeRatio) * 30));

  return Math.max(0, Math.min(100, flowScore + accumulationScore + qualityScore));
}

export function calculateRelativeValueFactor(params: {
  premiumDiscount: number; // abs value
  dexPriceVsReference: number;
  multiPoolDispersion: number;
}): number {
  // Higher premium/discount (up to a point) is opportunity
  const premiumScore = Math.min(50, Math.abs(params.premiumDiscount) * 500);

  // Price deviation from reference
  const deviationScore = Math.min(30, Math.abs(params.dexPriceVsReference) * 300);

  // Multi-pool price consistency (lower dispersion is better for confidence)
  const consistencyScore = Math.max(0, 20 - params.multiPoolDispersion * 100);

  return Math.max(0, Math.min(100, premiumScore + deviationScore + consistencyScore));
}

export function calculateCatalystFactor(params: {
  hasNewPool: boolean;
  hasCorporateAction: boolean;
  hasNewListing: boolean;
  hasVolumeSpike: boolean;
}): number {
  let score = 0;
  if (params.hasNewPool) score += 25;
  if (params.hasCorporateAction) score += 25;
  if (params.hasNewListing) score += 25;
  if (params.hasVolumeSpike) score += 25;
  return score;
}
