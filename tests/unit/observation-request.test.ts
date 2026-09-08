// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Overview from "../../src/app/page";
import Transfers from "../../src/app/capital-flow/page";
import Lens from "../../src/app/opportunities/page";
import Registry from "../../src/app/stock-tokens/page";

vi.mock("@/components/charts/activity-timeline", () => ({ ActivityTimelineChart: () => null }));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; signal?: AbortSignal };
let pending: Pending[];
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
const pages = [
  { name: "Overview", component: Overview, registry: false },
  { name: "Transfer Activity", component: Transfers, registry: false },
  { name: "Activity Lens", component: Lens, registry: false },
  { name: "Asset Registry", component: Registry, registry: true },
];
function payload(marker: string, registry: boolean, lens: boolean) {
  const token = { address: `0x${marker}`, symbol: marker, name: marker, canonicalStatus: "CANONICAL", metrics: null, lastSeenAt: "2026-09-08T00:00:00Z", activityIndex: 50, evidence: [], momentumPct: null };
  return { data: registry || lens ? [token] : {
    activity: { transferEvents: 12 }, coverage: { status: "success" }, dataQuality: { note: marker }, timeline: [], recentTransfers: [],
  }, meta: { status: "active-limited", release: { coveragePct: 100, reasons: [] } } };
}
async function resolve(index: number, marker: string, page: typeof pages[number]) {
  await act(async () => pending[index].resolve({ ok: true, json: async () => payload(marker, page.registry, page.component === Lens) }));
}
async function change(page: typeof pages[number], label = "1h") {
  const control = page.registry ? host.querySelector<HTMLInputElement>('input[type="checkbox"]') : [...host.querySelectorAll("button")].find((button) => button.textContent === label);
  await act(async () => control!.click());
}
beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal: options?.signal ?? undefined }))));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe.each(pages)("$name request ownership", (page) => {
  it("hides previous data immediately while the new condition loads", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await resolve(0, "OLD_WINDOW", page);
    await change(page);
    expect(host.textContent).not.toContain("OLD_WINDOW");
    expect(host.textContent).toMatch(/Refreshing|Loading|Checking current index/);
    await resolve(1, "NEW_WINDOW", page);
    expect(host.textContent).toContain("NEW_WINDOW");
  });

  it("ignores obsolete rejection and completion while the current request is pending", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await change(page);
    await act(async () => pending[0].reject(new Error("obsolete")));
    expect(host.textContent).toMatch(/Refreshing|Loading|Checking current index/);
    expect(host.textContent).not.toMatch(/could not be loaded|data is unavailable/);
    await resolve(1, "NEW_WINDOW", page);
    expect(host.textContent).toContain("NEW_WINDOW");
  });

  it("shows current request errors and resets them on a changed condition", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await act(async () => pending[0].resolve({ ok: false, json: async () => ({ data: null }) }));
    expect(host.textContent).toMatch(/could not be loaded|data is unavailable/);
    await change(page);
    expect(host.textContent).not.toMatch(/could not be loaded|data is unavailable/);
    expect(host.textContent).toMatch(/Refreshing|Loading|Checking current index/);
    await resolve(1, "RECOVERED", page);
    expect(host.textContent).toContain("RECOVERED");
  });

  it("cancels on unmount and ignores a transport that resolves after cancellation", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await act(async () => root.unmount());
    mounted = false;
    expect(pending[0].signal?.aborted).toBe(true);
    await resolve(0, "AFTER_UNMOUNT", page);
    expect(host.textContent).toBe("");
  });

  it("does not request again for an unchanged condition", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await resolve(0, "CURRENT", page);
    await act(async () => root.render(React.createElement(page.component)));
    if (!page.registry) await change(page, "24h");
    expect(pending).toHaveLength(1);
  });

  it("rejects an earlier request even when its key becomes current again", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await change(page);
    await change(page, "24h");
    await resolve(2, "LATEST_SAME_KEY", page);
    await resolve(0, "OLD_SAME_KEY", page);
    await act(async () => pending[1].reject(new Error("obsolete")));
    expect(host.textContent).toContain("LATEST_SAME_KEY");
    expect(host.textContent).not.toContain("OLD_SAME_KEY");
  });

  it("keeps the newest condition when responses resolve in reverse order", async () => {
    await act(async () => root.render(React.createElement(page.component)));
    await change(page);
    await resolve(1, "NEW_WINDOW", page);
    expect(host.textContent).toContain("NEW_WINDOW");
    await resolve(0, "OLD_WINDOW", page);
    expect(host.textContent).toContain("NEW_WINDOW");
    expect(host.textContent).not.toContain("OLD_WINDOW");
    expect(pending[0].signal?.aborted).toBe(true);
  });
});
