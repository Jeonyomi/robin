import { z } from "zod";
import { fetchSourceJson } from "@/lib/sources/source-request";
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
  id: z.string().min(1),
  tokenSymbol: z.string().min(1),
  tokenName: z.string().nullable().optional(),
  deployments: z
    .array(
      z.object({
        contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        chainId: z.number().int().positive(),
        networkName: z.string().optional(),
      }),
    ),
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
  const data = await fetchSourceJson("robinhood", getAPIs().robinhood.assetsUrl, {
    headers: { Accept: "application/json" }, scope: "assets",
  });
  const envelope = z.union([
    z.array(rawAssetSchema).min(1),
    z.object({ assets: z.array(rawAssetSchema).min(1) }).transform((value) => value.assets),
  ]).safeParse(data);
  // Validate the entire registry before approving any identity; never silently
  // turn a partially malformed response into a smaller authoritative registry.
  if (!envelope.success) throw new Error("Invalid Robinhood canonical registry");
  const assets = envelope.data;

  const normalized: CanonicalAsset[] = [];
  const ids = new Set<string>();
  const addresses = new Set<string>();

  for (const raw of assets) {
    const item = raw;

    // Contract lives in deployments[] — find the Robinhood Chain deployment
    if (ids.has(item.id)) throw new Error("Ambiguous Robinhood canonical registry asset ID");
    ids.add(item.id);
    const deployments = item.deployments.filter((deployment) => deployment.chainId === getChain().id);
    if (deployments.length > 1) throw new Error("Ambiguous Robinhood canonical registry deployment");
    const deployment = deployments[0];
    if (!deployment) continue; // Valid asset explicitly not deployed on this chain.
    const address = deployment.contractAddress.toLowerCase();
    if (addresses.has(address)) throw new Error("Ambiguous Robinhood canonical registry address");
    addresses.add(address);

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
      sourceUpdatedAt: null,
    });
  }

  if (normalized.length === 0) throw new Error("Robinhood canonical registry has no usable deployments");
  return normalized;
}
