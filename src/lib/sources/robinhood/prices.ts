import { z } from "zod";
import { APIs } from "@/lib/config";

// ── Raw Price Schema ────────────────────────────────────────────────────────

const rawPriceSchema = z.object({
  symbol: z.string(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  mid: z.number().optional(),
  last: z.number().optional(),
  tradingHalt: z.boolean().optional(),
  dailyVolume: z.number().optional(),
  timestamp: z.string().optional(),
});

export type RawRobinhoodPrice = z.infer<typeof rawPriceSchema>;

// ── Normalized Domain Model ─────────────────────────────────────────────────

export type NormalizedPrice = {
  symbol: string;
  rawBid: number | null;
  rawAsk: number | null;
  rawMid: number | null;
  currentMultiplier: string | null;
  adjustedReferencePrice: number | null;
  tradingHalt: boolean;
  referenceTimestamp: Date;
};

// ── Adapter ─────────────────────────────────────────────────────────────────

export async function fetchReferencePrice(
  symbol: string,
  currentMultiplier: string | null,
): Promise<NormalizedPrice | null> {
  const url = `${APIs.robinhood.baseUrl}/rhj/prices/${symbol}`;

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Price API failed for ${symbol}: ${response.status}`);
    }

    const data = await response.json();
    const parsed = rawPriceSchema.safeParse(data);

    if (!parsed.success) {
      console.error(`Invalid price data for ${symbol}:`, parsed.error);
      return null;
    }

    const raw = parsed.data;
    const multiplier = currentMultiplier ? parseFloat(currentMultiplier) : 1;

    // Calculate adjusted reference price: raw_mid / multiplier
    const rawMid = raw.mid || raw.last || null;
    const adjustedReferencePrice = rawMid && multiplier
      ? rawMid / multiplier
      : null;

    return {
      symbol: raw.symbol,
      rawBid: raw.bid || null,
      rawAsk: raw.ask || null,
      rawMid: rawMid || null,
      currentMultiplier,
      adjustedReferencePrice,
      tradingHalt: raw.tradingHalt || false,
      referenceTimestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
    };
  } catch (error) {
    console.error(`Failed to fetch price for ${symbol}:`, error);
    return null;
  }
}
