import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceRequester, SourceRequestError } from "@/lib/sources/source-request";
import { fetchTokenMetadata } from "@/lib/sources/blockscout/token";
import { fetchTokenTransfers } from "@/lib/sources/blockscout/transfers";
import { fetchChainStats } from "@/lib/sources/blockscout/stats";
const shared = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/sources/source-request", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/sources/source-request")>(), fetchSourceJson: shared.request }));
vi.mock("@/lib/config", () => ({ getAPIs: () => ({ blockscout: { baseUrl: "https://blockscout.invalid/api/v2", apiKey: "auth-secret" } }) }));
const token = "0x1111111111111111111111111111111111111111";
const metadata = { address_hash: token, decimals: "18", holders_count: "12", total_supply: "1000000000000000000", exchange_rate: "1.23" };
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  let now = 1_800_000_000_000;
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  shared.request.mockReset().mockImplementation(createSourceRequester({ fetch: fetcher, now: () => now, wait: async ms => { now += ms; }, random: () => 0 }));
});
afterEach(() => vi.unstubAllGlobals());
describe("Blockscout shared admission", () => {
  it("halts later transfer tokens after a scope 403 but leaves stats eligible", async () => {
    fetcher.mockImplementation(async () => new Response(null, { status: 403 }));
    await expect(fetchTokenTransfers(token)).rejects.toMatchObject({ status: 403 });
    await expect(fetchTokenTransfers("0x2222222222222222222222222222222222222222")).rejects.toMatchObject({ code: "cooldown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ total_blocks: "1", total_transactions: "2", total_addresses: "3" }));
    await expect(fetchChainStats()).resolves.toMatchObject({ totalBlocks: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("passes bounded policy options and existing authorization", async () => {
    fetcher.mockResolvedValue(Response.json({ items: [], next_page_params: null }));
    await fetchTokenTransfers(token);
    expect(shared.request).toHaveBeenCalledWith("blockscout", expect.stringContaining("/transfers"), expect.objectContaining({ scope: "transfers", allow404: false, headers: expect.objectContaining({ Authorization: "Bearer auth-secret" }) }));
  });
  it("returns null for metadata 404 only", async () => {
    fetcher.mockImplementation(async () => new Response(null, { status: 404 }));
    await expect(fetchTokenMetadata(token)).resolves.toBeNull();
    fetcher.mockImplementation(async () => new Response(null, { status: 500 }));
    await expect(fetchTokenMetadata(token)).rejects.toBeInstanceOf(SourceRequestError);
  });
  it.each([
    { address_hash: "0x2222222222222222222222222222222222222222" }, { decimals: "18secret" }, { decimals: "256" },
    { holders_count: "-1" }, { holders_count: "9007199254740992" }, { total_supply: "1.2" },
    { exchange_rate: "Infinity" }, { volume_24h: "-1" }, { circulating_market_cap: "junk-secret" },
  ])("rejects invalid identity/numeric metadata without leaking details (%j)", async bad => {
    fetcher.mockImplementation(async () => Response.json({ ...metadata, ...bad }));
    const error = await fetchTokenMetadata(token).catch(e => e);
    expect(error).toBeInstanceOf(SourceRequestError);
    expect(error).toMatchObject({ code: "schema" });
    expect(error.message + JSON.stringify(error)).not.toMatch(/secret|111111|222222/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["metadata", "counters"])("rejects HTTP 200 JSON null at the %s endpoint", async endpoint => {
    if (endpoint === "counters") fetcher.mockResolvedValueOnce(Response.json(metadata));
    fetcher.mockResolvedValueOnce(Response.json(null));
    await expect(fetchTokenMetadata(token)).rejects.toMatchObject({ code: "schema", status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(endpoint === "metadata" ? 1 : 2);
  });
  it("validates counters and throws their failure instead of publishing partial metadata", async () => {
    fetcher.mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(Response.json({ transfers_count: "3junk-secret" }));
    await expect(fetchTokenMetadata(token)).rejects.toMatchObject({ code: "schema" });
    fetcher.mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(fetchTokenMetadata(token)).rejects.toMatchObject({ status: 403 });
  });
  it("normalizes valid metadata and permits a missing counters endpoint", async () => {
    fetcher.mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(fetchTokenMetadata(token)).resolves.toMatchObject({ address: token, decimals: 18, holdersCount: 12, transfersCount: null });
  });
  it("does not expose malformed transfers payloads", async () => {
    fetcher.mockResolvedValue(Response.json({ items: "body-secret" }));
    await expect(fetchTokenTransfers(token)).rejects.toMatchObject({ code: "schema" });
  });
});
