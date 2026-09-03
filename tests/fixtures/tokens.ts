// ── Test fixtures — canonical vs lookalike token addresses ────────────────

// Official canonical GME Stock Token (from Robinhood /rhj/assets registry)
export const CANONICAL_GME_ADDRESS = "0x1b0E319c6A659F002271B69dB8A7df2F911c153E";

// Non-canonical GME lookalike (exists on-chain, NOT in registry)
export const LOOKALIKE_GME_ADDRESS = "0xc2362AfF2A2a4CC1f48cF3Dab2C4e2605eb94BA3";

// Canonical GME fixture as returned by the normalized Robinhood adapter
export const canonicalGmeAsset = {
  id: "rhj-XXXX",
  assetId: "XXXX",
  symbol: "GME",
  name: "GameStop Stock Token",
  contractAddress: CANONICAL_GME_ADDRESS.toLowerCase(),
  chainId: 4663,
  currentMultiplier: "1.000000000000000000",
  pendingMultiplier: null,
  status: "ACTIVE",
  tradingCapabilities: { tradable: true },
  isin: "US36467W1099",
  sourceUpdatedAt: new Date("2026-09-03T00:00:00Z"),
};

export const canonicalAssetsFixture = [canonicalGmeAsset];

// ── Risk engine fixtures ────────────────────────────────────────────────────

export const healthyTokenRiskParams = {
  isVerified: true,
  isProxy: false,
  isCanonical: true,
  hasTickerCollision: false,
  holdersCount: 5000,
  transfersCount: 12000,
  liquidityUsd: 5_000_000,
  depth1pctUsd: 250_000,
  top10Share: 0.18,
  sybilRatio: 0.05,
  contractHasMint: false,
  contractHasBlacklist: false,
  contractHasPause: false,
  ageHours: 720,
};

export const riskyTokenRiskParams = {
  ...healthyTokenRiskParams,
  isVerified: false,
  isCanonical: false,
  hasTickerCollision: true,
  liquidityUsd: 1000,
  depth1pctUsd: 100,
  top10Share: 0.65,
  sybilRatio: 0.4,
  contractHasMint: true,
  contractHasBlacklist: true,
  contractHasPause: true,
  ageHours: 2,
};
