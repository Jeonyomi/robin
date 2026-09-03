import { describe, it, expect } from "vitest";
import { calculateRiskScore, calculateConfidence } from "@/lib/domain/risk";
import { healthyTokenRiskParams, riskyTokenRiskParams } from "../fixtures/tokens";

describe("calculateRiskScore — healthy canonical token", () => {
  const result = calculateRiskScore(healthyTokenRiskParams);

  it("has low total score", () => {
    expect(result.totalScore).toBeLessThan(15);
  });

  it("is not restricted", () => {
    expect(result.restricted).toBe(false);
    expect(result.hardGatesTriggered).toHaveLength(0);
  });

  it("has no risk flags", () => {
    expect(result.riskFlags).toHaveLength(0);
  });

  it("identity risk is zero for canonical token", () => {
    expect(result.components.identityRisk).toBe(0);
  });
});

describe("calculateRiskScore — risky non-canonical token", () => {
  const result = calculateRiskScore(riskyTokenRiskParams);

  it("has high total score", () => {
    expect(result.totalScore).toBeGreaterThan(60);
  });

  it("is restricted (hard gates triggered)", () => {
    expect(result.restricted).toBe(true);
    expect(result.hardGatesTriggered.length).toBeGreaterThan(0);
  });

  it("triggers GATE-01 (ticker collision / non-canonical)", () => {
    expect(result.hardGatesTriggered).toContain("GATE-01");
    expect(result.riskFlags).toContain("TICKER_COLLISION");
  });

  it("triggers GATE-02 (no executable liquidity)", () => {
    expect(result.hardGatesTriggered).toContain("GATE-02");
  });

  it("triggers GATE-03 (extreme concentration)", () => {
    expect(result.hardGatesTriggered).toContain("GATE-03");
  });

  it("adds contract risk for mint/blacklist/pause", () => {
    expect(result.components.contractRisk).toBeGreaterThan(0);
  });
});

describe("risk components are isolated", () => {
  it("liquidity risk scales with liquidity", () => {
    const low = calculateRiskScore({ ...healthyTokenRiskParams, liquidityUsd: 30000 });
    const mid = calculateRiskScore({ ...healthyTokenRiskParams, liquidityUsd: 150000 });
    const high = calculateRiskScore({ ...healthyTokenRiskParams, liquidityUsd: 5_000_000 });
    expect(low.components.liquidityRisk).toBeGreaterThan(mid.components.liquidityRisk);
    expect(mid.components.liquidityRisk).toBeGreaterThan(high.components.liquidityRisk);
  });

  it("holder concentration risk increases with top10Share", () => {
    const low = calculateRiskScore({ ...healthyTokenRiskParams, top10Share: 0.25 });
    const high = calculateRiskScore({ ...healthyTokenRiskParams, top10Share: 0.45 });
    expect(high.components.holderConcentration).toBeGreaterThan(low.components.holderConcentration);
  });

  it("total score is capped at 100", () => {
    const result = calculateRiskScore(riskyTokenRiskParams);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });
});

describe("calculateConfidence", () => {
  it("returns LOW below 0.5 completeness", () => {
    expect(calculateConfidence({ dataCompleteness: 0.4, hasCanonicalData: true, hasLiquidityData: true, hasHolderData: true, ageHours: 100 })).toBe("LOW");
  });

  it("returns HIGH with complete data", () => {
    expect(calculateConfidence({ dataCompleteness: 0.95, hasCanonicalData: true, hasLiquidityData: true, hasHolderData: true, ageHours: 100 })).toBe("HIGH");
  });

  it("returns MEDIUM for young tokens even with good data", () => {
    expect(calculateConfidence({ dataCompleteness: 0.95, hasCanonicalData: true, hasLiquidityData: true, hasHolderData: true, ageHours: 5 })).toBe("MEDIUM");
  });

  it("returns LOW when canonical data missing and completeness < 0.7", () => {
    expect(calculateConfidence({ dataCompleteness: 0.6, hasCanonicalData: false, hasLiquidityData: false, hasHolderData: true, ageHours: 100 })).toBe("LOW");
  });
});
