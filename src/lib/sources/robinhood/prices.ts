import { z } from "zod";
import { getAPIs } from "@/lib/config";
import { fetchSourceJson } from "@/lib/sources/source-request";

const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const priceString = z.string().regex(decimal).refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
const deploymentSchema = z.object({
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
});
const rawQuoteSchema = z.object({
  tokenSymbol: z.string().min(1),
  deployments: z.array(deploymentSchema).min(1),
  bid: priceString.optional(),
  ask: priceString.optional(),
  currency: z.literal("USD").optional(),
  dailyTradingVolume: z.string().optional(),
  isTradingHalt: z.boolean().optional(),
  generatedAt: z.string().nullable().optional(),
}).refine((quote) => quote.bid !== undefined || quote.ask !== undefined)
  .refine((quote) => quote.bid === undefined || quote.ask === undefined || Number(quote.bid) <= Number(quote.ask));

export type RawRobinhoodQuote = z.infer<typeof rawQuoteSchema>;
export type NormalizedPrice = {
  symbol: string;
  deployments: Array<{ contractAddress: string; chainId: number }>;
  rawBid: number | null;
  rawAsk: number | null;
  rawMid: number | null;
  currentMultiplier: string | null;
  adjustedReferencePrice: number | null;
  tradingHalt: boolean;
  referenceTimestamp: Date | null;
};
// Preserve the existing array API while exposing rejected rows to the sync job.
export type ReferencePriceBatch = NormalizedPrice[] & { rejectedCount: number };

export function adjustReferencePrice(rawMid: number | null, currentMultiplier: string | null): number | null {
  if (rawMid === null || !Number.isFinite(rawMid) || rawMid < 0 || currentMultiplier === null || !decimal.test(currentMultiplier)) return null;
  const multiplier = Number(currentMultiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  const adjusted = rawMid / multiplier;
  return Number.isFinite(adjusted) ? adjusted : null;
}

export async function fetchAllReferencePrices(): Promise<ReferencePriceBatch> {
  const data = await fetchSourceJson("robinhood", `${getAPIs().robinhood.baseUrl}/rhj/prices`, {
    headers: { Accept: "application/json" }, scope: "prices",
  });
  const envelope = z.object({ quotes: z.array(z.unknown()).min(1) }).safeParse(data);
  if (!envelope.success) throw new Error("Invalid or empty Robinhood quotes envelope");
  const result: ReferencePriceBatch = Object.assign([], { rejectedCount: 0 });
  for (const raw of envelope.data.quotes) {
    const parsed = rawQuoteSchema.safeParse(raw);
    if (!parsed.success) { result.rejectedCount++; continue; }
    const quote = parsed.data;
    const rawBid = quote.bid === undefined ? null : Number(quote.bid);
    const rawAsk = quote.ask === undefined ? null : Number(quote.ask);
    // Split before adding to avoid overflowing two otherwise finite inputs.
    const rawMid = rawBid !== null && rawAsk !== null ? rawBid / 2 + rawAsk / 2 : rawBid ?? rawAsk;
    const providerTime = z.iso.datetime({ offset: true }).safeParse(quote.generatedAt);
    const time = providerTime.success ? new Date(providerTime.data) : null;
    result.push({
      symbol: quote.tokenSymbol.toUpperCase(),
      deployments: quote.deployments.map((deployment) => ({ ...deployment, contractAddress: deployment.contractAddress.toLowerCase() })),
      rawBid, rawAsk, rawMid,
      currentMultiplier: null,
      adjustedReferencePrice: null, // Unknown until joined to verified canonical identity.
      tradingHalt: quote.isTradingHalt ?? false,
      referenceTimestamp: time && Number.isFinite(time.getTime()) && time.getTime() <= Date.now() ? time : null,
    });
  }
  if (result.length === 0) throw new Error(`Robinhood quotes contain no usable rows (${result.rejectedCount} rejected)`);
  return result;
}

// Legacy symbol-only callers fail closed. Supply chain+contract proof to opt in.
export async function fetchReferencePrice(
  symbol: string,
  currentMultiplier: string | null,
  identity?: { chainId: number; contractAddress: string },
): Promise<NormalizedPrice | null> {
  if (!identity || !/^0x[0-9a-fA-F]{40}$/.test(identity.contractAddress)) return null;
  const all = await fetchAllReferencePrices();
  const matches = all.filter((price) => price.symbol === symbol.toUpperCase() && price.deployments.some(
    (deployment) => deployment.chainId === identity.chainId && deployment.contractAddress === identity.contractAddress.toLowerCase(),
  ));
  if (matches.length !== 1) return null;
  const match = matches[0];
  return { ...match, currentMultiplier, adjustedReferencePrice: adjustReferencePrice(match.rawMid, currentMultiplier) };
}
