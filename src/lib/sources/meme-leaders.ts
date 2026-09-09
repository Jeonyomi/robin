import { z } from "zod";
import { fetchSourceJson, isSourceBlocked, SourceRequestError } from "./source-request";
import type { MemeLeader, MemeLeadersData } from "@/lib/meme-leaders";

const ROOT = "https://api.geckoterminal.com/api/v2";
const REGISTRY = "https://api.robinhood.com/rhj/assets";
const NETWORK = "robinhood";
export const MEME_METADATA_ENRICH_LIMIT = 0;
const EXCLUDED = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
]);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s.toLowerCase());
const text = z.string().min(1).max(160).refine(s => !/[\u0000-\u001f\u007f]/.test(s));
const token = z.object({ address, name: text, symbol: text.max(32), image_url: z.string().nullable().optional() });
const relation = z.object({ data: z.object({ id: z.string().max(200) }) });
const item = z.object({
  id: z.string().max(200), type: z.string().max(30), attributes: z.record(z.string(), z.unknown()),
  relationships: z.object({ base_token: relation, quote_token: relation, dex: relation }).optional(),
});
const feed = z.object({ data: z.array(item).max(20), included: z.array(item).max(100) });
const registrySchema = z.object({ assets: z.array(z.object({ deployments: z.array(z.object({ chainId: z.number().int(), contractAddress: address })).optional() })).max(10000) });

