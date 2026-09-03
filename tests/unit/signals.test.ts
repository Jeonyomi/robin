import { describe, it, expect } from "vitest";
import {
  generateSmartAccumulationSignal,
  generateCapitalRotationSignal,
  generateStockTokenDivergenceSignal,
  generateFakeMomentumWarning,
} from "@/lib/domain/signals";
import { CANONICAL_GME_ADDRESS } from "../fixtures/tokens";

const windowEnd = new Date("2026-09-03T12:00:00Z");

describe("SMART_ACCUMULATION", () => {
  it("generates HIGH-confidence signal when all 5 conditions met", () => {
    const signal = generateSmartAccumulationSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      smartMoneyFlow6h: 100000,
      holderGrowth24h: 500,
      uniqueBuyerGrowth6h: 100,
      liquidityChange6h: 20000,
      top10ConcentrationChange: 0.01,
      dataCompleteness: 0.95,
      windowEnd,
    });
    expect(signal).not.toBeNull();
    expect(signal!.rawScore).toBe(100);
    expect(signal!.confidence).toBe("HIGH");
    expect(signal!.evidence).toHaveLength(5);
    expect(signal!.invalidators).toHaveLength(0);
  });

  it("returns null when fewer than 3 conditions met", () => {
    const signal = generateSmartAccumulationSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      smartMoneyFlow6h: -5000,
      holderGrowth24h: -100,
      uniqueBuyerGrowth6h: -20,
      liquidityChange6h: -5000,
      top10ConcentrationChange: 0.2,
      dataCompleteness: 0.8,
      windowEnd,
    });
    expect(signal).toBeNull();
  });

  it("includes invalidators for unmet conditions", () => {
    const signal = generateSmartAccumulationSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      smartMoneyFlow6h: 100000,
      holderGrowth24h: 500,
      uniqueBuyerGrowth6h: 100,
      liquidityChange6h: -5000,
      top10ConcentrationChange: 0.2,
      dataCompleteness: 0.9,
      windowEnd,
    });
    expect(signal).not.toBeNull();
    expect(signal!.invalidators.some((i) => i.includes("liquidity"))).toBe(true);
    expect(signal!.invalidators.some((i) => i.includes("concentration"))).toBe(true);
  });
});

describe("CAPITAL_ROTATION", () => {
  it("generates HIGH-confidence signal when all 4 conditions met", () => {
    const signal = generateCapitalRotationSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      bridgeInflow1h: 500000,
      destinationBuy1h: 200000,
      liquidityChange1h: 50000,
      walletDiversification: 0.8,
      dataCompleteness: 0.9,
      windowEnd,
    });
    expect(signal).not.toBeNull();
    expect(signal!.rawScore).toBe(100);
    expect(signal!.confidence).toBe("HIGH");
  });

  it("returns null when fewer than 3 conditions met", () => {
    const signal = generateCapitalRotationSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      bridgeInflow1h: 0,
      destinationBuy1h: -1000,
      liquidityChange1h: -1000,
      walletDiversification: 0.2,
      dataCompleteness: 0.8,
      windowEnd,
    });
    expect(signal).toBeNull();
  });
});

describe("STOCK_TOKEN_DIVERGENCE", () => {
  it("generates signal for canonical token with divergence and depth", () => {
    const signal = generateStockTokenDivergenceSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      isCanonical: true,
      referencePriceFresh: true,
      tradingHalt: false,
      premiumDiscount: 0.05,
      executableDepthUsd: 50000,
      dataCompleteness: 0.95,
      windowEnd,
    });
    expect(signal).not.toBeNull();
    expect(signal!.confidence).toBe("HIGH");
  });

  it("does not generate signal for non-canonical lookalike", () => {
    const signal = generateStockTokenDivergenceSignal({
      tokenAddress: "0xc2362AfF2A2a4CC1f48cF3Dab2C4e2605eb94BA3", // lookalike
      isCanonical: false,
      referencePriceFresh: true,
      tradingHalt: false,
      premiumDiscount: 0.05,
      executableDepthUsd: 50000,
      dataCompleteness: 0.95,
      windowEnd,
    });
    expect(signal).toBeNull();
  });

  it("does not generate when divergence below threshold", () => {
    const signal = generateStockTokenDivergenceSignal({
      tokenAddress: CANONICAL_GME_ADDRESS,
      isCanonical: true,
      referencePriceFresh: true,
      tradingHalt: false,
      premiumDiscount: 0.001,
      executableDepthUsd: 50000,
      dataCompleteness: 0.95,
      windowEnd,
    });
    expect(signal).toBeNull();
  });
});

describe("FAKE_MOMENTUM_WARNING", () => {
  it("generates warning when multiple anomalies present", () => {
    const signal = generateFakeMomentumWarning({
      tokenAddress: "0xabc",
      transfersPerHolder: 200,
      sybilRatio: 0.5,
      holderGrowthWithoutActive: true,
      priceLiquidityDivergence: 0.5,
      creatorWalletDominance: true,
      dataCompleteness: 0.8,
      windowEnd,
    });
    expect(signal).not.toBeNull();
    expect(signal!.riskFlags.length).toBeGreaterThanOrEqual(3);
  });

  it("returns null when fewer than 2 anomalies", () => {
    const signal = generateFakeMomentumWarning({
      tokenAddress: "0xabc",
      transfersPerHolder: 20,
      sybilRatio: 0.05,
      holderGrowthWithoutActive: false,
      priceLiquidityDivergence: 0.01,
      creatorWalletDominance: false,
      dataCompleteness: 0.8,
      windowEnd,
    });
    expect(signal).toBeNull();
  });
});
