// ── Smart Money Engine (P0) ─────────────────────────────────────────────────
// Wallet scoring per master prompt §14:
//   25% realized PnL quality
//   20% win rate
//   20% entry lead time
//   15% consistency
//   10% liquidity-adjusted return
//   10% cross-asset breadth
//   − bot/sybil penalty

export type WalletLabel =
  | "SMART_MONEY"
  | "WHALE"
  | "LP"
  | "MARKET_MAKER"
  | "BRIDGE_USER"
  | "STOCK_TOKEN_HOLDER"
  | "MEME_TRADER"
  | "DEPLOYER"
  | "BUNDLER"
  | "PAYMASTER"
  | "BOT"
  | "MEV"
  | "PROTOCOL";

export type WalletScoreInput = {
  tradeCount: number;
  realizedPnlUsd: number;
  winRate: number;              // 0-1
  entryLeadScore: number;       // 0-1 (how early vs price move)
  consistency: number;          // 0-1 (stable behavior across tokens)
  liquidityAdjustedReturn: number; // 0-1
  crossAssetBreadth: number;    // 0-1 (diversity of traded assets)
  sybilScore: number;           // 0-1
  botScore: number;             // 0-1
  labels: WalletLabel[];
};

export type WalletScoreResult = {
  smartMoneyScore: number;      // 0-100
  minTradeHistoryMet: boolean;
  excludedReason: string | null;
};

const MIN_TRADE_HISTORY = 20;
const MIN_TRADE_COUNT_FOR_LABEL = 5;

// Excluded wallet roles — never classified as smart money
const EXCLUDED_LABELS: WalletLabel[] = [
  "LP",
  "MARKET_MAKER",
  "DEPLOYER",
  "BUNDLER",
  "PAYMASTER",
  "BOT",
  "MEV",
  "PROTOCOL",
];

export function calculateSmartMoneyScore(input: WalletScoreInput): WalletScoreResult {
  // ── Exclusions ────────────────────────────────────────────────────────────
  if (input.labels.some((l) => EXCLUDED_LABELS.includes(l))) {
    return { smartMoneyScore: 0, minTradeHistoryMet: false, excludedReason: `EXCLUDED_LABEL:${input.labels.filter((l) => EXCLUDED_LABELS.includes(l)).join(",")}` };
  }

  if (input.tradeCount < MIN_TRADE_HISTORY) {
    return { smartMoneyScore: 0, minTradeHistoryMet: false, excludedReason: "INSUFFICIENT_TRADE_HISTORY" };
  }

  // ── Weighted components (each normalized 0-1, then scaled to 100) ────────
  const pnlQuality = clamp01(input.realizedPnlUsd / 1_000_000);           // $1M+ = 1.0
  const winRate = clamp01(input.winRate);
  const lead = clamp01(input.entryLeadScore);
  const consistency = clamp01(input.consistency);
  const liqAdjusted = clamp01(input.liquidityAdjustedReturn);
  const breadth = clamp01(input.crossAssetBreadth);

  const raw = (
    pnlQuality * 0.25 +
    winRate * 0.20 +
    lead * 0.20 +
    consistency * 0.15 +
    liqAdjusted * 0.10 +
    breadth * 0.10
  );

  // Bot/sybil penalty: up to −30 points
  const penalty = (clamp01(input.botScore) * 0.15 + clamp01(input.sybilScore) * 0.15) * 100;
  const score = Math.max(0, Math.min(100, raw * 100 - penalty));

  return { smartMoneyScore: Math.round(score * 100) / 100, minTradeHistoryMet: true, excludedReason: null };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ── Label Classification ────────────────────────────────────────────────────

export function classifyWallet(input: {
  tradeCount: number;
  avgTradeUsd: number;
  realizedPnlUsd: number;
  score: number;
}): WalletLabel[] {
  const labels: WalletLabel[] = [];

  if (input.tradeCount < MIN_TRADE_COUNT_FOR_LABEL) return ["MEME_TRADER"];

  if (input.avgTradeUsd >= 100_000) labels.push("WHALE");
  if (input.score >= 70) labels.push("SMART_MONEY");
  if (input.realizedPnlUsd > 0) labels.push("STOCK_TOKEN_HOLDER");

  if (labels.length === 0) labels.push("MEME_TRADER");
  return labels;
}
