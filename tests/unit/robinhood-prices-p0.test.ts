import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adjustReferencePrice, fetchAllReferencePrices, fetchReferencePrice } from "@/lib/sources/robinhood/prices";
vi.mock("@/lib/config", () => ({ getAPIs: () => ({ robinhood: { baseUrl: "https://robinhood.invalid" } }) }));
const fetchMock = vi.fn<typeof fetch>();
const address = "0x" + "a".repeat(40);
const valid = { tokenSymbol: "ABC", deployments: [{ chainId: 4663, contractAddress: address }], bid: "10", ask: "12", currency: "USD", generatedAt: "2026-09-01T12:00:00Z" };
function respond(body: unknown) { fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("reference quote validation P0", () => {
  it("retains deployment identity and unknown provider time", async () => {
    respond({ quotes: [{ ...valid, generatedAt: undefined }] });
    expect((await fetchAllReferencePrices())[0]).toMatchObject({ deployments: valid.deployments, referenceTimestamp: null, rawMid: 11 });
  });
  it.each(["12junk", "NaN", "Infinity", "-1", "", " ", "0x10"])("rejects a malformed bid %s without hiding valid rows", async (bid) => {
    respond({ quotes: [valid, { ...valid, bid }] });
    const rows = await fetchAllReferencePrices();
    expect(rows).toHaveLength(1);
    expect(rows).toHaveProperty("rejectedCount", 1);
  });
  it.each([{ currency: "EUR" }, { bid: "13" }, { bid: undefined, ask: undefined }, { deployments: undefined }, { deployments: [{ chainId: 4663, contractAddress: "bad" }] }])("rejects unusable quote %j", async (invalid) => {
    respond({ quotes: [{ ...valid, ...invalid }] });
    await expect(fetchAllReferencePrices()).rejects.toThrow(/quote/i);
  });
  it.each(["not-a-date", "2999-01-01T00:00:00Z"])("does not invent a time for %s", async (generatedAt) => {
    respond({ quotes: [{ ...valid, generatedAt }] });
    expect((await fetchAllReferencePrices())[0].referenceTimestamp).toBeNull();
  });
  it.each([{}, null, { quotes: [] }, { quotes: [{}] }])("rejects invalid or empty envelope %j", async (body) => {
    respond(body); await expect(fetchAllReferencePrices()).rejects.toThrow(/quote/i);
  });
  it.each([[-1, "2"], [NaN, "2"], [Infinity, "2"], [10, "-2"], [10, "2junk"], [10, "Infinity"], [10, "1e-999"], [1e308, "0.01"]] as const)("rejects unsafe adjustment %s / %s", (price, multiplier) => {
    expect(adjustReferencePrice(price, multiplier)).toBeNull();
  });
  it("does not resolve a single-symbol request without contract identity", async () => {
    respond({ quotes: [valid] });
    expect(await fetchReferencePrice("ABC", "1")).toBeNull();
  });
});
