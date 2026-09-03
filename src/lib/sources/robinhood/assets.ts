import { z } from "zod";
import { getAPIs, getChain } from "@/lib/config";

// ── Raw API Schema ──────────────────────────────────────────────────────────

const rawAssetSchema = z.object({
  id: z.string(),
  tokenSymbol: z.string(),
  tokenName: z.string().nullable().optional(),
  contractAddress: z.string(),
  chainId: z.number(),
  currentMultiplier: z.string().optional(),
  pendingMultiplier: z.string().nullable().optional(),
  status: z.string().optional(),
  tradingCapabilities: z.any().optional(),
  tokenDecimals: z.number().optional(),
  isin: z.string().nullable().optional(),
});

export type RawRobinhoodAsset = z.infer<typeof rawAssetSchema>;

// ── Normalized Domain Model ─────────────────────────────────────────────────

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

// ── Adapter ─────────────────────────────────────────────────────────────────

export async function fetchCanonicalAssets(): Promise<CanonicalAsset[]> {
  const response = await fetch(getAPIs().robinhood.assetsUrl, {
    headers: { "Accept": "application/json" },
    next: { revalidate: 3600 }, // cache 1 hour
  });

  if (!response.ok) {
    throw new Error(`Robinhood assets API failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const assets = Array.isArray(data) ? data : data.results || data.assets || [];

  const normalized: CanonicalAsset[] = [];

  for (const raw of assets) {
    const parsed = rawAssetSchema.safeParse(raw);
    if (!parsed.success) continue;

    const item = parsed.data;

    // Only include assets on Robinhood Chain
    if (item.chainId !== getChain().id) continue;

    normalized.push({
      id: `rhj-${item.id}`,
      assetId: item.id,
      symbol: item.tokenSymbol.toUpperCase(),
      name: item.tokenName || null,
      contractAddress: item.contractAddress.toLowerCase(),
      chainId: item.chainId,
      currentMultiplier: item.currentMultiplier || null,
      pendingMultiplier: item.pendingMultiplier || null,
      status: item.status || null,
      tradingCapabilities: item.tradingCapabilities || null,
      isin: item.isin || null,
      sourceUpdatedAt: new Date(),
    });
  }

  return normalized;
}

// ── Canonical Resolver ──────────────────────────────────────────────────────

export type CanonicalStatus = "CANONICAL" | "NON_CANONICAL" | "TICKER_COLLISION" | "UNKNOWN";

export function resolveCanonicalAsset(
  chainId: number,
  contractAddress: string,
  canonicalAssets: CanonicalAsset[],
): { status: CanonicalStatus; asset: CanonicalAsset | null } {
  const normalizedAddress = contractAddress.toLowerCase();

  // Exact address match on correct chain
  const match = canonicalAssets.find(
    (a) => a.chainId === chainId && a.contractAddress.toLowerCase() === normalizedAddress,
  );

  if (match) {
    return { status: "CANONICAL", asset: match };
  }

  // Check if there's a symbol/name collision
  // (This is a simplified check - in production, we'd match by symbol)
  return { status: "NON_CANONICAL", asset: null };
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
