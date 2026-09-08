import { z } from "zod";
import { getAPIs } from "@/lib/config";
import { fetchSourceJson, SourceRequestError } from "../source-request";

// ── Raw Blockscout Schemas (verified against live robinhoodchain.blockscout.com) ──
// Direct instance works with a browser User-Agent; api.blockscout.com/4663 requires a key.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const integerString = z.string().regex(/^\d+$/).max(1000);
const countString = integerString.refine(s => Number.isSafeInteger(Number(s)));
const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/).max(1000).refine(s => Number.isFinite(Number(s)));
const tokenSchema = z.object({
  address_hash: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  symbol: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  decimals: countString.refine(s => Number(s) <= 255).nullable().optional(),
  type: z.string().nullable().optional(),
  total_supply: integerString.nullable().optional(),
  holders_count: countString.nullable().optional(),
  exchange_rate: decimalString.nullable().optional(),
  circulating_market_cap: decimalString.nullable().optional(),
  volume_24h: decimalString.nullable().optional(),
});

const tokenCountersSchema = z.object({
  token_holders_count: countString.nullable().optional(),
  transfers_count: countString.nullable().optional(),
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
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new SourceRequestError("schema");
  const base = getAPIs().blockscout.baseUrl;
  const url = `${base}/tokens/${address.toLowerCase()}`;
  const options = { headers: baseHeaders(), scope: "metadata", allow404: true };
  const data = await fetchSourceJson("blockscout", url, options);
  if (data === null) return null;
  const parsed = tokenSchema.safeParse(data);
  if (!parsed.success || parsed.data.address_hash.toLowerCase() !== address.toLowerCase()) throw new SourceRequestError("schema");
  const token = parsed.data;
  const counters = await fetchSourceJson("blockscout", `${url}/counters`, options);
  const countersParsed = tokenCountersSchema.safeParse(counters === null ? {} : counters);
  if (!countersParsed.success) throw new SourceRequestError("schema");
  const count = (value: string | null | undefined) => value == null ? null : Number(value);
  return {
    address: token.address_hash.toLowerCase(),
    symbol: token.symbol || null,
    name: token.name || null,
    decimals: count(token.decimals),
    tokenType: token.type || null,
    totalSupply: token.total_supply ?? null,
    holdersCount: count(countersParsed.data.token_holders_count) ?? count(token.holders_count),
    exchangeRate: token.exchange_rate ?? null,
    marketCap: token.circulating_market_cap ?? null,
    volume24h: token.volume_24h ?? null,
    isVerified: null,
    isProxy: null,
    implementationAddress: null,
    transfersCount: count(countersParsed.data.transfers_count),
  };
}
