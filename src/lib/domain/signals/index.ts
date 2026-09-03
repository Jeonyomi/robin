import { SIGNAL_CONFIG } from "@/lib/config";

// ── Types ───────────────────────────────────────────────────────────────────

export type SignalType =
  | "SMART_ACCUMULATION"
  | "CAPITAL_ROTATION"
  | "NEW_TOKEN_BREAKOUT"
  | "STOCK_TOKEN_DIVERGENCE"
  | "LIQUIDITY_REMOVAL"
  | "FAKE_MOMENTUM_WARNING"
  | "TICKER_COLLISION"
  | "CONTRACT_RISK_CHANGE";

export type SignalEvidence = {
  metric: string;
  value: number;
  threshold?: number;
  description?: string;
};

export type Signal = {
  id: string;
  type: SignalType;
  entityType: "TOKEN" | "WALLET" | "POOL" | "PROTOCOL";
  entityId: string;
  rawScore: number;
  riskScore: number;
  adjustedScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dataCompleteness: number;
  evidence: SignalEvidence[];
  riskFlags: string[];
  invalidators: string[];
  window: string;
  windowStart: Date;
  windowEnd: Date;
  createdAt: Date;
  status: "ACTIVE" | "EXPIRED" | "INVALIDATED";
};

// ── Signal Generation ───────────────────────────────────────────────────────

export function generateSmartAccumulationSignal(params: {
  tokenAddress: string;
  smartMoneyFlow6h: number;
  holderGrowth24h: number;
  uniqueBuyerGrowth6h: number;
  liquidityChange6h: number;
  top10ConcentrationChange: number;
  dataCompleteness: number;
  windowEnd: Date;
}): Signal | null {
  const config = SIGNAL_CONFIG.smartAccumulation;
  const evidence: SignalEvidence[] = [];
  const invalidators: string[] = [];

  // Check conditions
  const smartMoneyPositive = params.smartMoneyFlow6h > 0;
  const holderGrowing = params.holderGrowth24h > config.minHolderGrowth;
  const buyersGrowing = params.uniqueBuyerGrowth6h > config.minUniqueBuyerGrowth;
  const liquidityStable = params.liquidityChange6h >= config.minLiquidityChange;
  const concentrationOk = params.top10ConcentrationChange <= config.maxConcentrationIncrease;

  // Build evidence
  if (smartMoneyPositive) {
    evidence.push({ metric: "smart_money_net_flow_6h", value: params.smartMoneyFlow6h, threshold: 0 });
  }
  if (holderGrowing) {
    evidence.push({ metric: "holder_growth_24h", value: params.holderGrowth24h, threshold: config.minHolderGrowth });
  }
  if (buyersGrowing) {
    evidence.push({ metric: "unique_buyer_growth_6h", value: params.uniqueBuyerGrowth6h, threshold: config.minUniqueBuyerGrowth });
  }
  if (liquidityStable) {
    evidence.push({ metric: "liquidity_change_6h", value: params.liquidityChange6h, threshold: config.minLiquidityChange });
  }
  if (concentrationOk) {
    evidence.push({ metric: "top10_concentration_change", value: params.top10ConcentrationChange, threshold: config.maxConcentrationIncrease });
  }

  // Add invalidators
  if (!smartMoneyPositive) invalidators.push("smart_money_net_flow_6h <= 0");
  if (!holderGrowing) invalidators.push("holder_growth_24h not positive");
  if (!buyersGrowing) invalidators.push("unique_buyer_growth_6h not positive");
  if (!liquidityStable) invalidators.push("liquidity_change_6h negative");
  if (!concentrationOk) invalidators.push("top10 concentration increased too much");

  // Calculate score (4 of 5 conditions = high confidence)
  const conditionsMet = [smartMoneyPositive, holderGrowing, buyersGrowing, liquidityStable, concentrationOk].filter(Boolean).length;
  const rawScore = (conditionsMet / 5) * 100;
  const confidence = conditionsMet >= 4 ? "HIGH" : conditionsMet >= 3 ? "MEDIUM" : "LOW";

  // Need at least 3 conditions for a valid signal
  if (conditionsMet < 3) return null;

  const now = new Date();
  const windowStart = new Date(params.windowEnd.getTime() - 6 * 60 * 60 * 1000);

  return {
    id: `sig_smart_${params.tokenAddress}_${Date.now()}`,
    type: "SMART_ACCUMULATION",
    entityType: "TOKEN",
    entityId: params.tokenAddress,
    rawScore,
    riskScore: 0, // Will be set by risk engine
    adjustedScore: rawScore, // Will be adjusted by risk
    confidence,
    dataCompleteness: params.dataCompleteness,
    evidence,
    riskFlags: [],
    invalidators,
    window: "6h",
    windowStart,
    windowEnd: params.windowEnd,
    createdAt: now,
    status: "ACTIVE",
  };
}

