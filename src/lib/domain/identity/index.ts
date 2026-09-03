import { getChain } from "@/lib/config";

// ── Canonical Asset Domain Model ────────────────────────────────────────────

export type CanonicalAsset = {
  id: string;
  assetId: string;
  symbol: string;
  name: string | null;
  contractAddress: string;
  chainId: number;
  currentMultiplier: string | null;
  pendingMultiplier: string | null;
  status: string | null;
  tradingCapabilities: unknown;
  isin: string | null;
  sourceUpdatedAt: Date;
};

export type CanonicalStatus = "CANONICAL" | "NON_CANONICAL" | "TICKER_COLLISION" | "UNKNOWN";

// ── Address Normalization ───────────────────────────────────────────────────

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function isSameAddress(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

// ── Canonical Resolver (P-01: exact address match, never symbol/name) ──────

export function resolveCanonicalAsset(
  chainId: number,
  contractAddress: string,
  canonicalAssets: CanonicalAsset[],
): { status: CanonicalStatus; asset: CanonicalAsset | null } {
  const normalizedAddress = normalizeAddress(contractAddress);

  // Exact address match on correct chain — this is the ONLY canonical proof
  const match = canonicalAssets.find(
    (a) => a.chainId === chainId && normalizeAddress(a.contractAddress) === normalizedAddress,
  );

  if (match) {
    return { status: "CANONICAL", asset: match };
  }

  // Not in registry → NON_CANONICAL. TICKER_COLLISION is set separately by the
  // sync job when detectTickerCollisions finds shared symbols with a canonical asset.
  return { status: "NON_CANONICAL", asset: null };
}

export function isCanonicalStockToken(
  contractAddress: string,
  canonicalAssets: CanonicalAsset[],
): boolean {
  return resolveCanonicalAsset(getChain().id, contractAddress, canonicalAssets).status === "CANONICAL";
}

// ── Ticker Collision Detection ──────────────────────────────────────────────

export function detectTickerCollisions(
  canonicalAssets: CanonicalAsset[],
): Array<{ symbol: string; canonicalAddress: string; collisionAddresses: string[] }> {
  const bySymbol = new Map<string, CanonicalAsset[]>();

  for (const asset of canonicalAssets) {
    const existing = bySymbol.get(asset.symbol) || [];
    existing.push(asset);
    bySymbol.set(asset.symbol, existing);
  }

  const collisions: Array<{ symbol: string; canonicalAddress: string; collisionAddresses: string[] }> = [];

  for (const [symbol, assets] of bySymbol) {
    if (assets.length > 1) {
      collisions.push({
        symbol,
        canonicalAddress: assets[0].contractAddress,
        collisionAddresses: assets.slice(1).map((a) => a.contractAddress),
      });
    }
  }

  return collisions;
}
