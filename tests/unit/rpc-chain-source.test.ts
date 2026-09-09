// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRpcChainSnapshot } from "@/lib/sources/rpc-chain";

vi.mock("@/lib/config", () => ({
  getChain: () => ({ id: 4663, rpcUrl: "https://rpc.invalid" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchRpcChainSnapshot", () => {
  it("returns a current block observation and standard gas price", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: "0x378bcba" }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 2, result: "0xd7f3a0" }));
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchRpcChainSnapshot()).resolves.toMatchObject({
      latestBlock: 58244282,
      gasPricesGwei: { slow: null, average: 0.014152608, fast: null },
      source: "rpc",
      observedAt: expect.any(String),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed or failed RPC responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ jsonrpc: "2.0", id: 1, result: "bad" }))));
    await expect(fetchRpcChainSnapshot()).rejects.toThrow("Invalid RPC chain response");
  });
});
