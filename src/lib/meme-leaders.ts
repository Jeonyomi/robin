export interface MemeLeader {
  address: string; symbol: string; name: string;
  rank: number; providerPoolRank: number;
  classification: "source-tagged" | "candidate";
  categories: string[]; metadataStatus: "available" | "unavailable" | "not-requested";
  imageUrl: string | null;
  priceUsd: number | null; change1hPct: number | null; change24hPct: number | null;
  volume24hUsd: number | null; liquidityUsd: number | null;
  marketCapUsd: number | null; fdvUsd: number | null;
  buys24h: number | null; sells24h: number | null;
  poolId: string; poolName: string; dex: string; quoteSymbol: string;
  stockPaired: boolean; poolCreatedAt: string | null;
  sourceUrl: string; tokenSourceUrl: string;
  holders: number | null; holdersUpdatedAt: string | null;
}
export interface MemeLeadersData {
  tokens: MemeLeader[]; retrievedAt: string; registryRetrievedAt: string;
  source: string; ranking: string; coverage: string;
  poolsObserved: number; tokensObserved: number; metadataRequested: number;
  metadataFailed: number; partial: boolean;
}
