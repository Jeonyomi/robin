import { z } from "zod";
import type { PairDiscovery, PairToken, StockPair } from "@/lib/meme-stock-types";

const REGISTRY = "https://api.robinhood.com/rhj/assets";
const DEX = "https://api.dexscreener.com";
const STOCKS = ["NVDA", "HIMS", "MU", "MSTR", "TSLA"];
// Search terms are discovery hints, never project identity or endorsements.
const SEARCHES = ["AI NVDA", "BONER HIMS", "MOO MU", "SAYLORMOON MSTR"];
const EXCLUDED = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
]);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase());
const tokenSchema = z.object({ address, symbol: z.string().min(1).max(32), name: z.string().max(160) });
const num = z.number().finite().nonnegative().nullable().optional();
const pairSchema = z.object({
  chainId: z.literal("robinhood"), dexId: z.string().min(1).max(40),
  pairAddress: z.string().regex(/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/),
  labels: z.array(z.string()).optional(), baseToken: tokenSchema, quoteToken: tokenSchema,
  liquidity: z.object({ usd: num, base: num, quote: num }).nullable().optional(),
  volume: z.object({ h24: num }).optional(),
  txns: z.object({ h24: z.object({ buys: num, sells: num }).optional() }).optional(),
  priceNative: z.string().regex(/^\d+(?:\.\d+)?$/).max(100).optional(),
});
const registrySchema = z.object({ assets: z.array(z.object({
  tokenSymbol: z.string().max(32), tokenName: z.string().nullable().optional(),
  deployments: z.array(z.object({ contractAddress: address, chainId: z.number().int() })).optional(),
})).max(10000) });
let cached: PairDiscovery | null = null;
let pending: Promise<PairDiscovery> | null = null;
let retryAfter = 0;

async function json(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal });
  if (!response.ok) throw new Error("Discovery provider unavailable.");
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error("Discovery response exceeded bounds.");
  return JSON.parse(text);
}

async function collect(): Promise<PairDiscovery> {
  const signal = AbortSignal.timeout(22_000);
  const registryRetrievedAt = new Date().toISOString();
  const registry = registrySchema.parse(await json(REGISTRY, signal));
  const canonical = new Map<string, PairToken>();
  for (const a of registry.assets) {
    for (const d of a.deployments ?? []) {
      if (d.chainId === 4663) canonical.set(d.contractAddress, {
        address: d.contractAddress, symbol: a.tokenSymbol, name: a.tokenName ?? a.tokenSymbol,
      });
    }
  }
  if (!canonical.size) throw new Error("Canonical registry unavailable.");
  const targets = STOCKS.map((s) => [...canonical.values()].find((a) => a.symbol === s));
  const failedStocks = STOCKS.filter((_, i) => !targets[i]);
  const jobs = [
    ...targets.flatMap((t) => t ? [{ label: t.symbol, url: `${DEX}/token-pairs/v1/robinhood/${t.address}`, search: false }] : []),
    ...SEARCHES.map((term) => ({ label: `Search: ${term}`, url: `${DEX}/latest/dex/search?q=${encodeURIComponent(term)}`, search: true })),
  ];
  const pairs = new Map<string, StockPair>();
  let successful = 0;
  // Three concurrent requests maximum; fixed basket, no user-driven upstream search.
  for (let start = 0; start < jobs.length; start += 3) {
    const batch = await Promise.all(jobs.slice(start, start + 3).map(async (job) => {
      try {
        const body = await json(job.url, signal);
        const items = job.search ? z.object({ pairs: z.array(z.unknown()).max(100) }).parse(body).pairs
          : z.array(z.unknown()).max(100).parse(body);
        return { job, items, retrievedAt: new Date().toISOString() };
      } catch { return { job, items: null, retrievedAt: new Date().toISOString() }; }
    }));
    for (const result of batch) {
      if (!result.items) { failedStocks.push(result.job.label); continue; }
      successful++;
      for (const item of result.items) {
        const parsed = pairSchema.safeParse(item);
        if (!parsed.success) continue;
        const p = parsed.data;
        const stockBase = canonical.get(p.baseToken.address);
        const stockQuote = canonical.get(p.quoteToken.address);
        // Exactly one canonical Stock Token; never infer identity from a ticker.
        if (!!stockBase === !!stockQuote) continue;
        const stock = stockBase ?? stockQuote!;
        if (!STOCKS.includes(stock.symbol)) continue;
        const other = stockBase ? p.quoteToken : p.baseToken;
        if (EXCLUDED.has(other.address) || other.address === stock.address) continue;
        const id = p.pairAddress.toLowerCase();
        const protocol = p.dexId === "uniswap" && p.labels?.includes("v3") && id.length === 42 ? "uniswap-v3"
          : p.dexId === "uniswap" && p.labels?.includes("v4") && id.length === 66 ? "uniswap-v4" : "unsupported";
        pairs.set(id, {
          id, protocol, dex: p.dexId, base: p.baseToken, quote: p.quoteToken, stock,
          stockSide: stockBase ? "base" : "quote", classification: "candidate",
          liquidityUsd: p.liquidity?.usd ?? null, baseReserve: p.liquidity?.base ?? null,
          quoteReserve: p.liquidity?.quote ?? null, volume24hUsd: p.volume?.h24 ?? null,
          buys24h: p.txns?.h24?.buys ?? null, sells24h: p.txns?.h24?.sells ?? null,
          priceNative: p.priceNative ?? null, sourceUrl: `https://dexscreener.com/robinhood/${id}`,
          retrievedAt: result.retrievedAt,
        });
      }
    }
  }
  if (!successful) throw new Error("Pair discovery is unavailable.");
  return {
    pairs: [...pairs.values()].sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) || a.id.localeCompare(b.id)).slice(0, 60),
    retrievedAt: new Date().toISOString(), registryRetrievedAt, stockSymbols: STOCKS,
    failedStocks, partial: true,
    coverage: "Bounded discovery: NVDA, HIMS, MU, MSTR, TSLA registry addresses plus four narrative search hints. Provider-limited results, at most 60 pools; not all pools or a popularity ranking. Non-stock tokens are candidates, not verified meme projects.",
    source: "DEX Screener reported metrics; Robinhood canonical registry address matching. Retrieval times are not provider observation times. Pool and NFT verification is separate and on demand.",
  };
}

export async function discoverStockPairs(): Promise<PairDiscovery> {
  const now = Date.now();
  if (cached && now - Date.parse(cached.retrievedAt) < 180_000) return cached;
  if (pending) return pending;
  if (now < retryAfter) throw new Error("Discovery cooling down after a provider failure.");
  pending = collect().then((data) => { cached = data; return data; }).catch((error: unknown) => {
    cached = null; retryAfter = Date.now() + 30_000; throw error;
  }).finally(() => { pending = null; });
  return pending;
}