export function generateCapitalRotationSignal(params: {
  tokenAddress: string;
  bridgeInflow1h: number;
  destinationBuy1h: number;
  liquidityChange1h: number;
  walletDiversification: number; // 0-1
  dataCompleteness: number;
  windowEnd: Date;
}): Signal | null {
  const config = SIGNAL_CONFIG.capitalRotation;
  const evidence: SignalEvidence[] = [];
  const invalidators: string[] = [];

  const bridgeSpike = params.bridgeInflow1h > 0; // Simplified - in production use z-score
  const destinationBuy = params.destinationBuy1h > config.minDestinationBuy;
  const liquidityUp = params.liquidityChange1h > config.minLiquidityChange;
  const diversified = params.walletDiversification > 0.5;

  if (bridgeSpike) evidence.push({ metric: "bridge_net_inflow_1h", value: params.bridgeInflow1h });
  if (destinationBuy) evidence.push({ metric: "destination_token_net_buy_1h", value: params.destinationBuy1h });
  if (liquidityUp) evidence.push({ metric: "dex_liquidity_change_1h", value: params.liquidityChange1h });
  if (diversified) evidence.push({ metric: "wallet_diversification", value: params.walletDiversification });

  if (!bridgeSpike) invalidators.push("bridge_net_inflow_1h not spiking");
  if (!destinationBuy) invalidators.push("destination buy not positive");
  if (!liquidityUp) invalidators.push("liquidity not increasing");
  if (!diversified) invalidators.push("wallet participation not diversified");

  const conditionsMet = [bridgeSpike, destinationBuy, liquidityUp, diversified].filter(Boolean).length;
  const rawScore = (conditionsMet / 4) * 100;
  const confidence = conditionsMet >= 4 ? "HIGH" : conditionsMet >= 3 ? "MEDIUM" : "LOW";

  if (conditionsMet < 3) return null;

  const now = new Date();
  const windowStart = new Date(params.windowEnd.getTime() - 1 * 60 * 60 * 1000);

  return {
    id: `sig_rotation_${params.tokenAddress}_${Date.now()}`,
    type: "CAPITAL_ROTATION",
    entityType: "TOKEN",
    entityId: params.tokenAddress,
    rawScore,
    riskScore: 0,
    adjustedScore: rawScore,
    confidence,
    dataCompleteness: params.dataCompleteness,
    evidence,
    riskFlags: [],
    invalidators,
    window: "1h",
    windowStart,
    windowEnd: params.windowEnd,
    createdAt: now,
    status: "ACTIVE",
  };
}

export function generateStockTokenDivergenceSignal(params: {
  tokenAddress: string;
  isCanonical: boolean;
  referencePriceFresh: boolean;
  tradingHalt: boolean;
  premiumDiscount: number; // absolute value
  executableDepthUsd: number;
  dataCompleteness: number;
  windowEnd: Date;
}): Signal | null {
  const config = SIGNAL_CONFIG.stockTokenDivergence;
  const evidence: SignalEvidence[] = [];
  const invalidators: string[] = [];

  const canonical = params.isCanonical;
  const fresh = params.referencePriceFresh;
  const notHalted = !params.tradingHalt;
  const divergenceThreshold = Math.abs(params.premiumDiscount) > config.minAbsPremiumDiscount;
  const hasDepth = params.executableDepthUsd >= config.minExecutableDepthUsd;

  if (canonical) evidence.push({ metric: "canonical", value: 1 });
  if (fresh) evidence.push({ metric: "reference_price_fresh", value: 1 });
  if (!notHalted) evidence.push({ metric: "trading_halt", value: 1 });
  if (divergenceThreshold) evidence.push({ metric: "premium_discount", value: params.premiumDiscount, threshold: config.minAbsPremiumDiscount });
  if (hasDepth) evidence.push({ metric: "executable_depth_usd", value: params.executableDepthUsd, threshold: config.minExecutableDepthUsd });

  if (!canonical) invalidators.push("not canonical stock token");
  if (!fresh) invalidators.push("reference price stale");
  if (!notHalted) invalidators.push("trading halted");
  if (!divergenceThreshold) invalidators.push("premium/discount below threshold");
  if (!hasDepth) invalidators.push("insufficient executable depth");

  const conditionsMet = [canonical, fresh, notHalted, divergenceThreshold, hasDepth].filter(Boolean).length;
  const rawScore = (conditionsMet / 5) * 100;
  const confidence = conditionsMet >= 5 ? "HIGH" : conditionsMet >= 4 ? "MEDIUM" : "LOW";

  // Master prompt defines STOCK_TOKEN_DIVERGENCE with AND semantics — every
  // condition is required. A signal missing any one of them is not actionable.
  if (conditionsMet < 5) return null;

  const now = new Date();
  const windowStart = new Date(params.windowEnd.getTime() - 60 * 60 * 1000);

  return {
    id: `sig_divergence_${params.tokenAddress}_${Date.now()}`,
    type: "STOCK_TOKEN_DIVERGENCE",
    entityType: "TOKEN",
    entityId: params.tokenAddress,
    rawScore,
    riskScore: 0,
    adjustedScore: rawScore,
    confidence,
    dataCompleteness: params.dataCompleteness,
    evidence,
    riskFlags: [],
    invalidators,
    window: "1h",
    windowStart,
    windowEnd: params.windowEnd,
    createdAt: now,
    status: "ACTIVE",
  };
}

