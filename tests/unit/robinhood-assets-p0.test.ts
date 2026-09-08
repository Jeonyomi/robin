import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCanonicalAssets } from "@/lib/sources/robinhood/assets";

vi.mock("@/lib/config", () => ({
  getChain: () => ({ id: 4663 }),
  getAPIs: () => ({ robinhood: { assetsUrl: "https://robinhood.invalid/rhj/assets" } }),
}));
const fetchMock = vi.fn<typeof fetch>();
const address = "0x" + "a".repeat(40);
const valid = { id: "asset-1", tokenSymbol: "ABC", deployments: [{ chainId: 4663, contractAddress: address }] };
function respond(body: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("canonical registry fail-closed P0", () => {
  it.each([{}, null, [], { assets: [] }, { assets: [{}] }, { assets: [valid, {}] },
    { assets: [{ ...valid, deployments: [{ chainId: 4663, contractAddress: "0xBAD" }] }] },
    { assets: [{ ...valid, deployments: [{ chainId: 1, contractAddress: address }] }] },
  ].map((body) => [body]))("rejects invalid, empty or partially malformed registries (%j)", async (body) => {
    respond(body);
    await expect(fetchCanonicalAssets()).rejects.toThrow(/registry/i);
  });
  it.each([
    { assets: [valid, { ...valid, id: "asset-2", deployments: undefined }] },
    { assets: [valid, { ...valid, id: "asset-2" }] },
    { assets: [{ ...valid, deployments: [...valid.deployments, { chainId: 4663, contractAddress: "0x" + "b".repeat(40) }] }] },
  ])("rejects incomplete or ambiguous identity proof %j", async (body) => {
    respond(body); await expect(fetchCanonicalAssets()).rejects.toThrow(/registry/i);
  });
  it("keeps unknown provider update time null", async () => {
    respond({ assets: [valid] });
    expect(await fetchCanonicalAssets()).toEqual([expect.objectContaining({ contractAddress: address, sourceUpdatedAt: null })]);
  });
});
