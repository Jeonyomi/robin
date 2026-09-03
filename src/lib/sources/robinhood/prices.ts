import { z } from "zod";
import { getAPIs } from "@/lib/config";

// ── Raw Price Schema (verified against live /rhj/prices response) ───────────
// Batch endpoint returns { quotes: [...] } — all assets in ONE request.

const rawQuoteSchema = z.object({
  tokenSymbol: z.string(),
  deployments: z
    .array(z.object({ contractAddress: z.string(), chainId: z.number() }))
    .optional(),
  bid: z.string().optional(),
  ask: z.string().optional(),
  currency: z.string().optional(),
  dailyTradingVolume: z.string().optional(),
  isTradingHalt: z.boolean().optional(),
  generatedAt: z.string().optional(),
});

export type RawRobinhoodQuote = z.infer<typeof rawQuoteSchema>;

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

// ── Multiplier Normalization (pure — testable) ───────────────────────────────
// Raw underlier mid must be divided by currentMultiplier to get the
// onchain-adjusted reference price. Never divide by zero or null.

export function adjustReferencePrice(
  rawMid: number | null,
  currentMultiplier: string | null,
): number | null {
  if (rawMid === null || currentMultiplier === null) return null;
  const multiplier = parseFloat(currentMultiplier);
  if (!Number.isFinite(multiplier) || multiplier === 0) return null;
  return rawMid / multiplier;
}

// ── Adapter — batch fetch of ALL reference quotes ───────────────────────────
// Uses the batch endpoint (1 request) instead of per-symbol (rate-limited).

export async function fetchAllReferencePrices(): Promise<NormalizedPrice[]> {
  const url = `${getAPIs().robinhood.baseUrl}/rhj/prices`;

  const response = await fetchWithRetry(url, 3);
  if (!response.ok) {
    throw new Error(`Robinhood prices API failed: ${response.status}`);
  }

  const data = await response.json();
  const quotes = data.quotes || [];
  const result: NormalizedPrice[] = [];

  for (const raw of quotes) {
    const parsed = rawQuoteSchema.safeParse(raw);
    if (!parsed.success) continue;

    const quote = parsed.data;
    const rawBid = quote.bid ? parseFloat(quote.bid) : null;
    const rawAsk = quote.ask ? parseFloat(quote.ask) : null;
    const rawMid = rawBid !== null && rawAsk !== null ? (rawBid + rawAsk) / 2 : rawBid ?? rawAsk;

    result.push({
      symbol: quote.tokenSymbol.toUpperCase(),
      rawBid,
      rawAsk,
      rawMid,
      currentMultiplier: null, // multiplier comes from canonical assets table
      adjustedReferencePrice: rawMid,
      tradingHalt: quote.isTradingHalt || false,
      referenceTimestamp: quote.generatedAt ? new Date(quote.generatedAt) : new Date(),
    });
  }

  return result;
}

// ── Retry helper (429 / 5xx → exponential backoff) ──────────────────────────

async function fetchWithRetry(url: string, retries: number): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (response.ok || attempt >= retries) return response;

    // Respect Retry-After when present
    const retryAfter = response.headers.get("retry-after");
    const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
    await new Promise((r) => setTimeout(r, wait));
    delay *= 2;
  }
}

// Kept for single-symbol use cases (rate-limited; prefer batch)
export async function fetchReferencePrice(
  symbol: string,
  currentMultiplier: string | null,
): Promise<NormalizedPrice | null> {
  const all = await fetchAllReferencePrices();
  const match = all.find((p) => p.symbol === symbol.toUpperCase());
  if (!match) return null;
  return { ...match, currentMultiplier, adjustedReferencePrice: adjustReferencePrice(match.rawMid, currentMultiplier) };
}
