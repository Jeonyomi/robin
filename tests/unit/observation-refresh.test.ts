// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useObservation } from "../../src/lib/hooks/use-observation";

type Value = { marker: string } | null;
type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; signal?: AbortSignal };
const select = (payload: unknown) => (payload as { data: Value }).data;
let pending: Pending[];
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let observation: ReturnType<typeof useObservation<Value>>;
let renders: Array<{ data: Value; receivedAt: number | null; loading: boolean }>;
function Probe({ requestKey, threshold }: { requestKey: string; threshold?: number }) {
  const current = useObservation(requestKey, select, threshold === undefined ? undefined : { refreshOnReturnMs: threshold });
  React.useLayoutEffect(() => { observation = current; }, [current]);
  renders.push({ data: current.data, receivedAt: current.receivedAt, loading: current.loading });
  return React.createElement("div", null, current.data?.marker ?? "empty");
}
async function render(requestKey = "/A", threshold?: number) {
  await act(async () => root.render(React.createElement(Probe, { requestKey, threshold })));
}
async function succeed(index: number, marker: string | null) {
  await act(async () => pending[index].resolve({ ok: true, json: async () => ({ data: marker === null ? null : { marker } }) }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending = [];
  renders = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal: options?.signal ?? undefined }))));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function returnToTab() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("observation refresh", () => {
  it("opts into stale visible returns at the threshold without polling", async () => {
    await render("/A", 60_000);
    await succeed(0, "first");
    vi.setSystemTime(1_059_999);
    await returnToTab();
    expect(pending).toHaveLength(1);
    vi.setSystemTime(1_060_000);
    expect(pending).toHaveLength(1);
    await returnToTab();
    expect(pending).toHaveLength(2);
    expect(observation).toMatchObject({ data: { marker: "first" }, loading: true, receivedAt: 1_000_000 });
    await returnToTab();
    expect(pending).toHaveLength(2);
    await succeed(1, "returned");
    await returnToTab();
    expect(pending).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores hidden focus and visibility events then refreshes on visible return", async () => {
    await render("/A", 60_000);
    await succeed(0, "first");
    vi.setSystemTime(1_060_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await returnToTab();
    expect(pending).toHaveLength(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(pending).toHaveLength(2);
  });

  it("refreshes on window focus alone when visible and stale", async () => {
    await render("/A", 60_000);
    await succeed(0, "first");
    vi.setSystemTime(1_060_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(pending).toHaveLength(2);
  });

  it("registers no automatic listeners or timers without opt-in", async () => {
    const windowAdd = vi.spyOn(window, "addEventListener");
    const documentAdd = vi.spyOn(document, "addEventListener");
    await render();
    await succeed(0, "first");
    vi.setSystemTime(2_000_000);
    await returnToTab();
    expect(pending).toHaveLength(1);
    expect(windowAdd.mock.calls.filter(([event]) => event === "focus")).toHaveLength(0);
    expect(documentAdd.mock.calls.filter(([event]) => event === "visibilitychange")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cools down from failed request settlement without replacing successful receipt time", async () => {
    await render("/A", 60_000);
    await succeed(0, "retained");
    vi.setSystemTime(1_060_000);
    await returnToTab();
    expect(pending).toHaveLength(2);
    vi.setSystemTime(1_180_000); // Even a slow failure must not immediately retry.
    await act(async () => pending[1].reject(new Error("offline")));
    expect(observation).toMatchObject({ data: { marker: "retained" }, error: true, receivedAt: 1_000_000 });
    await returnToTab();
    vi.setSystemTime(1_239_999);
    await returnToTab();
    expect(pending).toHaveLength(2);
    vi.setSystemTime(1_240_000);
    await returnToTab();
    expect(pending).toHaveLength(3);
  });

  it("permits explicit retry during automatic failure cooldown", async () => {
    await render("/A", 60_000);
    await act(async () => pending[0].reject(new Error("offline")));
    await returnToTab();
    expect(pending).toHaveLength(1);
    await act(async () => observation.refresh());
    expect(pending).toHaveLength(2);
    await succeed(1, "recovered");
    expect(observation.error).toBe(false);
  });

  it.each(["null", "failure"])("retries an initial %s result on a stale return", async (result) => {
    await render("/A", 60_000);
    if (result === "null") await succeed(0, null);
    else await act(async () => pending[0].reject(new Error("offline")));
    expect(observation.receivedAt).toBe(result === "null" ? 1_000_000 : null);
    await returnToTab();
    expect(pending).toHaveLength(1);
    vi.setSystemTime(1_060_000);
    await returnToTab();
    expect(pending).toHaveLength(2);
    await succeed(1, "now available");
    expect(observation).toMatchObject({ data: { marker: "now available" }, error: false, receivedAt: 1_060_000 });
  });

  it("updates and removes opt-in listeners without refetching unchanged conditions", async () => {
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    await render("/A", 60_000);
    await succeed(0, "first");
    const refresh = observation.refresh;
    await render("/A", 120_000);
    expect(observation.refresh).toBe(refresh);
    vi.setSystemTime(1_060_000);
    await returnToTab();
    expect(pending).toHaveLength(1);
    await render("/A");
    vi.setSystemTime(2_000_000);
    await returnToTab();
    expect(pending).toHaveLength(1);
    expect(windowRemove.mock.calls.some(([event]) => event === "focus")).toBe(true);
    expect(documentRemove.mock.calls.some(([event]) => event === "visibilitychange")).toBe(true);
    await render("/A", 60_000);
    await act(async () => root.unmount());
    mounted = false;
    await returnToTab();
    expect(pending).toHaveLength(1);
  });

  it.each(["network", "http", "json", "selector"])("retains data and receipt time after a %s refresh failure", async (failure) => {
    await render();
    await succeed(0, "retained");
    vi.setSystemTime(1_010_000);
    await act(async () => observation.refresh());
    await act(async () => {
      if (failure === "network") pending[1].reject(new Error("offline"));
      else pending[1].resolve({ ok: failure !== "http", json: async () => {
        if (failure === "json") throw new Error("invalid JSON");
        return null; // select throws for an invalid envelope.
      } });
    });
    expect(observation).toMatchObject({ data: { marker: "retained" }, loading: false, error: true, receivedAt: 1_000_000 });
    await act(async () => observation.refresh());
    expect(observation.error).toBe(false);
    await succeed(2, "recovered");
    expect(observation).toMatchObject({ data: { marker: "recovered" }, error: false, receivedAt: 1_010_000 });
  });

  it("deduplicates manual refreshes throughout an in-flight request", async () => {
    await render();
    await act(async () => observation.refresh());
    expect(pending).toHaveLength(1);
    await succeed(0, "first");
    await act(async () => { observation.refresh(); observation.refresh(); });
    await act(async () => observation.refresh());
    expect(pending).toHaveLength(2);
    expect(pending[1].signal?.aborted).toBe(false);
    await succeed(1, "second");
    expect(observation.data?.marker).toBe("second");
  });

  it("clears data and receivedAt in every render of a changed condition", async () => {
    await render();
    await succeed(0, "old");
    await act(async () => observation.refresh());
    renders = [];
    await render("/B");
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every((value) => value.data === null && value.receivedAt === null && value.loading)).toBe(true);
    expect(pending[1].signal?.aborted).toBe(true);
    await succeed(1, "obsolete refresh");
    expect(observation).toMatchObject({ data: null, receivedAt: null, loading: true });
    await succeed(2, "current");
    expect(observation.data?.marker).toBe("current");
  });

  it("ignores obsolete A-B-A requests including delayed response bodies", async () => {
    await render();
    let resolveBody!: (value: unknown) => void;
    await act(async () => pending[0].resolve({ ok: true, json: () => new Promise((resolve) => { resolveBody = resolve; }) }));
    await render("/B");
    await render("/A");
    await succeed(2, "latest A");
    await act(async () => resolveBody({ data: { marker: "obsolete A" } }));
    await act(async () => pending[1].reject(new Error("obsolete B")));
    expect(observation).toMatchObject({ data: { marker: "latest A" }, error: false, loading: false, receivedAt: 1_000_000 });
    expect(pending[0].signal?.aborted).toBe(true);
    expect(pending[1].signal?.aborted).toBe(true);
  });

  it("aborts an active refresh on unmount and disables retained callbacks", async () => {
    await render();
    await succeed(0, "first");
    const refresh = observation.refresh;
    await act(async () => refresh());
    await act(async () => root.unmount());
    mounted = false;
    expect(pending[1].signal?.aborted).toBe(true);
    await succeed(1, "too late");
    await act(async () => refresh());
    expect(pending).toHaveLength(2);
    expect(host.textContent).toBe("");
  });

  it("explicitly refreshes without discarding same-key data and timestamps successful receipt", async () => {
    await render();
    await succeed(0, "first");
    vi.setSystemTime(1_010_000);
    await act(async () => observation.refresh());
    expect(pending).toHaveLength(2);
    expect(observation).toMatchObject({ data: { marker: "first" }, loading: true, error: false, receivedAt: 1_000_000 });
    await succeed(1, "second");
    expect(observation).toMatchObject({ data: { marker: "second" }, loading: false, error: false, receivedAt: 1_010_000 });
  });
});
