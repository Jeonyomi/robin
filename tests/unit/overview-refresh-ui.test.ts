// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Overview from "../../src/app/page";

const hook = vi.hoisted(() => ({ useObservation: vi.fn() }));
vi.mock("@/lib/hooks/use-observation", () => hook);
vi.mock("@/components/charts/activity-timeline", () => ({ ActivityTimelineChart: () => null }));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let host: HTMLDivElement;
let root: Root;
const refresh = vi.fn();
const data = {
  activity: { transferEvents: 17, lastObservedAt: "2026-09-08T12:00:00Z" },
  coverage: { status: "success" }, dataQuality: { note: "OBSERVED_SAMPLE" },
  timeline: [], recentTransfers: [],
};
const receivedAt = Date.parse("2026-09-08T12:05:00Z");
function state(extra = {}) {
  hook.useObservation.mockReturnValue({ data, loading: false, error: false, receivedAt, refresh, ...extra });
}
async function render() { await act(async () => root.render(React.createElement(Overview))); }
beforeEach(() => {
  vi.clearAllMocks();
  state();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("offers refresh without changing the selected observation window", async () => {
  await render();
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Refresh");
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(hook.useObservation).toHaveBeenLastCalledWith("/api/v1/overview?window=24h", expect.any(Function), { refreshOnReturnMs: 60_000 });
});
it("retains evidence with an explicit warning when a refresh fails", async () => {
  state({ error: true }); await render();
  expect(host.textContent).toContain("TRANSFER EVENTS");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Refresh failed");
  expect(host.textContent).toContain("Previously loaded data is still shown");
});
it("distinguishes successful screen receipt from upstream observation time", async () => {
  await render();
  const receipt = host.querySelector('[aria-label="Screen refresh status"]');
  expect(receipt?.textContent).toContain("Screen received");
  expect(receipt?.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-08T12:05:00.000Z");
  expect(receipt?.textContent).toContain("not a new source observation");
  expect(host.textContent).toContain("Window ending 2026-09-08T12:00:00.000Z");
});
it("disables refresh while pending without hiding previous evidence", async () => {
  state({ loading: true }); await render();
  const button = host.querySelector<HTMLButtonElement>(".overview-refresh-button");
  expect(button?.disabled).toBe(true);
  expect(host.textContent).toContain("TRANSFER EVENTS");
});
it("keeps research summaries and exact workspace links available during an Overview outage", async () => {
  state({ data: null, error: true, receivedAt: null }); await render();
  for (const href of ["/liquidity", "/meme-leaders"]) {
    expect(host.querySelector(`a[href="${href}"]`), href).not.toBeNull();
  }
  expect(host.textContent).toContain("Explore liquidity & meme activity");
});
it("offers retry after initial failure without inventing receipt time", async () => {
  state({ data: null, error: true, receivedAt: null }); await render();
  expect(host.textContent).toContain("could not be loaded");
  expect(host.querySelector('[aria-label="Screen refresh status"]')?.textContent).toContain("Not received yet");
  expect(host.querySelector('[aria-label="Screen refresh status"] time')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>(".overview-refresh-button")?.disabled).toBe(false);
});
