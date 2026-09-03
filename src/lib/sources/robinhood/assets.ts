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

// ── Raw API Schema (verified against live /rhj/assets response) ─────────────
// Top-level: { assets: [...] }
// Each asset has deployments: [{ contractAddress, chainId, networkName }]

const rawAssetSchema = z.object({
  id: z.string(),
  tokenSymbol: z.string(),
  tokenName: z.string().nullable().optional(),
  deployments: z
    .array(
      z.object({
        contractAddress: z.string(),
        chainId: z.number(),
        networkName: z.string().optional(),
      }),
    )
    .optional(),
  currentMultiplier: z.string().optional(),
  pendingMultiplier: z.string().nullable().optional(),
  status: z.string().optional(),
  tradingCapabilities: z.any().optional(),
  tokenDecimals: z.number().optional(),
  isin: z.string().nullable().optional(),
});

export type RawRobinhoodAsset = z.infer<typeof rawAssetSchema>;

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
  const assets = Array.isArray(data) ? data : data.assets || [];

  const normalized: CanonicalAsset[] = [];

  for (const raw of assets) {
    const parsed = rawAssetSchema.safeParse(raw);
    if (!parsed.success) continue;

    const item = parsed.data;

    // Contract lives in deployments[] — find the Robinhood Chain deployment
    const deployment = (item.deployments || []).find(
      (d) => d.chainId === getChain().id && d.contractAddress,
    );
    if (!deployment) continue; // not deployed on Robinhood Chain

    normalized.push({
      id: `rhj-${item.id}`,
      assetId: item.id,
      symbol: item.tokenSymbol.toUpperCase(),
      name: item.tokenName || null,
      contractAddress: deployment.contractAddress.toLowerCase(),
      chainId: deployment.chainId,
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
