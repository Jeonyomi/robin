import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic snapshots and mocked I/O only; never operational fallback data.
vi.mock("node:fs", () => ({ default: { existsSync: vi.fn(() => false), readFileSync: vi.fn() } }));
const NOW = Date.parse("2026-09-08T09:00:00Z");
const snapshot = (builtAt = NOW) => ({ builtAt: new Date(builtAt).toISOString(), overview: {}, stockTokens: {}, syncStates: [] });
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("public snapshot request cost and freshness", () => {
  it("suppresses repeated failed refreshes for 30 seconds then allows recovery", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockImplementation(async () => new Response(JSON.stringify(snapshot())));
    vi.stubGlobal("fetch", fetcher);
    const { loadSnapshot } = await import("@/lib/snapshot");
    expect(await loadSnapshot()).toBeNull();
    expect(await loadSnapshot()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 30_000);
    expect(await loadSnapshot()).toEqual(snapshot());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds an upstream stall and still tries the local fallback", async () => {
    const fs = (await import("node:fs")).default;
    const data = snapshot();
    vi.mocked(fs.existsSync).mockReturnValueOnce(true);
    vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(data));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const { loadSnapshot } = await import("@/lib/snapshot");
    let settled = false;
    const result = loadSnapshot().then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(settled).toBe(true);
    expect(await result).toEqual(data);
  });

  it("rejects source-aged snapshots even while the five-minute cache TTL remains", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const data = snapshot(NOW - 3 * 60 * 60_000 + 30_000);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetcher);
    const { loadSnapshot } = await import("@/lib/snapshot");
    expect(await loadSnapshot()).toEqual(data);
    vi.setSystemTime(NOW + 31_000);
    expect(await loadSnapshot()).toBeNull();
  });

  it("coalesces concurrent cache misses into one Blob fetch without renewing builtAt", async () => {
    const data = snapshot();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetcher);
    const { loadSnapshot } = await import("@/lib/snapshot");
    const results = await Promise.all(Array.from({ length: 8 }, () => loadSnapshot()));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array.from({ length: 8 }, () => data));
    vi.setSystemTime(NOW + 60_000);
    expect(await loadSnapshot()).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
