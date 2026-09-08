import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceRequester } from "@/lib/sources/source-request";
const shared = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/sources/source-request", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/sources/source-request")>(), fetchSourceJson: shared.request }));
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const registry = { assets: [{ tokenSymbol: "NVDA", deployments: [{ chainId: 4663, contractAddress: addr(99) }] }] };
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.resetModules();
  let now = 1_800_000_000_000;
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  shared.request.mockReset().mockImplementation(createSourceRequester({ fetch: fetcher, now: () => now, wait: async ms => { now += ms; }, random: () => 0 }));
});
afterEach(() => vi.unstubAllGlobals());
describe("DEX/Gecko shared request policy", () => {
  it.each(["leaders", "discovery"])("sanitizes malformed canonical registry for %s", async name => {
    fetcher.mockResolvedValue(Response.json({ assets: "body-secret" }));
    const call = name === "leaders" ? (await import("@/lib/sources/meme-leaders")).fetchMemeLeaders : (await import("@/lib/sources/meme-stock-discovery")).discoverStockPairs;
    const error = await call().catch(e => e);
    expect(error).toMatchObject({ code: "schema" });
    expect(error.message).not.toContain("body-secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops all remaining discovery requests after a 403 and reports incomplete coverage", async () => {
    fetcher.mockResolvedValueOnce(Response.json(registry)).mockResolvedValueOnce(Response.json([])).mockImplementation(async () => new Response(null, { status: 403 }));
    const { discoverStockPairs } = await import("@/lib/sources/meme-stock-discovery");
    const result = await discoverStockPairs();
    expect(result.partial).toBe(true);
    expect(result.failedStocks).toEqual(expect.arrayContaining(["Search: AI NVDA", "Search: SAYLORMOON MSTR"]));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(shared.request.mock.calls.map(c => c[0])).toEqual(["robinhood", "dexscreener", "dexscreener"]);
  });
  it("stops metadata after a 403 while retaining un-enriched leaders", async () => {
    const tokens = [1, 2, 3].map(n => ({ id: `robinhood_${addr(n)}`, type: "token", attributes: { address: addr(n), name: `Token ${n}`, symbol: `T${n}` } }));
    const quote = { id: `robinhood_${addr(99)}`, type: "token", attributes: { address: addr(99), name: "NVDA", symbol: "NVDA" } };
    const data = tokens.map((t, i) => ({ id: `robinhood_${addr(i + 10)}`, type: "pool", attributes: { address: addr(i + 10) }, relationships: { base_token: { data: { id: t.id } }, quote_token: { data: { id: quote.id } }, dex: { data: { id: "uniswap" } } } }));
    fetcher.mockResolvedValueOnce(Response.json(registry)).mockResolvedValueOnce(Response.json({ data, included: [...tokens, quote] })).mockImplementation(async () => new Response(null, { status: 403 }));
    const { fetchMemeLeaders } = await import("@/lib/sources/meme-leaders");
    const result = await fetchMemeLeaders();
    expect(result.tokens).toHaveLength(3);
    expect(result.metadataRequested).toBe(1);
    expect(result.metadataFailed).toBe(1);
    expect(result.tokens.map(t => t.metadataStatus)).toEqual(["unavailable", "not-requested", "not-requested"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(shared.request.mock.calls.map(c => c[0])).toEqual(["robinhood", "geckoterminal", "geckoterminal"]);
  });
});
