// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChainStats } from "@/lib/sources/blockscout/stats";

vi.mock("@/lib/config", () => ({
  getAPIs: () => ({ blockscout: { baseUrl: "https://blockscout.invalid/api/v2", apiKey: "test-secret" } }),
}));

// Public fields copied from stats-sample-0.json captured on 2026-09-08.
const objectSample = {
  total_blocks: "57666471",
  total_transactions: "650101217",
  total_addresses: "20182724",
  average_block_time: 101,
  network_utilization_percentage: 3.5923029884088464e-7,
  gas_used_today: "2540692498263",
  gas_price_updated_at: "2026-09-08T13:31:15.448970Z",
  gas_prices: {
    slow: { time: 505, wei: "214274905", base_fee: 0.22, fiat_price: "0.01", price: 0.22, priority_fee: 0.01, priority_fee_wei: "3846154" },
    average: { time: 303, wei: "248256372", base_fee: 0.22, fiat_price: "0.01", price: 0.25, priority_fee: 0.04, priority_fee_wei: "37827621" },
    fast: { time: 101, wei: "455735149", base_fee: 0.22, fiat_price: "0.02", price: 0.46, priority_fee: 0.25, priority_fee_wei: "245306398" },
  },
};

function respond(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchChainStats", () => {
  it("reads Gwei price from real Blockscout object tiers without losing chain stats", async () => {
    respond(objectSample);
    await expect(fetchChainStats()).resolves.toMatchObject({
      totalBlocks: 57666471,
      totalTransactions: 650101217,
      totalAddresses: 20182724,
      averageBlockTimeMs: 101,
      networkUtilizationPct: 3.5923029884088464e-7,
      gasUsedToday: "2540692498263",
      gasPricesGwei: { slow: 0.22, average: 0.25, fast: 0.46 },
      gasPriceUpdatedAt: "2026-09-08T13:31:15.448970Z",
      observedAt: expect.any(String),
    });
  });

  it("accepts legacy numeric prices from sample-1 and preserves request options", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = respond({
      ...objectSample,
      total_blocks: "57665570", total_transactions: "650093986", total_addresses: "20182407",
      gas_prices: { slow: 0.22, average: 0.25, fast: 1.21 },
    });
    await expect(fetchChainStats()).resolves.toMatchObject({
      totalBlocks: 57665570, totalTransactions: 650093986, totalAddresses: 20182407,
      gasPricesGwei: { slow: 0.22, average: 0.25, fast: 1.21 },
    });
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(fetchMock).toHaveBeenCalledWith("https://blockscout.invalid/api/v2/stats", {
      headers: { Accept: "application/json", Authorization: "Bearer test-secret", "User-Agent": expect.stringContaining("Mozilla/5.0") },
      signal: expect.any(AbortSignal),
    });
  });

  it("accepts mixed tiers and uses only price, retaining numeric and object zero", async () => {
    respond({ ...objectSample, gas_prices: { slow: 0, average: { ...objectSample.gas_prices.fast, price: 0 }, fast: 1.21 } });
    await expect(fetchChainStats()).resolves.toMatchObject({ gasPricesGwei: { slow: 0, average: 0, fast: 1.21 } });
  });

  it.each([null, undefined])("preserves absent gas prices (%s)", async (gas_prices) => {
    respond({ ...objectSample, gas_prices });
    await expect(fetchChainStats()).resolves.toMatchObject({ gasPricesGwei: null });
  });

  it("normalizes null and missing tiers without fabricating a price", async () => {
    respond({ ...objectSample, gas_prices: { slow: null, fast: { price: 0.46 } } });
    await expect(fetchChainStats()).resolves.toMatchObject({ gasPricesGwei: { slow: null, average: null, fast: 0.46 } });
  });

  it("accepts zero counts and missing optional stats", async () => {
    respond({ total_blocks: "0", total_transactions: "0", total_addresses: "0" });
    await expect(fetchChainStats()).resolves.toMatchObject({
      totalBlocks: 0, totalTransactions: 0, totalAddresses: 0,
      averageBlockTimeMs: null, networkUtilizationPct: null, gasUsedToday: null,
      gasPricesGwei: null, gasPriceUpdatedAt: null,
    });
  });

  it.each(["slow", "average", "fast"])("rejects negative numeric and object %s prices with field paths", async (tier) => {
    for (const price of [-1, { price: -1 }]) {
      respond({ ...objectSample, gas_prices: { ...objectSample.gas_prices, [tier]: price } });
      await expect(fetchChainStats()).rejects.toThrow(`gas_prices.${tier}`);
    }
  });

  it.each([
    ["string", "payload-secret"], ["boolean", true], ["array", []],
    ["missing price", {}], ["wrong-unit fields only", { wei: "214274905", fiat_price: "0.01", priority_fee: 0.01 }],
    ["null object price", { price: null }], ["string object price", { price: "payload-secret" }],
    ["NaN", NaN], ["Infinity", Infinity], ["negative Infinity", -Infinity],
    ["object NaN", { price: NaN }], ["object Infinity", { price: Infinity }],
    ["object negative Infinity", { price: -Infinity }],
  ])("rejects malformed %s without exposing payload or authorization", async (_label, slow) => {
    respond({ ...objectSample, gas_prices: { slow }, secret: "payload-secret" });
    const error = await fetchChainStats().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("gas_prices.slow");
    expect((error as Error).message).not.toMatch(/payload-secret|test-secret|214274905/);
  });

  it.each(["bad", 1, []])("rejects a malformed gas_prices container (%s)", async (gas_prices) => {
    respond({ ...objectSample, gas_prices });
    await expect(fetchChainStats()).rejects.toThrow("gas_prices");
  });

  it.each(["total_blocks", "total_transactions", "total_addresses"])("rejects invalid required count %s", async (field) => {
    for (const value of ["", " ", "abc", "1.5", "1e3", "-1", "Infinity", "9007199254740992", "9".repeat(400), null, undefined, 123]) {
      respond({ ...objectSample, [field]: value });
      await expect(fetchChainStats()).rejects.toThrow(field);
    }
  });

  it.each([429, 500])("reports HTTP %s without reading or leaking the body", async (status) => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json }));
    await expect(fetchChainStats()).rejects.toThrow(`Blockscout stats API failed: ${status}`);
    expect(json).not.toHaveBeenCalled();
  });

  it("propagates network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    await expect(fetchChainStats()).rejects.toThrow("network unavailable");
  });
});