export function generateFakeMomentumWarning(params: {
  tokenAddress: string;
  transfersPerHolder: number;
  sybilRatio: number;
  holderGrowthWithoutActive: boolean;
  priceLiquidityDivergence: number;
  creatorWalletDominance: boolean;
  dataCompleteness: number;
  windowEnd: Date;
}): Signal | null {
  const config = SIGNAL_CONFIG.fakeMomentumWarning;
  const evidence: SignalEvidence[] = [];
  const riskFlags: string[] = [];

  const extremeTransfers = params.transfersPerHolder > config.maxTransfersPerHolder;
  const highSybil = params.sybilRatio > config.minSybilRatio;
  const holderAnomaly = params.holderGrowthWithoutActive;
  const priceLiqDivergence = params.priceLiquidityDivergence > config.minPriceLiquidityDivergence;
  const creatorDominance = params.creatorWalletDominance;

  if (extremeTransfers) {
    evidence.push({ metric: "transfers_per_holder", value: params.transfersPerHolder, threshold: config.maxTransfersPerHolder });
    riskFlags.push("EXTREME_TRANSFER_RATIO");
  }
  if (highSybil) {
    evidence.push({ metric: "sybil_ratio", value: params.sybilRatio, threshold: config.minSybilRatio });
    riskFlags.push("HIGH_SYBIL_RATIO");
  }
  if (holderAnomaly) {
    evidence.push({ metric: "holder_growth_without_active", value: 1 });
    riskFlags.push("HOLDER_ANOMALY");
  }
  if (priceLiqDivergence) {
    evidence.push({ metric: "price_liquidity_divergence", value: params.priceLiquidityDivergence, threshold: config.minPriceLiquidityDivergence });
    riskFlags.push("PRICE_LIQUIDITY_DIVERGENCE");
  }
  if (creatorDominance) {
    evidence.push({ metric: "creator_wallet_dominance", value: 1 });
    riskFlags.push("CREATOR_DOMINANCE");
  }

  const issuesFound = [extremeTransfers, highSybil, holderAnomaly, priceLiqDivergence, creatorDominance].filter(Boolean).length;
  const rawScore = (issuesFound / 5) * 100;
  const confidence = issuesFound >= 3 ? "HIGH" : issuesFound >= 2 ? "MEDIUM" : "LOW";

  if (issuesFound < 2) return null;

  const now = new Date();
  const windowStart = new Date(params.windowEnd.getTime() - 24 * 60 * 60 * 1000);

  return {
    id: `sig_fake_${params.tokenAddress}_${Date.now()}`,
    type: "FAKE_MOMENTUM_WARNING",
    entityType: "TOKEN",
    entityId: params.tokenAddress,
    rawScore,
    riskScore: 0,
    adjustedScore: rawScore,
    confidence,
    dataCompleteness: params.dataCompleteness,
    evidence,
    riskFlags,
    invalidators: [],
    window: "24h",
    windowStart,
    windowEnd: params.windowEnd,
    createdAt: now,
    status: "ACTIVE",
  };
}
