import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, http } from "viem";
import { LP_LEADER_FRESH_MS, type LpLeaderboard } from "@/lib/lp-leaders";
import { createLpSnapshotService, LP_SNAPSHOT_REVALIDATE_SECONDS, LpUnavailableError, safeLpUnavailable } from "@/lib/sources/uniswap-v3/availability";
import { createPacedLpFetch, sourceRetryAfter } from "@/lib/sources/uniswap-v3/paced-fetch";

// Explicitly synthetic empty enumeration; never an operational fallback dataset.
function board(now: number): LpLeaderboard {
  return { chainId: 4663, protocol: "uniswap-v3", positionManager: `0x${"11".repeat(20)}`, weth: `0x${"22".repeat(20)}`, blockNumber: "1", blockHash: `0x${"33".repeat(32)}`, observedAt: new Date(now).toISOString(), totalNfts: 0, sampled: 0, eligible: 0, excluded: 0, unsupported: 0, sampleMethod: "stratified-enumerable-indices-v1", ranking: "lifetime-native-weth-fees", rows: [] };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("snapshot service budgets and failure cooldown", () => {
  it("coalesces concurrent requests and cache hits do not renew the source timestamp", async () => {
    let now = 1_000_000; const data = board(now);
    const collect = vi.fn(async () => data); const read = createLpSnapshotService(collect, () => now);
    const one = read(); const two = read(); expect(one).toBe(two);
    expect(await one).toBe(data); now += 30_000;
    expect(await read()).toBe(data); expect(collect).toHaveBeenCalledTimes(1);
    expect((await read()).observedAt).toBe(data.observedAt);
    now += LP_SNAPSHOT_REVALIDATE_SECONDS * 1000;
    await read(); expect(collect).toHaveBeenCalledTimes(2);
  });
  it("blocks repeated clicks from restarting a 429 scan, and recovers only after cooldown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000_000;
    const collect = vi.fn<() => Promise<LpLeaderboard>>().mockRejectedValueOnce(new Error("private details", { cause: { code: 429 } })).mockImplementation(async () => board(now));
    const read = createLpSnapshotService(collect, () => now);
    await expect(read()).rejects.toMatchObject({ code: 429, retryAfterSeconds: 60 });
    for (let i = 0; i < 5; i++) await expect(read()).rejects.toMatchObject({ code: 429 });
    expect(collect).toHaveBeenCalledTimes(1);
    now += 59_000;
    await expect(read()).rejects.toMatchObject({ retryAfterSeconds: 1 });
    now += 1_000; expect((await read()).observedAt).toBe(new Date(now).toISOString());
    expect(collect).toHaveBeenCalledTimes(2);
  });
  it("does not renew or return an expired cache entry after a failed refresh", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 1_000_000; const collect = vi.fn(async () => board(now));
    const read = createLpSnapshotService(collect, () => now); await read();
    now += LP_LEADER_FRESH_MS + 1; collect.mockRejectedValue(new Error("SECRET_URL"));
    const error = await read().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 503, retryAfterSeconds: 15 });
    expect(String(error)).not.toContain("SECRET_URL"); expect(error).not.toHaveProperty("cause");
    await expect(read()).rejects.toThrow(); expect(collect).toHaveBeenCalledTimes(2);
  });
  it("rejects source-aged collection output before publishing it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = 1_000_000;
    await expect(createLpSnapshotService(async () => board(now - LP_LEADER_FRESH_MS - 1), () => now)()).rejects.toMatchObject({ code: 503 });
  });
  it("retains remaining/provider cooldown without leaking a cause", () => {
    expect(safeLpUnavailable(new LpUnavailableError(true, 1))).toMatchObject({ code: 429, retryAfterSeconds: 1 });
    expect(safeLpUnavailable(new Error("SECRET", { cause: new LpUnavailableError(true, 180) }))).toMatchObject({ code: 429, retryAfterSeconds: 180 });
    expect(sourceRetryAfter("180")).toBe(180); expect(sourceRetryAfter(null)).toBe(60); expect(sourceRetryAfter("bad")).toBe(60);
    const now = Date.parse("2026-09-05T00:00:00Z"); expect(sourceRetryAfter("Sat, 05 Sep 2026 00:03:00 GMT", now)).toBe(180);
  });
});

describe("paced single-request transport", () => {
  it.each([200, 429])("detects HTTP/JSON-RPC 429 at status %s and cancels the remaining queue", async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 429, message: "SECRET" } }), { status, headers: { "Retry-After": "75" } }));
    const paced = createPacedLpFetch(new AbortController().signal, { fetch: send, intervalMs: 25 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => paced("https://example.invalid", { body: "{}" })));
    expect(send).toHaveBeenCalledTimes(1);
    for (const result of results) { expect(result.status).toBe("rejected"); if (result.status === "rejected") expect(result.reason).toMatchObject({ code: 429, retryAfterSeconds: 75 }); }
    await expect(paced("https://example.invalid", { body: "{}" })).rejects.toMatchObject({ code: 429 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not count queue wait against the actual network timeout (real viem transport)", async () => {
    const times: number[] = [];
    const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      init?.signal?.throwIfAborted(); times.push(Date.now());
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1237" }));
    });
    const paced = createPacedLpFetch(new AbortController().signal, { fetch: send, intervalMs: 40, networkTimeoutMs: 15 });
    const client = createPublicClient({ transport: http("https://example.invalid", { batch: false, retryCount: 0, timeout: 0, fetchFn: paced }) });
    expect(await Promise.all(Array.from({ length: 4 }, () => client.request({ method: "eth_chainId" }, { dedupe: false })))).toEqual(["0x1237", "0x1237", "0x1237", "0x1237"]);
    expect(times[3] - times[0]).toBeGreaterThanOrEqual(100);
  });
  it("aborts an actual hanging request on its network deadline", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }));
    const paced = createPacedLpFetch(new AbortController().signal, { fetch: send, networkTimeoutMs: 20 });
    await expect(paced("https://example.invalid", { body: "{}" })).rejects.toThrow("aborted");
  });
  it("rejects oversized responses and JSON-RPC batches instead of inventing a result", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(2_000_001)));
    const paced = createPacedLpFetch(new AbortController().signal, { fetch: send, intervalMs: 1 });
    await expect(paced("https://example.invalid", { body: "[]" })).rejects.toThrow(/budget/); expect(send).not.toHaveBeenCalled();
    await expect(paced("https://example.invalid", { body: "{}" })).rejects.toThrow(/safe limit/);
  });
});
