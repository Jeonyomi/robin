import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourceRequester, createMemorySourceState, isSourceBlocked, SourceRequestError } from "@/lib/sources/source-request";

const url = "https://provider.invalid/path?secret=url-secret";
afterEach(() => { vi.useRealTimers(); });
function harness(fetcher: typeof fetch) {
  let now = 1_800_000_000_000;
  const wait = vi.fn(async (ms: number) => { now += ms; });
  const request = createSourceRequester({ fetch: fetcher, now: () => now, wait, random: () => 0 });
  return { request, wait };
}

describe("source admission and retries", () => {
  it("spaces serialized starts and stops queued transfers after a 403 without blocking stats", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 403 }));
    const { request, wait } = harness(fetcher);
    const results = await Promise.allSettled([1, 2, 3].map(() => request("blockscout", url, { scope: "transfers" })));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.status === "rejected" && isSourceBlocked(r.reason))).toBe(true);
    fetcher.mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(request("blockscout", url, { scope: "stats" })).resolves.toEqual({ ok: true });
    expect(wait).toHaveBeenCalledWith(1000);
  });
  it.each(["120", "Fri, 15 Jan 2027 08:02:00 GMT"])("persists provider-wide Retry-After %s through requester restart", async retryAfter => {
    let now = Date.parse("2027-01-15T08:00:00Z");
    const state = createMemorySourceState();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": retryAfter } }));
    const deps = { state, fetch: fetcher, now: () => now, wait: async (ms: number) => { now += ms; } };
    await expect(createSourceRequester(deps)("blockscout", url, { scope: "transfers" })).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
    await expect(createSourceRequester(deps)("blockscout", url, { scope: "stats" })).rejects.toMatchObject({ code: "cooldown", retryAfterMs: 120_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds network and 5xx retries and does not retry ordinary 4xx", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 503 }));
    const { request, wait } = harness(fetcher);
    await expect(request("blockscout", url)).rejects.toMatchObject({ code: "http", status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBeLessThanOrEqual(8000);
    fetcher.mockRejectedValue(new Error("URL-secret header-secret body-secret"));
    const error = await request("robinhood", url).catch(e => e);
    if (!(error instanceof SourceRequestError)) throw new Error("Expected a policy failure");
    expect(error.message + JSON.stringify(error)).not.toMatch(/secret/);
    expect(fetcher).toHaveBeenCalledTimes(6);
    fetcher.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(request("dexscreener", url)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
  it.each([4500, 9000])("charges elapsed backoff oversleep of %i ms before another fetch", async elapsed => {
    let wall = 1_800_000_000_000;
    let monotonic = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 503 }));
    const request = createSourceRequester({ state: createMemorySourceState(), fetch: fetcher,
      now: () => wall, monotonicNow: () => monotonic, random: () => 0,
      wait: async () => { wall += elapsed; monotonic += elapsed; } });
    await expect(request("blockscout", url)).rejects.toMatchObject({ code: "wait-budget" });
    expect(fetcher).toHaveBeenCalledTimes(elapsed === 4500 ? 2 : 1);
  });
  it("rejects an overslept queue before admission without charging transport time", async () => {
    let monotonic = 0;
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockImplementation(async () => Response.json({}));
    const request = createSourceRequester({ state: createMemorySourceState(), fetch: fetcher,
      now: () => 1_800_000_000_000 + monotonic, monotonicNow: () => monotonic, wait: async () => {} });
    const first = request("blockscout", url);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const queued = request("blockscout", url).catch(error => error);
    monotonic = 9000;
    release(Response.json({}));
    await expect(first).resolves.toEqual({});
    expect(await queued).toMatchObject({ code: "wait-budget" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps transport duration out of the cumulative backoff budget", async () => {
    let wall = 1_800_000_000_000;
    let monotonic = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      wall += 15_000; monotonic += 15_000;
      return new Response(null, { status: 503 });
    });
    const request = createSourceRequester({ state: createMemorySourceState(), fetch: fetcher,
      now: () => wall, monotonicNow: () => monotonic, random: () => 0,
      wait: async ms => { wall += ms; monotonic += ms; } });
    await expect(request("blockscout", url)).rejects.toMatchObject({ code: "http", status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("reserves daily and execution budgets before every attempt, including failed ones", async () => {
    const state = createMemorySourceState();
    let now = 1_800_000_000_000;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    const deps = { state, fetch: fetcher, now: () => now, wait: async (ms: number) => { now += ms; }, limits: { processCalls: 1, dailyCalls: 2 } };
    const first = createSourceRequester(deps);
    await first("blockscout", url);
    await expect(first("blockscout", url)).rejects.toMatchObject({ code: "budget" });
    await createSourceRequester(deps)("blockscout", url);
    await expect(createSourceRequester(deps)("blockscout", url)).rejects.toMatchObject({ code: "budget" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 86_400_000;
    await createSourceRequester(deps)("blockscout", url);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("expires rolling call reservations without resetting the daily budget", async () => {
    let now = Date.parse("2027-01-15T08:00:00Z");
    const start = now;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    const request = createSourceRequester({ state: createMemorySourceState(), fetch: fetcher, now: () => now,
      wait: async ms => { now += ms; }, limits: { processCalls: 2, dailyCalls: 3 } });
    await request("blockscout", url);
    now = start + 30_000;
    await request("blockscout", url);
    now = start + 59_999;
    await expect(request("blockscout", url)).rejects.toMatchObject({ code: "budget" });
    now = start + 60_000;
    await expect(request("blockscout", url)).resolves.toEqual({});
    now = start + 120_000;
    await expect(request("blockscout", url)).rejects.toMatchObject({ code: "budget" });
    now = start + 86_400_000;
    await expect(request("blockscout", url)).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("recognizes challenge responses and blocks the remaining scope", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("<html>challenge body-secret</html>", { headers: { "content-type": "text/html" } }));
    const { request } = harness(fetcher);
    const error = await request("geckoterminal", url, { scope: "metadata" }).catch(e => e);
    expect(isSourceBlocked(error)).toBe(true);
    await expect(request("geckoterminal", url, { scope: "metadata" })).rejects.toMatchObject({ code: "cooldown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("bounded source transport", () => {
  it("sends headers only to the caller URL without redirects or cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: 1 }));
    const { request } = harness(fetcher);
    await expect(request("blockscout", url, { headers: { Authorization: "Bearer header-secret" } })).resolves.toEqual({ value: 1 });
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error", cache: "no-store", headers: { Accept: "application/json", Authorization: "Bearer header-secret" }, signal: expect.any(AbortSignal) }));
  });
  it("counts actual streamed bytes rather than trusting content length", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('"ééé"'));
    const { request } = harness(fetcher);
    await expect(request("blockscout", url, { maxBytes: 7 })).rejects.toMatchObject({ code: "response-too-large", status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never leaks malformed JSON, transport reasons, URL or headers", async () => {
    const { request } = harness(vi.fn<typeof fetch>().mockResolvedValue(new Response("body-secret")));
    const error = await request("blockscout", url).catch(e => e);
    expect(error).toBeInstanceOf(SourceRequestError);
    expect(error).toMatchObject({ code: "invalid-json", status: 200, retryAfterMs: null });
    if (!(error instanceof SourceRequestError)) throw new Error("Expected a policy failure");
    expect(JSON.stringify(error) + error.message).not.toMatch(/secret|provider.invalid/);
  });
  it.each(["network", "body"])("enforces the %s deadline even if the implementation ignores abort", async (phase) => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => phase === "network" ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ start() {} }))));
    const { request } = harness(fetcher);
    const result = request("blockscout", url, { timeoutMs: 50 }).catch(e => e);
    await vi.advanceTimersByTimeAsync(51);
    expect(await result).toMatchObject({ code: "timeout", status: phase === "body" ? 200 : null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns null only for explicitly allowed 404", async () => {
    const { request } = harness(vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 404 })));
    await expect(request("blockscout", url, { allow404: true })).resolves.toBeNull();
    await expect(request("blockscout", url)).rejects.toMatchObject({ code: "http", status: 404 });
  });
});
