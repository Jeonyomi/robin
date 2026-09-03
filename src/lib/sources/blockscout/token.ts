import { z } from "zod";
import { getAPIs } from "@/lib/config";

// ── Raw Blockscout Schemas (verified against live robinhoodchain.blockscout.com) ──
// Direct instance works with a browser User-Agent; api.blockscout.com/4663 requires a key.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const tokenSchema = z.object({
  address_hash: z.string(),
  symbol: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  decimals: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  total_supply: z.string().nullable().optional(),
  holders_count: z.string().nullable().optional(),
  exchange_rate: z.string().nullable().optional(),
  circulating_market_cap: z.string().nullable().optional(),
  volume_24h: z.string().nullable().optional(),
});

const tokenCountersSchema = z.object({
  token_holders_count: z.string().nullable().optional(),
  transfers_count: z.string().nullable().optional(),
});

// ── Normalized Domain Model ─────────────────────────────────────────────────

export type BlockscoutToken = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  tokenType: string | null;
  totalSupply: string | null;
  holdersCount: number | null;
  exchangeRate: string | null;
  marketCap: string | null;
  volume24h: string | null;
  isVerified: boolean | null;
  isProxy: boolean | null;
  implementationAddress: string | null;
  transfersCount: number | null;
};

// ── Adapter ─────────────────────────────────────────────────────────────────

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": BROWSER_UA,
  };
  const key = getAPIs().blockscout.apiKey;
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

export async function fetchTokenMetadata(address: string): Promise<BlockscoutToken | null> {
  const base = getAPIs().blockscout.baseUrl;
  const url = `${base}/tokens/${address.toLowerCase()}`;

  try {
    const response = await fetch(url, { headers: baseHeaders() });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Blockscout token API failed: ${response.status}`);
    }

    const data = await response.json();
    const parsed = tokenSchema.safeParse(data);

    if (!parsed.success) {
      console.error(`Invalid token data for ${address}:`, parsed.error);
      return null;
    }

    const token = parsed.data;

    // Fetch counters separately (holders + transfers)
    let holdersCount = token.holders_count ? parseInt(token.holders_count) : null;
    let transfersCount: number | null = null;

    try {
      const countersResponse = await fetch(`${base}/tokens/${address.toLowerCase()}/counters`, {
        headers: baseHeaders(),
      });
      if (countersResponse.ok) {
        const countersParsed = tokenCountersSchema.safeParse(await countersResponse.json());
        if (countersParsed.success) {
          if (countersParsed.data.token_holders_count) {
            holdersCount = parseInt(countersParsed.data.token_holders_count);
          }
          if (countersParsed.data.transfers_count) {
            transfersCount = parseInt(countersParsed.data.transfers_count);
          }
        }
      }
    } catch {
      // Continue without counters
    }

    return {
      address: token.address_hash.toLowerCase(),
      symbol: token.symbol || null,
      name: token.name || null,
      decimals: token.decimals ? parseInt(token.decimals) : null,
      tokenType: token.type || null,
      totalSupply: token.total_supply || null,
      holdersCount,
      exchangeRate: token.exchange_rate || null,
      marketCap: token.circulating_market_cap || null,
      volume24h: token.volume_24h || null,
      isVerified: null, // smart-contract endpoint (P1)
      isProxy: null,
      implementationAddress: null,
      transfersCount,
    };
  } catch (error) {
    console.error(`Failed to fetch token ${address} from Blockscout:`, error);
    return null;
  }
}
