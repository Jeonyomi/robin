import { z } from "zod";
import { getAPIs } from "@/lib/config";

// ── Raw Blockscout Schemas ──────────────────────────────────────────────────

const tokenSchema = z.object({
  address: z.string(),
  symbol: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  decimals: z.string().nullable().optional(),
  token_type: z.string().nullable().optional(),
  total_supply: z.string().nullable().optional(),
  holders_count: z.string().nullable().optional(),
  exchange_rate: z.string().nullable().optional(),
  market_cap: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  is_proxy: z.boolean().nullable().optional(),
  implementation_address: z.string().nullable().optional(),
});

const tokenCountersSchema = z.object({
  token_transfers_count: z.string().nullable().optional(),
  holders_count: z.string().nullable().optional(),
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
  isVerified: boolean | null;
  isProxy: boolean | null;
  implementationAddress: string | null;
  transfersCount: number | null;
};

// ── Adapter ─────────────────────────────────────────────────────────────────

export async function fetchTokenMetadata(address: string): Promise<BlockscoutToken | null> {
  const url = `${getAPIs().blockscout.baseUrl}/tokens/${address.toLowerCase()}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        ...(getAPIs().blockscout.apiKey ? { "Authorization": `Bearer ${getAPIs().blockscout.apiKey}` } : {}),
      },
    });

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

    // Fetch counters separately
    let holdersCount = token.holders_count ? parseInt(token.holders_count) : null;
    let transfersCount: number | null = null;

    try {
      const countersUrl = `${getAPIs().blockscout.baseUrl}/tokens/${address.toLowerCase()}/counters`;
      const countersResponse = await fetch(countersUrl, {
        headers: {
          "Accept": "application/json",
          ...(getAPIs().blockscout.apiKey ? { "Authorization": `Bearer ${getAPIs().blockscout.apiKey}` } : {}),
        },
      });

      if (countersResponse.ok) {
        const countersData = await countersResponse.json();
        const countersParsed = tokenCountersSchema.safeParse(countersData);
        if (countersParsed.success) {
          if (countersParsed.data.holders_count) {
            holdersCount = parseInt(countersParsed.data.holders_count);
          }
          if (countersParsed.data.token_transfers_count) {
            transfersCount = parseInt(countersParsed.data.token_transfers_count);
          }
        }
      }
    } catch {
      // Continue without counters
    }

    return {
      address: token.address.toLowerCase(),
      symbol: token.symbol || null,
      name: token.name || null,
      decimals: token.decimals ? parseInt(token.decimals) : null,
      tokenType: token.token_type || null,
      totalSupply: token.total_supply || null,
      holdersCount,
      exchangeRate: token.exchange_rate || null,
      marketCap: token.market_cap || null,
      isVerified: token.is_verified || null,
      isProxy: token.is_proxy || null,
      implementationAddress: token.implementation_address || null,
      transfersCount,
    };
  } catch (error) {
    console.error(`Failed to fetch token ${address} from Blockscout:`, error);
    return null;
  }
}

export async function fetchTokenTransfers(
  address: string,
  limit = 100,
  cursor?: string,
): Promise<{
  transfers: Array<{
    txHash: string;
    logIndex: number;
    from: string;
    to: string;
    value: string;
    blockNumber: number;
    timestamp: string;
  }>;
  nextCursor: string | null;
}> {
  const url = new URL(`${getAPIs().blockscout.baseUrl}/tokens/${address.toLowerCase()}/transfers`);
  url.searchParams.set("limit", limit.toString());
  if (cursor) url.searchParams.set("cursor", cursor);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        ...(getAPIs().blockscout.apiKey ? { "Authorization": `Bearer ${getAPIs().blockscout.apiKey}` } : {}),
      },
    });

    if (!response.ok) {
      return { transfers: [], nextCursor: null };
    }

    const data = await response.json();
    const items = data.items || [];
    const nextCursor = data.next_page_cursor || null;

    return {
      transfers: items.map((item: Record<string, unknown>) => ({
        txHash: item.tx_hash as string,
        logIndex: item.log_index as number,
        from: (item.from as Record<string, unknown>)?.hash as string || "",
        to: (item.to as Record<string, unknown>)?.hash as string || "",
        value: item.value as string,
        blockNumber: item.block_number as number,
        timestamp: item.timestamp as string,
      })),
      nextCursor,
    };
  } catch (error) {
    console.error(`Failed to fetch transfers for ${address}:`, error);
    return { transfers: [], nextCursor: null };
  }
}
