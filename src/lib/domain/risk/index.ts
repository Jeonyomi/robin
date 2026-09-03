import { RISK_WEIGHTS, RISK_GATES } from "@/lib/config";

// ── Types ───────────────────────────────────────────────────────────────────

export type RiskFlag =
  | "TICKER_COLLISION"
  | "NO_EXECUTABLE_LIQUIDITY"
  | "EXTREME_CONCENTRATION"
  | "ACTIVITY_ANOMALY"
  | "CONTRACT_PRIVILEGE"
  | "POTENTIAL_CONTRACT_PRIVILEGE"
  | "LOW_DATA_QUALITY"
  | "SHALLOW_LIQUIDITY";

export type RiskComponent = {
  contractRisk: number;     // 0-25
  liquidityRisk: number;    // 0-20
  holderConcentration: number; // 0-20
  marketManipulation: number; // 0-15
  identityRisk: number;     // 0-10
  dataQualityRisk: number;  // 0-10
};

export type RiskAssessment = {
  totalScore: number;       // 0-100
  components: RiskComponent;
  riskFlags: RiskFlag[];
  restricted: boolean;      // Hard gate triggered
  hardGatesTriggered: string[];
};

// ── Risk Calculation ────────────────────────────────────────────────────────

export function calculateRiskScore(params: {
  isVerified: boolean | null;
  isProxy: boolean | null;
  isCanonical: boolean;
  hasTickerCollision: boolean;
  holdersCount: number | null;
  transfersCount: number | null;
  liquidityUsd: number | null;
  depth1pctUsd: number | null;
  top10Share: number | null;
  sybilRatio: number | null;
  contractHasMint: boolean;
  contractHasBlacklist: boolean;
  contractHasPause: boolean;
  ageHours: number;
}): RiskAssessment {
  const components: RiskComponent = {
    contractRisk: 0,
    liquidityRisk: 0,
    holderConcentration: 0,
    marketManipulation: 0,
    identityRisk: 0,
    dataQualityRisk: 0,
  };

  const riskFlags: RiskFlag[] = [];
  const hardGatesTriggered: string[] = [];

  // ── Contract Risk (0-25) ──────────────────────────────────────────────────

  if (params.isVerified === false) {
    components.contractRisk += 10;
  }
  if (params.isProxy) {
    components.contractRisk += 5;
    riskFlags.push("POTENTIAL_CONTRACT_PRIVILEGE");
  }
  if (params.contractHasMint) {
    components.contractRisk += 5;
  }
  if (params.contractHasBlacklist || params.contractHasPause) {
    components.contractRisk += 5;
  }

  // ── Liquidity Risk (0-20) ─────────────────────────────────────────────────

  if (params.liquidityUsd === null || params.liquidityUsd < RISK_GATES.noExecutableLiquidity.minDepthUsd) {
    components.liquidityRisk = 20;
    riskFlags.push("NO_EXECUTABLE_LIQUIDITY");
    hardGatesTriggered.push("GATE-02");
  } else if (params.liquidityUsd < 50000) {
    components.liquidityRisk = 15;
    riskFlags.push("SHALLOW_LIQUIDITY");
  } else if (params.liquidityUsd < 200000) {
    components.liquidityRisk = 10;
  } else if (params.liquidityUsd < 1000000) {
    components.liquidityRisk = 5;
  }

  // ── Holder Concentration (0-20) ───────────────────────────────────────────

  if (params.top10Share !== null && params.top10Share > RISK_GATES.extremeConcentration.maxTop10Share) {
    components.holderConcentration = 20;
    riskFlags.push("EXTREME_CONCENTRATION");
    hardGatesTriggered.push("GATE-03");
  } else if (params.top10Share !== null && params.top10Share > 0.4) {
    components.holderConcentration = 15;
  } else if (params.top10Share !== null && params.top10Share > 0.3) {
    components.holderConcentration = 10;
  } else if (params.top10Share !== null && params.top10Share > 0.2) {
    components.holderConcentration = 5;
  }

  // ── Market Manipulation (0-15) ────────────────────────────────────────────

  if (params.sybilRatio !== null && params.sybilRatio > RISK_GATES.activityAnomaly.maxTransfersPerHolder / 1000) {
    components.marketManipulation = 15;
    riskFlags.push("ACTIVITY_ANOMALY");
    hardGatesTriggered.push("GATE-04");
  } else if (params.sybilRatio !== null && params.sybilRatio > 0.2) {
    components.marketManipulation = 10;
  } else if (params.sybilRatio !== null && params.sybilRatio > 0.1) {
    components.marketManipulation = 5;
  }

  // ── Identity Risk (0-10) ──────────────────────────────────────────────────

  if (!params.isCanonical) {
    components.identityRisk = 10;
    riskFlags.push("TICKER_COLLISION");
    hardGatesTriggered.push("GATE-01");
  }

  // ── Data Quality Risk (0-10) ──────────────────────────────────────────────

  if (params.holdersCount === null || params.transfersCount === null) {
    components.dataQualityRisk += 5;
  }
  if (params.liquidityUsd === null) {
    components.dataQualityRisk += 3;
  }
  if (components.dataQualityRisk > 0) {
    riskFlags.push("LOW_DATA_QUALITY");
  }

  // ── Total Score ───────────────────────────────────────────────────────────

  const totalScore = Math.min(100,
    components.contractRisk +
    components.liquidityRisk +
    components.holderConcentration +
    components.marketManipulation +
    components.identityRisk +
    components.dataQualityRisk
  );

  const restricted = hardGatesTriggered.length > 0;

  return {
    totalScore,
    components,
    riskFlags,
    restricted,
    hardGatesTriggered,
  };
}

// ── Confidence Calculation ──────────────────────────────────────────────────

export function calculateConfidence(params: {
  dataCompleteness: number; // 0-1
  hasCanonicalData: boolean;
  hasLiquidityData: boolean;
  hasHolderData: boolean;
  ageHours: number;
}): "HIGH" | "MEDIUM" | "LOW" {
  if (params.dataCompleteness < 0.5) return "LOW";
  if (!params.hasCanonicalData && !params.hasLiquidityData) return "LOW";
  if (params.dataCompleteness < 0.7) return "MEDIUM";
  if (params.ageHours < 24) return "MEDIUM";
  if (params.dataCompleteness >= 0.9 && params.hasCanonicalData && params.hasLiquidityData && params.hasHolderData) {
    return "HIGH";
  }
  return "MEDIUM";
}
