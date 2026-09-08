export interface PairToken { address: string; symbol: string; name: string }
export interface StockPair {
  id: string; protocol: "uniswap-v3" | "uniswap-v4" | "unsupported";
  dex: string; base: PairToken; quote: PairToken; stock: PairToken;
  stockSide: "base" | "quote"; classification: "candidate";
  liquidityUsd: number | null; baseReserve: number | null; quoteReserve: number | null;
  volume24hUsd: number | null; buys24h: number | null; sells24h: number | null;
  priceNative: string | null; sourceUrl: string; retrievedAt: string;
}
export interface PairDiscovery {
  pairs: StockPair[]; retrievedAt: string; registryRetrievedAt: string;
  stockSymbols: string[]; failedStocks: string[]; partial: boolean;
  coverage: string; source: string;
}
export interface PoolInspection {
  poolId: string; protocol: "uniswap-v3" | "uniswap-v4";
  chainId: number; blockNumber: string; blockHash: string; observedAt: string;
  token0: { address: string; decimals: number }; token1: { address: string; decimals: number };
  tick: number; sqrtPriceX96: string; priceToken1PerToken0: number;
  liquidityRaw: string; feeTier: number; hooks: string | null;
  manager: string; stateView: string | null; factory: string | null;
  warnings: string[];
}
export interface PairPosition {
  tokenId: string; poolId: string; protocol: "uniswap-v3" | "uniswap-v4";
  manager: string; owner: string; blockNumber: string; observedAt: string;
  tickLower: number; tickUpper: number; tick: number; liquidityRaw: string;
  lowerToken1PerToken0: number; upperToken1PerToken0: number;
  priceToken1PerToken0: number; rangeState: "in-range" | "below-range" | "above-range" | "closed";
  amount0: number | null; amount1: number | null;
}
export interface PairPositions {
  positions: PairPosition[]; inspected: number; failed: number;
  coverage: string; observedAt: string; poolId: string;
}