function number(value: unknown, signed = false): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && (signed || n >= 0) ? n : null;
}
function count(value: unknown) { const n = number(value); return n !== null && Number.isSafeInteger(n) ? n : null; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function image(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      && ["assets.geckoterminal.com", "coin-images.coingecko.com"].includes(u.hostname) ? u.href : null;
  } catch { return null; }
}
function date(value: unknown): string | null { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
async function read(url: string, signal: AbortSignal): Promise<unknown> {
  return fetchSourceJson(url === REGISTRY ? "robinhood" : "geckoterminal", url, { signal, scope: url === REGISTRY ? "assets" : "meme-leaders" });
}

async function collect(): Promise<MemeLeadersData> {
  const signal = AbortSignal.timeout(24_000);
  const registryRetrievedAt = new Date().toISOString();
  const registry = registrySchema.parse(await read(REGISTRY, signal));
  const stock = new Set(registry.assets.flatMap(a => (a.deployments ?? []).filter(d => d.chainId === 4663).map(d => d.contractAddress)));
  if (!stock.size) throw new SourceRequestError("schema");
  const data = feed.parse(await read(`${ROOT}/networks/${NETWORK}/trending_pools?include=base_token,quote_token,dex&page=1`, signal));
  const included = new Map(data.included.map(i => [i.id, i]));
  const unique = new Map<string, MemeLeader>();
  for (let i = 0; i < data.data.length; i++) {
    const p = data.data[i];
    if (p.type !== "pool" || !p.id.startsWith("robinhood_") || !p.relationships) continue;
    const baseItem = included.get(p.relationships.base_token.data.id);
    const quoteItem = included.get(p.relationships.quote_token.data.id);
    const base = token.safeParse(baseItem?.attributes); const quote = token.safeParse(quoteItem?.attributes);
    if (!base.success || !quote.success || baseItem?.id !== `robinhood_${base.data.address}` || quoteItem?.id !== `robinhood_${quote.data.address}`) continue;
    const b = base.data; const q = quote.data;
    if (stock.has(b.address) || EXCLUDED.has(b.address) || unique.has(b.address)) continue;
    const poolId = p.attributes.address;
    if (typeof poolId !== "string" || !/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(poolId) || p.id.toLowerCase() !== `robinhood_${poolId.toLowerCase()}`) continue;
    const a = p.attributes; const tx = object(object(a.transactions).h24);
    const dex = included.get(p.relationships.dex.data.id);
    unique.set(b.address, {
      address: b.address, symbol: b.symbol, name: b.name,
      rank: unique.size + 1, providerPoolRank: i + 1, classification: "candidate",
      categories: [], metadataStatus: "not-requested", imageUrl: image(b.image_url),
      priceUsd: number(a.base_token_price_usd), change1hPct: number(object(a.price_change_percentage).h1, true),
      change24hPct: number(object(a.price_change_percentage).h24, true),
      volume24hUsd: number(object(a.volume_usd).h24), liquidityUsd: number(a.reserve_in_usd),
      marketCapUsd: number(a.market_cap_usd), fdvUsd: number(a.fdv_usd),
      buys24h: count(tx.buys), sells24h: count(tx.sells),
      poolId: poolId.toLowerCase(), poolName: typeof a.name === "string" ? a.name.slice(0, 160) : `${b.symbol} / ${q.symbol}`,
      dex: typeof dex?.attributes.name === "string" ? dex.attributes.name.slice(0, 80) : p.relationships.dex.data.id,
      quoteSymbol: q.symbol, stockPaired: stock.has(q.address), poolCreatedAt: date(a.pool_created_at),
      sourceUrl: `https://www.geckoterminal.com/robinhood/pools/${poolId.toLowerCase()}`,
      tokenSourceUrl: `https://www.geckoterminal.com/robinhood/tokens/${b.address}`,
      holders: null, holdersUpdatedAt: null,
    });
  }
  const tokens = [...unique.values()];
  // Keep first-load latency bounded: pool metrics are already present in the
  // trending response, while category/holder metadata is optional enrichment.
  const enrich = tokens.slice(0, MEME_METADATA_ENRICH_LIMIT);
  let metadataFailed = 0;
  let metadataRequested = 0;
  for (const row of enrich) {
    if (signal.aborted) break;
    metadataRequested++;
      try {
        const result = z.object({ data: item }).parse(await read(`${ROOT}/networks/${NETWORK}/tokens/${row.address}/info`, signal));
        const attrs = result.data.attributes;
        if (result.data.type !== "token" || result.data.id !== `robinhood_${row.address}` || address.parse(attrs.address) !== row.address) throw new SourceRequestError("schema");
        const names = Array.isArray(attrs.categories) ? attrs.categories.filter((s): s is string => typeof s === "string" && s.length <= 80).slice(0, 20) : [];
        const ids = Array.isArray(attrs.gt_category_ids) ? attrs.gt_category_ids.filter((s): s is string => typeof s === "string" && s.length <= 80) : [];
        row.categories = names;
        // Explicit provider taxonomy heuristic, not token-name or ticker matching.
        row.classification = [...ids, ...names].some(s => /(?:meme|^inu$|dog[- ]themed|cat[- ]themed|frog[- ]themed|politifi)/i.test(s)) ? "source-tagged" : "candidate";
        row.metadataStatus = "available";
        row.imageUrl = image(attrs.image_url) ?? row.imageUrl;
        const holders = object(attrs.holders);
        row.holders = count(holders.count); row.holdersUpdatedAt = date(holders.last_updated);
      } catch (error) {
        row.metadataStatus = "unavailable"; metadataFailed++;
        if (error instanceof z.ZodError) throw new SourceRequestError("schema");
        if (error instanceof SourceRequestError && error.code === "schema") throw error;
        if (isSourceBlocked(error)) break;
      }
  }
  return {
    tokens, retrievedAt: new Date().toISOString(), registryRetrievedAt,
    source: "GeckoTerminal public Robinhood trending pools and token metadata; Robinhood canonical registry for stock exclusions.",
    ranking: "Provider trending-pool order, deduplicated by base-token contract. Not a Robinwatch score, price-gain ranking or whole-chain token ranking. Metrics use the first observed pool per token, not all token markets.",
    coverage: "First provider page only: up to 20 pools. Canonical stock base tokens and known native ETH/WETH/USDG addresses excluded. Quote-only tokens and later pages are not enumerated. Optional category/holder metadata is not fetched on the synchronous read path, so tokens remain unverified candidates and may be utility or other assets. Retrieval time does not establish provider observation freshness.",
    poolsObserved: data.data.length, tokensObserved: tokens.length, metadataRequested,
    metadataFailed, partial: true,
  };
}
let cached: MemeLeadersData | null = null;
let pending: Promise<MemeLeadersData> | null = null;
let retryAt = 0;
export async function fetchMemeLeaders(): Promise<MemeLeadersData> {
  if (cached && Date.now() - Date.parse(cached.retrievedAt) < 180_000) return cached;
  if (pending) return pending;
  if (Date.now() < retryAt) throw new SourceRequestError("cooldown", null, retryAt - Date.now());
  pending = collect().then(data => { cached = data; return data; }).catch((error: unknown) => {
    cached = null; retryAt = Date.now() + 30_000; throw error instanceof z.ZodError ? new SourceRequestError("schema") : error;
  }).finally(() => { pending = null; });
  return pending;
}
