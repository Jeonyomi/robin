import { z } from "zod";
import { getAPIs } from "@/lib/config";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const gweiSchema = z.number().finite().nonnegative();
// Object tiers report Gwei in price; wei and fee components are not substitutes.
const gasPriceSchema = z.union([
  gweiSchema,
  z.object({ price: gweiSchema }).transform((tier) => tier.price),
]).nullable().optional();

const countSchema = z.string()
  .regex(/^[0-9]+$/, "Expected a nonnegative integer count string")
  .refine((value) => Number.isSafeInteger(Number(value)), "Count exceeds safe integer range");

const statsSchema = z.object({
  total_blocks: countSchema,
  total_transactions: countSchema,
  total_addresses: countSchema,
  average_block_time: z.number().nullable().optional(),
  network_utilization_percentage: z.number().nullable().optional(),
  gas_used_today: z.string().nullable().optional(),
  gas_prices: z.object({
    slow: gasPriceSchema,
    average: gasPriceSchema,
    fast: gasPriceSchema,
  }).nullable().optional(),
  gas_price_updated_at: z.string().nullable().optional(),
}).passthrough();

export type BlockscoutChainStats = {
  totalBlocks: number;
  totalTransactions: number;
  totalAddresses: number;
  averageBlockTimeMs: number | null;
  networkUtilizationPct: number | null;
  gasUsedToday: string | null;
  gasPricesGwei: { slow: number | null; average: number | null; fast: number | null } | null;
  gasPriceUpdatedAt: string | null;
  observedAt: string;
};

export async function fetchChainStats(): Promise<BlockscoutChainStats> {
  const base = getAPIs().blockscout.baseUrl;
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": BROWSER_UA };
  const key = getAPIs().blockscout.apiKey;
  if (key) headers.Authorization = `Bearer ${key}`;

  const response = await fetch(`${base}/stats`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Blockscout stats API failed: ${response.status}`);

  const parsed = statsSchema.safeParse(await response.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid Blockscout stats response at ${issue?.path.join(".") || "response"}: ${issue?.message ?? "unknown schema error"}`);
  }

  const value = parsed.data;
  return {
    totalBlocks: Number(value.total_blocks),
    totalTransactions: Number(value.total_transactions),
    totalAddresses: Number(value.total_addresses),
    averageBlockTimeMs: value.average_block_time ?? null,
    networkUtilizationPct: value.network_utilization_percentage ?? null,
    gasUsedToday: value.gas_used_today ?? null,
    gasPricesGwei: value.gas_prices
      ? {
          slow: value.gas_prices.slow ?? null,
          average: value.gas_prices.average ?? null,
          fast: value.gas_prices.fast ?? null,
        }
      : null,
    gasPriceUpdatedAt: value.gas_price_updated_at ?? null,
    observedAt: new Date().toISOString(),
  };
}
