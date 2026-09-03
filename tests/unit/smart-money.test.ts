import { describe, it, expect } from "vitest";
import { calculateSmartMoneyScore, classifyWallet } from "@/lib/domain/smart-money";

const goodWallet = {
  tradeCount: 150,
  realizedPnlUsd: 500_000,
  winRate: 0.65,
  entryLeadScore: 0.7,
  consistency: 0.6,
  liquidityAdjustedReturn: 0.5,
  crossAssetBreadth: 0.4,
  sybilScore: 0.05,
  botScore: 0.05,
  labels: [],
};

describe("calculateSmartMoneyScore", () => {
  it("scores a strong wallet highly", () => {
    const result = calculateSmartMoneyScore(goodWallet);
    expect(result.minTradeHistoryMet).toBe(true);
    expect(result.smartMoneyScore).toBeGreaterThan(50);
  });

  it("excludes wallets with insufficient trade history", () => {
    const result = calculateSmartMoneyScore({ ...goodWallet, tradeCount: 5 });
    expect(result.minTradeHistoryMet).toBe(false);
    expect(result.excludedReason).toBe("INSUFFICIENT_TRADE_HISTORY");
    expect(result.smartMoneyScore).toBe(0);
  });

  it("excludes LP / router / bot wallets", () => {
    for (const label of ["LP", "MARKET_MAKER", "DEPLOYER", "BOT", "MEV", "PROTOCOL", "BUNDLER", "PAYMASTER"]) {
      const result = calculateSmartMoneyScore({ ...goodWallet, labels: [label as never] });
      expect(result.excludedReason).toContain("EXCLUDED_LABEL");
      expect(result.smartMoneyScore).toBe(0);
    }
  });

  it("penalizes high bot/sybil scores", () => {
    const clean = calculateSmartMoneyScore(goodWallet);
    const botty = calculateSmartMoneyScore({ ...goodWallet, botScore: 0.9, sybilScore: 0.9 });
    expect(botty.smartMoneyScore).toBeLessThan(clean.smartMoneyScore);
  });

  it("clamps score to 0-100", () => {
    const perfect = calculateSmartMoneyScore({
      ...goodWallet,
      realizedPnlUsd: 10_000_000,
      winRate: 1, entryLeadScore: 1, consistency: 1, liquidityAdjustedReturn: 1, crossAssetBreadth: 1,
      sybilScore: 0, botScore: 0,
    });
    expect(perfect.smartMoneyScore).toBeLessThanOrEqual(100);

    const terrible = calculateSmartMoneyScore({
      ...goodWallet,
      realizedPnlUsd: -10_000_000,
      winRate: 0, entryLeadScore: 0, consistency: 0, liquidityAdjustedReturn: 0, crossAssetBreadth: 0,
      sybilScore: 1, botScore: 1,
    });
    expect(terrible.smartMoneyScore).toBeGreaterThanOrEqual(0);
  });
});

describe("classifyWallet", () => {
  it("labels whales by trade size", () => {
    const labels = classifyWallet({ tradeCount: 100, avgTradeUsd: 500_000, realizedPnlUsd: 1000, score: 30 });
    expect(labels).toContain("WHALE");
  });

  it("labels smart money at high score", () => {
    const labels = classifyWallet({ tradeCount: 100, avgTradeUsd: 1000, realizedPnlUsd: 1000, score: 85 });
    expect(labels).toContain("SMART_MONEY");
  });

  it("returns MEME_TRADER for low activity", () => {
    const labels = classifyWallet({ tradeCount: 2, avgTradeUsd: 10, realizedPnlUsd: 0, score: 0 });
    expect(labels).toEqual(["MEME_TRADER"]);
  });
});
