import { z } from "zod";
import { getAPIs, getChain } from "@/lib/config";
import type { CanonicalAsset } from "@/lib/domain/identity";
export type { CanonicalAsset, CanonicalStatus } from "@/lib/domain/identity";
export {
  resolveCanonicalAsset,
  detectTickerCollisions,
  normalizeAddress,
  isSameAddress,
} from "@/lib/domain/identity";

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
