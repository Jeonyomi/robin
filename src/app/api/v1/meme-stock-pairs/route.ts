import { discoverStockPairs } from "@/lib/sources/meme-stock-discovery";
import { inspectStockPool, inspectStockPositions } from "@/lib/sources/meme-stock-onchain";
import type { PoolInspection, PairPositions } from "@/lib/meme-stock-types";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store, max-age=0" };
const poolPattern = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const cache = new Map<string, { until: number; data: PoolInspection | PairPositions }>();
let active = false;
let nextReadAt = 0;
let starts: number[] = [];
function fail(error: string, status: number, retry = false) {
  return Response.json({ data: null, error }, { status, headers: { ...headers, ...(retry ? { "Retry-After": "30" } : {}) } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["pool", "positions", "tokenId"]);
  if ([...params.keys()].some((k) => !allowed.has(k) || params.getAll(k).length !== 1)) return fail("Invalid or duplicate query parameters.", 400);
  const pool = params.get("pool");
  const sample = params.get("positions");
  const tokenId = params.get("tokenId");
  if ((sample !== null && sample !== "1") || (sample !== null && tokenId !== null)
    || (pool === null && params.size > 0) || (pool !== null && !poolPattern.test(pool))
    || (tokenId !== null && (!/^[1-9][0-9]{0,77}$/.test(tokenId) || BigInt(tokenId) >= BigInt(2) ** BigInt(256)))) {
    return fail("Provide a valid pool identifier and either positions=1 or a positive decimal NFT tokenId, without leading zeros.", 400);
  }
  let discovery;
  try { discovery = await discoverStockPairs(); }
  catch { return fail("Pair discovery or canonical registry is unavailable. No stale list has been substituted. Retry later.", 503, true); }
  if (pool === null) return Response.json({ data: discovery, error: null }, { headers });
  const pair = discovery.pairs.find((p) => p.id === pool.toLowerCase());
  if (!pair) return fail("Pool is not in the current bounded discovery list. Refresh discovery first.", 404);
  if (pair.protocol === "unsupported") return fail("This DEX or pool version is discoverable but is not supported by the onchain inspector.", 422);
  const key = `${pair.protocol}:${pair.id}:${sample ?? ""}:${tokenId ?? ""}`;
  const now = Date.now();
  for (const [id, item] of cache) if (item.until <= now) cache.delete(id);
  const hit = cache.get(key);
  if (hit && now - Date.parse(hit.data.observedAt) <= 120_000 && now >= Date.parse(hit.data.observedAt) - 30_000) {
    return Response.json({ data: hit.data, error: null }, { headers });
  }
  starts = starts.filter((time) => now - time < 60_000);
  if (active || now < nextReadAt || starts.length >= 6) return fail("Public onchain inspector is cooling down. Wait before the next read.", 429, true);
  active = true; starts.push(now);
  try {
    const data = sample !== null || tokenId !== null
      ? await inspectStockPositions(pair, tokenId ?? undefined)
      : await inspectStockPool(pair);
    const age = Date.now() - Date.parse(data.observedAt);
    if (!Number.isFinite(age) || age > 120_000 || age < -30_000 || data.poolId.toLowerCase() !== pair.id) {
      return fail("Onchain observation failed identity or freshness checks. Snapshot withheld.", 503, true);
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + 45_000, data });
    return Response.json({ data, error: null }, { headers });
  } catch {
    nextReadAt = Date.now() + 30_000;
    return fail("Pool or NFT data could not be verified. The NFT may belong to another pool, or the public RPC may be unavailable. No fees or performance have been inferred.", 503, true);
  } finally {
    active = false;
    nextReadAt = Math.max(nextReadAt, Date.now() + 2_000);
  }
}
