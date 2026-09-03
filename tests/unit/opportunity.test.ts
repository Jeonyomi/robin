import { describe, it, expect } from "vitest";
import {
  calculateOpportunityScore,
  calculateCapitalFlowFactor,
  calculateAdoptionMomentumFactor,
  calculateLiquidityQualityFactor,
  calculateSmartMoneyFactor,
  calculateRelativeValueFactor,
  calculateCatalystFactor,
} from "@/lib/domain/opportunity";

const fullFactors = {
  capitalFlow: 80,
  adoptionMomentum: 70,
  liquidityQuality: 60,
  smartMoney: 75,
  relativeValue: 50,
  catalyst: 40,
};

describe("calculateOpportunityScore", () => {
  it("computes weighted raw score with all factors", () => {
    const result = calculateOpportunityScore({
      factors: fullFactors,
      riskScore: 20,
      dataCompleteness: 0.95,
      restricted: false,
    });
    // 80*0.23 + 70*0.18 + 60*0.18 + 75*0.15 + 50*0.11 + 40*0.15 = 64.55
    expect(result.rawScore).toBeCloseTo(64.55, 1);
  });

  it("applies risk adjustment: adjusted = raw × (1 - risk/125)", () => {
    const result = calculateOpportunityScore({
      factors: fullFactors,
      riskScore: 25,
      dataCompleteness: 0.95,
      restricted: false,
    });
    const expected = result.rawScore * (1 - 25 / 125);
    expect(result.adjustedScore).toBeCloseTo(expected, 1);
  });

  it("marks RESTRICTED when hard gate triggered", () => {
    const result = calculateOpportunityScore({
      factors: fullFactors,
      riskScore: 90,
      dataCompleteness: 0.95,
      restricted: true,
    });
    expect(result.status).toBe("RESTRICTED");
  });

  it("marks INSUFFICIENT_DATA when completeness < 0.6", () => {
    const result = calculateOpportunityScore({
      factors: { capitalFlow: 50 },
      riskScore: 10,
      dataCompleteness: 0.4,
      restricted: false,
    });
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.confidence).toBe("LOW");
  });

  it("reweights missing factors instead of zeroing them", () => {
    const partial: typeof fullFactors = {
      capitalFlow: 80,
      adoptionMomentum: 70,
      liquidityQuality: 60,
      smartMoney: 75,
      relativeValue: 50,
      catalyst: 40,
    };
    const result = calculateOpportunityScore({
      factors: { ...partial, relativeValue: undefined as unknown as number, catalyst: undefined as unknown as number },
      riskScore: 20,
      dataCompleteness: 0.8,
      restricted: false,
    });
    // Weighted avg of available factors only: (80*0.23 + 70*0.18 + 60*0.18 + 75*0.15) / (0.23+0.18+0.18+0.15)
    const availableWeight = 0.23 + 0.18 + 0.18 + 0.15;
    const expected = (80 * 0.23 + 70 * 0.18 + 60 * 0.18 + 75 * 0.15) / availableWeight;
    expect(result.rawScore).toBeCloseTo(expected, 1);
    // Renormalized factors must still sum their weights properly
    expect(result.factorWeights.relativeValue).toBe(0);
    expect(result.factorWeights.capitalFlow).toBe(0.23);
  });

  it("does not produce negative adjusted score", () => {
    const result = calculateOpportunityScore({
      factors: { capitalFlow: 100 },
      riskScore: 100,
      dataCompleteness: 0.9,
      restricted: false,
    });
    expect(result.adjustedScore).toBeGreaterThanOrEqual(0);
  });
});

describe("factor calculators", () => {
  it("capital flow factor normalizes by liquidity", () => {
    const score = calculateCapitalFlowFactor({
      netBuyUsd1h: 50000,
      netBuyUsd24h: 200000,
      bridgeInflow: 100000,
      stablecoinInflow: 50000,
      whaleNetFlow: 100000,
      smartMoneyNetFlow: 100000,
      liquidityUsd: 1_000_000,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("adoption momentum factor prefers buyer-heavy flow", () => {
    const buyers = calculateAdoptionMomentumFactor({
      holderDelta: 50, activeHolderDelta: 30, uniqueBuyers: 100, uniqueSellers: 10, newWalletRatio: 0.3,
    });
    const sellers = calculateAdoptionMomentumFactor({
      holderDelta: -20, activeHolderDelta: -10, uniqueBuyers: 10, uniqueSellers: 100, newWalletRatio: 0.05,
    });
    expect(buyers).toBeGreaterThan(sellers);
  });

  it("liquidity quality factor rewards depth and volume", () => {
    const deep = calculateLiquidityQualityFactor({
      liquidityUsd: 1_000_000, depth1pctUsd: 200_000, volumeUsd: 500_000, netLpChange: 5000, poolCount: 3,
    });
    const shallow = calculateLiquidityQualityFactor({
      liquidityUsd: 1000, depth1pctUsd: 50, volumeUsd: 100, netLpChange: -500, poolCount: 1,
    });
    expect(deep).toBeGreaterThan(shallow);
  });

  it("smart money factor penalizes sybil/bot", () => {
    const clean = calculateSmartMoneyFactor({
      smartMoneyNetFlow: 100_000, profitableWalletAccumulation: 0.5, newWalletRatio: 0.3, sybilRatio: 0.05, botTradeRatio: 0.05,
    });
    const dirty = calculateSmartMoneyFactor({
      smartMoneyNetFlow: -10_000, profitableWalletAccumulation: 0.05, newWalletRatio: 0.9, sybilRatio: 0.8, botTradeRatio: 0.8,
    });
    expect(clean).toBeGreaterThan(dirty);
  });

  it("relative value factor rewards premium/discount", () => {
    const diverged = calculateRelativeValueFactor({ premiumDiscount: 0.05, dexPriceVsReference: 0.04, multiPoolDispersion: 0.01 });
    const aligned = calculateRelativeValueFactor({ premiumDiscount: 0.001, dexPriceVsReference: 0.001, multiPoolDispersion: 0.05 });
    expect(diverged).toBeGreaterThan(aligned);
  });

  it("catalyst factor sums event bonuses", () => {
    const all = calculateCatalystFactor({ hasNewPool: true, hasCorporateAction: true, hasNewListing: true, hasVolumeSpike: true });
    expect(all).toBe(100);
    const none = calculateCatalystFactor({ hasNewPool: false, hasCorporateAction: false, hasNewListing: false, hasVolumeSpike: false });
    expect(none).toBe(0);
  });
});
